import Result from '../models/result.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import { replayRun } from './run-engine.js';
import { startPracticeSession } from './game.service.js';
import { dateKey, getOrCreateChallenge } from './daily.service.js';

/** Fields a replay needs, plus the summary shown beside it. */
const REPLAY_FIELDS =
  'userId text keystrokes rules leadMs timeMax gameMode wordCount modifiers wpm rawWpm accuracy consistency ' +
  'performance ranked dailyDate createdAt';

/**
 * Cursor positions over time for a ghost: [[ms from the run's start, chars
 * typed], ...], one point per key that moved the cursor. Derived from the
 * server's replay, so a ghost moves exactly as the scored run did.
 */
export const ghostTimeline = (result) => {
  const replay = replayRun(result.text, result.keystrokes, result.rules, {
    leadMs: result.leadMs || 0,
    timeMax: result.timeMax,
  });
  if (!replay.valid) return null;
  const points = [];
  let last = -1;
  for (const { t, pos } of replay.timeline) {
    if (pos === last) continue;
    points.push([t + (result.leadMs || 0), pos]);
    last = pos;
  }
  return points;
};

const hasLog = (r) => !!r && typeof r.text === 'string' && Array.isArray(r.keystrokes) && r.keystrokes.length > 0;

/**
 * A run's replay: the text and its keystroke log under the run's rules.
 * Players can always watch their own runs; other players' runs only when
 * they were ranked (competitive runs are public, practice stays private).
 *
 * @returns {Promise<object|null>} null when not found, not visible or without a log
 */
export const getReplay = async (resultId, viewerId = null) => {
  const r = await Result.findById(resultId)
    .select(REPLAY_FIELDS)
    .populate('userId', 'username displayName avatar status')
    .lean();
  if (!hasLog(r) || !r.userId || r.userId.status !== 'active') return null;
  const owner = viewerId && String(r.userId._id) === String(viewerId);
  if (!owner && !r.ranked) return null;
  // A daily text stays secret until its day is over, except to its own player.
  if (!owner && r.dailyDate && r.dailyDate >= dateKey(new Date())) return null;

  return {
    resultId: String(r._id),
    player: {
      userId: String(r.userId._id),
      username: r.userId.username,
      displayName: r.userId.displayName || r.userId.username,
      avatar: r.userId.avatar || '',
    },
    text: r.text,
    keystrokes: r.keystrokes,
    rules: r.rules,
    leadMs: r.leadMs || 0,
    timeMax: r.timeMax,
    gameMode: r.gameMode,
    wordCount: r.wordCount,
    modifiers: r.modifiers,
    wpm: r.wpm,
    rawWpm: r.rawWpm,
    accuracy: r.accuracy,
    consistency: r.consistency,
    performance: r.performance || [],
    ranked: r.ranked,
    dailyDate: r.dailyDate || null,
    createdAt: r.createdAt,
  };
};

/**
 * The player's best ranked run for these settings, as a ghost to race on
 * any text: the cursor moves at the pace the run moved.
 */
export const getPbGhost = async (userId, { gameMode, timeMax }) => {
  const best = await Result.findOne({
    userId,
    ranked: true,
    gameMode,
    timeMax,
    text: { $exists: true },
  })
    .sort({ wpm: -1, createdAt: 1 })
    .select('text keystrokes rules leadMs timeMax wpm')
    .lean();
  if (!hasLog(best)) return null;
  const timeline = ghostTimeline(best);
  return timeline ? { resultId: String(best._id), wpm: best.wpm, timeline } : null;
};

/**
 * Starts a practice run on a daily text against its winner's ghost. Today's
 * text is only open to players who have finished their own attempt; past
 * days are open to everyone. The run is saved but never ranked.
 *
 * @returns {Promise<{ error: string, status: number } | { state: object, ghost: object }>}
 */
export const startDailyGhostRun = async (userId, date, now = new Date()) => {
  const today = dateKey(now);
  if (date > today) return { status: 404, error: 'No challenge for that day yet' };
  if (date === today) {
    const mine = await DailyAttempt.findOne({ userId, date }).select('finishedAt').lean();
    if (!mine?.finishedAt) return { status: 403, error: "Finish today's challenge first" };
  }

  const best = await DailyAttempt.findOne({ date, ranked: true, resultId: { $ne: null } })
    .sort({ wpm: -1, accuracy: -1, finishedAt: 1 })
    .populate('userId', 'username displayName status')
    .lean();
  if (!best?.userId || best.userId.status !== 'active') return { status: 404, error: 'No verified run to race yet' };

  const result = await Result.findById(best.resultId).select('text keystrokes rules leadMs timeMax wpm').lean();
  const timeline = hasLog(result) ? ghostTimeline(result) : null;
  if (!timeline) return { status: 404, error: 'The leading run has no replay' };

  const challenge = await getOrCreateChallenge(date);
  const state = await startPracticeSession(
    userId,
    { text: challenge.text, totalWords: challenge.totalWords },
    { kind: 'ghost', id: date },
    { timeMax: challenge.timeMax }
  );
  return {
    state,
    ghost: {
      label: `${best.userId.displayName || best.userId.username} · ${best.wpm} WPM`,
      resultId: String(best.resultId),
      wpm: best.wpm,
      timeline,
    },
  };
};
