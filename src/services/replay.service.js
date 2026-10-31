import Result from '../models/result.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import { replayRun } from './run-engine.js';
import { startPracticeSession } from './game.service.js';
import { dateKey, getOrCreateChallenge } from './daily.service.js';
import { publicHandle, publicName } from '../utils/public-identity.js';

/** Fields a replay needs, plus the summary shown beside it. */
const REPLAY_FIELDS =
  'userId text keystrokes rules leadMs timeMax gameMode wordCount modifiers wpm rawWpm accuracy consistency ' +
  'performance ranked dailyDate practiceKind practiceId createdAt';

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
 * Every run with a keystroke log is public, ranked or practice, to anyone
 * who has its id, unless its player's account is no longer active. The one
 * exception is today's daily challenge: its replays would give the text away,
 * so they stay hidden until the viewer has finished their own attempt.
 *
 * @returns {Promise<object|null|{ error: string, status: number }>} null when not found or without a log
 */
export const getReplay = async (resultId, viewerId = null, now = new Date()) => {
  const r = await Result.findById(resultId)
    .select(REPLAY_FIELDS)
    .populate('userId', 'username displayName avatar status')
    .lean();
  if (!hasLog(r)) return null;
  if (r.userId && r.userId.status && r.userId.status !== 'active') return null;
  // Ghost runs on a daily text (startDailyGhostRun) carry the text too, under practiceId.
  const textDate = r.dailyDate || (r.practiceKind === 'ghost' ? r.practiceId : null);
  if (textDate && textDate >= dateKey(now) && String(r.userId?._id ?? '') !== String(viewerId ?? '-')) {
    const mine = viewerId ? await DailyAttempt.findOne({ userId: viewerId, date: textDate }).select('finishedAt').lean() : null;
    if (!mine?.finishedAt) return { status: 403, error: "Finish today's challenge first" };
  }

  const player = r.userId
    ? {
        userId: String(r.userId._id),
        username: publicHandle(r.userId),
        displayName: publicName(r.userId),
        avatar: r.userId.avatar || '',
      }
    : {
        userId: '',
        username: 'Guest',
        displayName: 'Guest',
        avatar: '',
      };

  return {
    resultId: String(r._id),
    player,
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
    // Phrases have no time limit: any ranked phrases run can be the PB.
    ...(gameMode === 'phrases' ? {} : { timeMax }),
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
 * Starts a practice run on a daily text against its winner's ghost or the player's PB ghost.
 * Today's text is only open to players who have finished their own attempt; past
 * days are open to everyone. The run is saved but never ranked.
 *
 * @param {string} userId
 * @param {string} date
 * @param {Date} [now]
 * @param {'leader'|'pb'} [target]
 * @returns {Promise<{ error: string, status: number } | { state: object, ghost: object }>}
 */
export const startDailyGhostRun = async (userId, date, now = new Date(), target = 'leader') => {
  const today = dateKey(now);
  if (date > today) return { status: 404, error: 'No challenge for that day yet' };
  if (date === today) {
    const mine = await DailyAttempt.findOne({ userId, date }).select('finishedAt').lean();
    if (!mine?.finishedAt) return { status: 403, error: "Finish today's challenge first" };
  }

  let attempt;
  if (target === 'pb') {
    attempt = await DailyAttempt.findOne({ userId, date, resultId: { $ne: null } })
      .populate('userId', 'username displayName status')
      .lean();
    if (!attempt) return { status: 404, error: 'No personal run for today to race against yet' };
  } else {
    attempt = await DailyAttempt.findOne({ date, ranked: true, resultId: { $ne: null } })
      .sort({ wpm: -1, accuracy: -1, finishedAt: 1 })
      .populate('userId', 'username displayName status')
      .lean();
    if (!attempt?.userId || attempt.userId.status !== 'active') return { status: 404, error: 'No verified run to race yet' };
  }

  const result = await Result.findById(attempt.resultId).select('text keystrokes rules leadMs timeMax wpm').lean();
  const timeline = hasLog(result) ? ghostTimeline(result) : null;
  if (!timeline) return { status: 404, error: 'The run has no replay' };

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
      kind: target === 'pb' ? 'pb' : 'daily',
      label: target === 'pb' ? `PB · ${attempt.wpm} WPM` : `${publicName(attempt.userId)} · ${attempt.wpm} WPM`,
      resultId: String(attempt.resultId),
      wpm: attempt.wpm,
      timeline,
    },
  };
};
