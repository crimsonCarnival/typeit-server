import mongoose from 'mongoose';
import Race from '../../models/race.model.js';
import User from '../../models/user.model.js';
import Result from '../../models/result.model.js';
import { replayRun } from '../run-engine.js';
import { publicHandle, publicName } from '../../utils/public-identity.js';
import { _rooms } from './race-manager.js';

const TOP_KEYS = 5;
const TOP_WORDS = 5;
const SKIP_VIEW = ' ';

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value) && String(value).length === 24;

/** Wrong keys by the key that should have been typed, worst first. */
const worstKeys = (keyErrors = []) => {
  const byKey = new Map();
  for (const { expected, count } of keyErrors) byKey.set(expected, (byKey.get(expected) || 0) + count);
  return [...byKey]
    .map(([key, count]) => ({ key: key === SKIP_VIEW ? 'space' : key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, TOP_KEYS);
};

/** The race itself: by id, or the latest race held under an invite code. */
const findRace = (ref) => (isObjectId(ref) ? Race.findById(ref).lean() : Race.findOne({ code: String(ref).toUpperCase() }).sort({ finishedAt: -1 }).lean());

/**
 * Who may look: the racers, and anyone watching that room right now, but only
 * for the race the room just finished. Codes are reused (rematches, collisions),
 * so a code alone never grants access to an older race.
 */
const mayView = (race, viewerId) => {
  const id = String(viewerId);
  if (race.players.some((p) => String(p.userId) === id)) return true;
  const room = _rooms.get(race.code);
  return !!room?.spectators?.includes(id) && room.state === 'finished' && new Date(room.finishedAt).getTime() === new Date(race.finishedAt).getTime();
};

/**
 * Per-racer mistakes for one finished race, over the shared text: totals, the
 * worst keys, and how many errors each racer made in each word. Replayed from
 * the stored keystroke logs, the same way the scored results were.
 *
 * @returns {Promise<{ error: string, status: number } | object>}
 */
export const getRaceMistakes = async (ref, viewerId) => {
  const race = await findRace(ref);
  if (!race) return { error: 'Race not found', status: 404 };
  // Same answer as a missing race, so this can't be used to probe which races exist.
  if (!mayView(race, viewerId)) return { error: 'Race not found', status: 404 };

  const resultIds = race.players.map((p) => p.resultId).filter(Boolean);
  const [results, users] = await Promise.all([
    Result.find({ _id: { $in: resultIds } }).select('text keystrokes rules leadMs timeMax keyErrors').lean(),
    User.find({ _id: { $in: race.players.map((p) => p.userId) } }).select('username displayName avatar').lean(),
  ]);
  const resultById = new Map(results.map((r) => [String(r._id), r]));
  const userById = new Map(users.map((u) => [String(u._id), u]));

  let spans = null;
  const players = race.players
    .map((p) => {
      const user = userById.get(String(p.userId));
      const result = p.resultId ? resultById.get(String(p.resultId)) : null;
      const base = {
        userId: String(p.userId),
        displayName: user ? publicName(user) : 'Player',
        username: user ? publicHandle(user) : '',
        place: p.place,
        wpm: p.wpm,
        accuracy: p.accuracy,
        hasData: false,
      };
      if (!result || !Array.isArray(result.keystrokes)) return base;
      const replay = replayRun(race.text, result.keystrokes, result.rules, { leadMs: result.leadMs || 0, timeMax: result.timeMax });
      if (!replay.valid) return base;
      spans ??= replay.words.map(({ start, end }) => ({ start, end }));
      return {
        ...base,
        hasData: true,
        mistakes: replay.wrongKeys,
        backspaces: replay.backspaces,
        blocked: replay.blocked,
        worstKeys: worstKeys(result.keyErrors),
        wordErrors: replay.words.map((w) => w.errors),
      };
    })
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || (b.wpm ?? 0) - (a.wpm ?? 0));

  const words = (spans ?? []).map(({ start, end }) => race.text.slice(start, end));
  const hardestWords = words
    .map((word, i) => ({ word, errors: players.reduce((sum, p) => sum + (p.wordErrors?.[i] || 0), 0) }))
    .filter((w) => w.errors > 0)
    .sort((a, b) => b.errors - a.errors)
    .slice(0, TOP_WORDS);

  return {
    raceId: String(race._id),
    code: race.code,
    name: race.name,
    finishedAt: race.finishedAt,
    players,
    words,
    hardestWords,
  };
};

/** The caller's most recent finished races, newest first. */
export const getRaceHistory = async (userId, limit = 10) => {
  const races = await Race.find({ 'players.userId': userId }).sort({ finishedAt: -1 }).limit(limit).lean();
  return races.map((race) => {
    const mine = race.players.find((p) => String(p.userId) === String(userId));
    return {
      raceId: String(race._id),
      code: race.code,
      name: race.name,
      finishedAt: race.finishedAt,
      mode: race.mode,
      wordCount: race.wordCount,
      timeLimit: race.timeLimit,
      rated: race.rated,
      racers: race.players.length,
      place: mine?.place ?? null,
      wpm: mine?.wpm ?? null,
      accuracy: mine?.accuracy ?? null,
    };
  });
};
