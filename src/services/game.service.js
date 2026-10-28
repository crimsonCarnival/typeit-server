import { generateWordContent } from '../data/words.js';
import Session from '../models/session.model.js';
import Result from '../models/result.model.js';
import User from '../models/user.model.js';
import { assessRun } from './integrity.service.js';
import { replayRun, computeResults, normaliseRules, publicRules } from './run-engine.js';
import { boundedElapsedMs, replayOf } from './run.service.js';
import { DEFAULT_RULES } from '../config/gameplay.js';
import { recordDailyFinish } from './daily.service.js';
import { recordPlayDay, syncAchievements } from './achievement.service.js';
import { recordPracticeResult } from './learn.service.js';
import { gameEvents } from '../events/game-events.js';
import { INTEGRITY_FLAGS } from '../config/integrity.js';
import { DEFAULT_TEXT_CATEGORY } from '../config/texts.js';
import { isCasualCategory, pickPassage } from './text-library.service.js';

// Preset categories used to bucket stats. Values outside these are 'custom'.
const PRESET_TIMES = [30, 60, 90, 120];
const PRESET_WORD_COUNTS = [25, 50, 75, 100];

// Fields that reset whenever a session gets new text: no keys, no start yet.
const FRESH_RUN = Object.freeze({ startedAt: null, keys: [], keyCount: 0, leadMs: 0 });

/**
 * Picks the stat bucket key for a numeric setting.
 */
const bucketKey = (value, presets) =>
  presets.includes(value) ? String(value) : 'custom';

/** Single modifier label for a session, as stored on results and ranked on. */
const modifiersOf = (session) => {
  if (session.punctuationEnabled && session.numbersEnabled) return 'both';
  if (session.punctuationEnabled) return 'punctuation';
  if (session.numbersEnabled) return 'numbers';
  return 'none';
};

/**
 * Strips punctuation characters from text.
 */
const stripPunctuation = (text) => {
  return text.replace(/[?.,;:'"!()\-_]/g, '');
};
/**
 * Generates a unique session ID
 */
export const generateSessionId = () => {
  return `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Checks the run duration a client reports when finishing. It is bounded by
 * the server's own clock later (run.service.js); this only rejects values no
 * honest client sends.
 */
export const validateElapsed = (elapsedMs, timeMax = 120) => {
  if (!Number.isFinite(elapsedMs)) return { ok: false, error: 'Invalid game timing' };
  const minMs = 1000; // at least one second of active play
  const maxMs = (timeMax + 60) * 1000; // generous slack beyond the timer
  if (elapsedMs < minMs || elapsedMs > maxMs) return { ok: false, error: 'Invalid elapsed time' };
  return { ok: true, elapsedMs };
};

/**
 * Generates text content based on game mode and settings. Phrases mode picks
 * a passage from `textCategory` and reports where it came from (`passage`);
 * words mode has no passage.
 */
export const generateText = (gameMode, wordCount, punctuationEnabled, numbersEnabled, textCategory = DEFAULT_TEXT_CATEGORY) => {
  if (gameMode !== 'words') {
    // Real prose exactly as written: punctuation and numbers are part of it.
    return pickPassage(textCategory);
  }

  let content = generateWordContent(wordCount, {
    punctuation: punctuationEnabled,
    numbers: numbersEnabled
  });

  // Strip anything the word generator may have included if toggles are off.
  if (!punctuationEnabled) content = stripPunctuation(content);
  if (!numbersEnabled)     content = content.replace(/[0-9]/g, '');

  // Normalise whitespace (may have been introduced by stripping).
  const text = content.replace(/\s+/g, ' ').trim();
  const totalWords = text.split(/\s+/).length;

  return { text, totalWords, passage: null };
};

/**
 * Scores a run from its keystroke log. The only scoring path: every number a
 * player sees at the end of a run comes from here (services/run-engine.js).
 * @returns {{ replay: object, results: object }}
 */
export const scoreRun = (run, elapsedMs) => {
  const replay = replayOf(run);
  const elapsed = boundedElapsedMs(run, elapsedMs, replay);
  return { replay, results: computeResults(run, replay, elapsed, run.leadMs || 0) };
};

/**
 * Returns game state for API response
 */
export const getState = (session) => {
  // For DB sessions, use _id; for in-memory sessions, use sessionId
  const sessionId = session._id ? session._id.toString() : session.sessionId;

  return {
    sessionId,
    text: session.text,
    typedText: session.typedText || '',
    incomplete: session.incomplete,
    gameMode: session.gameMode,
    wordCount: session.wordCount,
    punctuationEnabled: session.punctuationEnabled,
    numbersEnabled: session.numbersEnabled,
    timeMax: session.timeMax,
    totalWords: session.totalWords,
    textCategory: session.textCategory || DEFAULT_TEXT_CATEGORY,
    rules: publicRules(session.rules),
    // Keys the server already holds for this run (resume and progress offsets).
    keyCount: session.keyCount || 0,
    startedAt: session.startedAt ? new Date(session.startedAt).getTime() : null,
    passage: session.passage || null,
    dailyDate: session.dailyDate || null,
    practice: session.practice || null,
    raceCode: session.raceCode || null,
    isAuthenticated: !!session.userId
  };
};

/**
 * Creates a new game session
 */
export const createSession = async (options = {}, userId = null) => {
  const {
    gameMode = 'phrases',
    wordCount = 50,
    timeMax = 120,
    punctuationEnabled = false,
    numbersEnabled = false,
    textCategory = DEFAULT_TEXT_CATEGORY,
    rules = DEFAULT_RULES,
    persist = false,
    clientText,
    clientTotalWords,
  } = options;

  // Use client-provided text (e.g. txtgen phrases) when available;
  // otherwise fall back to server-side generation.
  let text, totalWords, passage = null;
  if (clientText) {
    text = clientText;
    totalWords = clientTotalWords ?? clientText.trim().split(/\s+/).filter(Boolean).length;
  } else {
    ({ text, totalWords, passage } = generateText(gameMode, wordCount, punctuationEnabled, numbersEnabled, textCategory));
  }

  const sessionData = {
    userId: userId || null,
    text,
    typedText: '',
    gameMode,
    wordCount,
    punctuationEnabled,
    numbersEnabled,
    timeMax,
    totalWords,
    textCategory,
    passage,
    rules: normaliseRules(rules),
    textSource: clientText ? 'client' : 'server',
    ...FRESH_RUN,
    dailyDate: null,
    practice: null,
    raceCode: null,
    incomplete: true
  };

  // Only persist to database if user is authenticated AND client requested persistence.
  // This prevents creating DB rows on passive loads/reloads where no result will be saved.
  if (userId && persist) {
    const session = new Session(sessionData);
    await session.save();
    // Update user's lastSession field so we can track the most recent session
    try {
      await User.findByIdAndUpdate(userId, { $set: { lastSession: session._id, lastSessionAt: new Date() } });
      // increment user's incomplete session counter
      try {
        await User.findByIdAndUpdate(userId, { $inc: { 'stats.incompleteSessions': 1 } });
      } catch (e) {
        // Error ignored
      }
    } catch (e) {
      // Error ignored
    }
    return session;
  }

  // For unauthenticated users, return in-memory session object without saving
  return {
    ...sessionData,
    sessionId: generateSessionId()
  };
};

/**
 * Gets a game session by ID (MongoDB _id)
 */
export const getSession = async (sessionId) => {
  return await Session.findById(sessionId);
};

/**
 * Gets the user's most recent session (any status). Used for resume, settings
 * updates, heartbeats and resets — the app reuses a single session per user.
 */
export const getSessionByUserId = async (userId) => {
  return await Session.findOne({ userId }).sort({ updatedAt: -1 });
};

/**
 * Deletes a game session
 */
export const deleteSession = async (sessionId) => {
  // fetch session first so we can adjust user's incomplete counter if needed
  const session = await Session.findById(sessionId);
  if (!session) return false;

  const result = await Session.findByIdAndDelete(sessionId);
  if (result && session.userId && session.incomplete) {
    try {
      await User.findByIdAndUpdate(session.userId, { $inc: { 'stats.incompleteSessions': -1 } });
    } catch (e) {
      // Error ignored
    }
  }

  return !!result;
};

/**
 * Updates a game session
 */
export const updateSession = async (sessionId, updates) => {
  // If updates include an 'incomplete' change, fetch previous state and adjust user's counter
  if (updates && Object.prototype.hasOwnProperty.call(updates, 'incomplete')) {
    const session = await Session.findById(sessionId);
    if (!session) return null;

    const prev = !!session.incomplete;
    const next = !!updates.incomplete;

    // If no change in incomplete, just apply update
    if (prev === next) {
      return await Session.findByIdAndUpdate(sessionId, { $set: updates }, { new: true });
    }

    // Apply update first
    const updated = await Session.findByIdAndUpdate(sessionId, { $set: updates }, { new: true });

    // Adjust user's incomplete counter if session has an owner
    if (session.userId) {
      const delta = next ? 1 : -1;
      try {
        await User.findByIdAndUpdate(session.userId, { $inc: { 'stats.incompleteSessions': delta } });
      } catch (e) {
        // Error ignored
      }
    }

    return updated;
  }

  return await Session.findByIdAndUpdate(sessionId, { $set: updates }, { new: true });
};

/**
 * Points the player's session at a daily challenge: server text, fixed
 * settings, fresh timing. Returns the client-facing state (text included).
 */
export const startDailySession = async (userId, challenge) => {
  const updates = {
    text: challenge.text,
    typedText: '',
    totalWords: challenge.totalWords,
    gameMode: challenge.gameMode,
    wordCount: challenge.wordCount,
    timeMax: challenge.timeMax,
    punctuationEnabled: challenge.punctuationEnabled,
    numbersEnabled: challenge.numbersEnabled,
    textSource: 'server',
    passage: null,
    // Everyone plays a daily under the same rules.
    rules: { ...DEFAULT_RULES },
    ...FRESH_RUN,
    dailyDate: challenge.date,
    practice: null,
    raceCode: null,
    incomplete: true,
    resultsId: null,
  };
  let session = await getSessionByUserId(userId);
  if (!session) {
    session = await createSession({ persist: true, gameMode: challenge.gameMode }, userId);
  }
  const updated = await updateSession(session._id, updates);
  return { ...getState(updated), dailyDate: challenge.date };
};

/**
 * Points the player's session at practice text (drill, lesson, common words,
 * custom list). Practice text is marked as client-chosen so these runs are
 * saved but never ranked; `practice` says what to record when it finishes.
 */
export const startPracticeSession = async (userId, { text, totalWords }, practice) => {
  let session = await getSessionByUserId(userId);
  if (!session) {
    session = await createSession({ persist: true, gameMode: 'words' }, userId);
  }
  const updated = await updateSession(session._id, {
    text,
    typedText: '',
    totalWords,
    gameMode: 'words',
    wordCount: totalWords,
    punctuationEnabled: false,
    numbersEnabled: false,
    textSource: 'client',
    passage: null,
    ...FRESH_RUN,
    dailyDate: null,
    practice,
    raceCode: null,
    incomplete: true,
    resultsId: null,
  });
  return getState(updated);
};

/**
 * Points a racer's session at the race text. The server fixes the start: the
 * run is timed from the race's `startAt` for everyone, so no client can get a
 * head start by reporting an earlier first keystroke.
 */
export const startRaceSession = async (userId, { code, text, totalWords, wordCount, startAt }) => {
  let session = await getSessionByUserId(userId);
  if (!session) {
    session = await createSession({ persist: true, gameMode: 'words' }, userId);
  }
  const updated = await updateSession(session._id, {
    text,
    typedText: '',
    totalWords,
    gameMode: 'words',
    wordCount,
    // Generous limit; the race itself times out first (config/race.js).
    timeMax: 600,
    punctuationEnabled: false,
    numbersEnabled: false,
    textSource: 'server',
    passage: null,
    rules: { ...DEFAULT_RULES },
    ...FRESH_RUN,
    startedAt: new Date(startAt),
    dailyDate: null,
    practice: null,
    raceCode: code,
    incomplete: true,
    resultsId: null,
  });
  return getState(updated);
};

/**
 * Ends a run: scores it from its keystroke log and, for a signed-in player,
 * saves the result and updates stats, badges, daily and race state.
 *
 * @param {object} run           Session document or guest run (text, keys, rules, timing)
 * @param {object} input
 * @param {string} input.typedText   what the client shows as typed (checked against the replay)
 * @param {number} input.elapsedMs   client-measured run duration
 * @param {string|null} [input.userId]
 * @param {boolean} [input.migrated] a guest run saved after signing in
 */
export const endGame = async (run, { typedText = '', elapsedMs, userId = null, migrated = false }) => {
  const { replay, results } = scoreRun(run, elapsedMs);

  // Guests: nothing is persisted.
  if (!userId) {
    return results;
  }

  // Integrity compares the client's text with the full log (also keys the
  // display accepted just past a penalised deadline it hadn't heard about).
  const full = replayRun(run.text, run.keys, run.rules);
  const casualText = run.gameMode === 'phrases' && !!run.passage && isCasualCategory(run.passage.category);
  const integrity = assessRun({
    textSource: run.textSource || 'client',
    casualText,
    serverStartedAt: run.startedAt || null,
    serverEndedAt: new Date(),
    clientElapsedMs: elapsedMs,
    wpm: results.wpm,
    rawWpm: results.rawWpm,
    textLength: run.text.length,
    typedText,
    keystrokes: { ...full, replayed: full.typed },
  });
  results.ranked = integrity.ranked;
  results.integrityFlags = integrity.flags;

  const { wordStats, ...stored } = results;
  const gameResult = new Result({
    ...stored,
    integrityVersion: integrity.integrityVersion,
    ...(replay.valid
      ? {
          keystrokes: run.keys,
          keyPresses: replay.keyPresses,
          keyErrors: replay.keyErrors,
          digraphErrors: replay.digraphErrors,
        }
      : {}),
    rules: normaliseRules(run.rules),
    leadMs: run.leadMs || 0,
    gameMode: run.gameMode,
    wordCount: run.wordCount,
    timeMax: run.timeMax,
    modifiers: modifiersOf(run),
    textCategory: run.passage?.category || null,
    dailyDate: run.dailyDate || null,
    migrated: !!migrated,
    userId: userId || run.userId || null,
    sessionId: run._id || null
  });
  const session = run;

  const savedResult = await gameResult.save();

  const lessonId = session.practice?.kind === 'lesson'
    ? session.practice.id
    : session.practice?.kind === 'common-words' ? 'common-words' : null;
  if (lessonId) {
    try {
      const passed = await recordPracticeResult(userId, lessonId, results);
      results.practice = { kind: session.practice.kind, id: lessonId, passed };
    } catch (e) {
      // Progress is best-effort; the run itself is saved.
    }
  }

  if (session.dailyDate) {
    try {
      await recordDailyFinish(userId, session.dailyDate, {
        resultId: savedResult._id,
        wpm: results.wpm,
        accuracy: results.accuracy,
        ranked: integrity.ranked,
      });
    } catch (e) {
      // The result itself is saved; the attempt simply stays unfinished.
    }
  }

  if (session.raceCode) {
    gameEvents.emit('run:finished', {
      userId,
      session,
      results,
      resultId: savedResult._id,
      ranked: integrity.ranked,
    });
  }

  // Update user stats (keep this server-side so clients can't omit it)
  try {
    if (userId) {
      const timeBucket = bucketKey(session.timeMax, PRESET_TIMES);
      const wordsBucket = bucketKey(session.wordCount, PRESET_WORD_COUNTS);
      const modeBucket = session.gameMode || 'words';
      const elapsed = results.elapsedTime || 0;
      const afkT = results.afkTime || 0;
      const afkP = results.afkPeriods || 0;

      // Determine modifier buckets
      const modifierBuckets = [];
      if (session.punctuationEnabled) modifierBuckets.push('punctuation');
      if (session.numbersEnabled) modifierBuckets.push('numbers');
      if (modifierBuckets.length === 0) modifierBuckets.push('none');
      if (session.punctuationEnabled && session.numbersEnabled) modifierBuckets.push('both');

      const incUpdates = {
        'stats.gamesPlayed': 1,
        'stats.totalTimeTyping': elapsed,
        'stats.afkTime': afkT,
        'stats.afkPeriods': afkP,
        [`stats.byTime.${timeBucket}.games`]: 1,
        [`stats.byTime.${timeBucket}.totalTimeTyping`]: elapsed,
        [`stats.byTime.${timeBucket}.afkTime`]: afkT,
        [`stats.byTime.${timeBucket}.afkPeriods`]: afkP,
        [`stats.byMode.${modeBucket}.games`]: 1,
        [`stats.byMode.${modeBucket}.totalTimeTyping`]: elapsed,
        [`stats.byMode.${modeBucket}.afkTime`]: afkT,
        [`stats.byMode.${modeBucket}.afkPeriods`]: afkP,
      };

      const maxUpdates = {
        'stats.highScore': results.score,
        'stats.bestWpm': results.wpm,
        'stats.bestAccuracy': results.accuracy,
        [`stats.byTime.${timeBucket}.highScore`]: results.score,
        [`stats.byTime.${timeBucket}.bestWpm`]: results.wpm,
        [`stats.byTime.${timeBucket}.bestAccuracy`]: results.accuracy,
        [`stats.byMode.${modeBucket}.highScore`]: results.score,
        [`stats.byMode.${modeBucket}.bestWpm`]: results.wpm,
        [`stats.byMode.${modeBucket}.bestAccuracy`]: results.accuracy,
      };

      if (session.gameMode === 'words') {
        incUpdates[`stats.byWords.${wordsBucket}.games`] = 1;
        incUpdates[`stats.byWords.${wordsBucket}.totalTimeTyping`] = elapsed;
        incUpdates[`stats.byWords.${wordsBucket}.afkTime`] = afkT;
        incUpdates[`stats.byWords.${wordsBucket}.afkPeriods`] = afkP;

        maxUpdates[`stats.byWords.${wordsBucket}.highScore`] = results.score;
        maxUpdates[`stats.byWords.${wordsBucket}.bestWpm`] = results.wpm;
        maxUpdates[`stats.byWords.${wordsBucket}.bestAccuracy`] = results.accuracy;
      }

      for (const mod of modifierBuckets) {
        incUpdates[`stats.byModifier.${mod}.games`] = 1;
        incUpdates[`stats.byModifier.${mod}.totalTimeTyping`] = elapsed;
        incUpdates[`stats.byModifier.${mod}.afkTime`] = afkT;
        incUpdates[`stats.byModifier.${mod}.afkPeriods`] = afkP;

        maxUpdates[`stats.byModifier.${mod}.highScore`] = results.score;
        maxUpdates[`stats.byModifier.${mod}.bestWpm`] = results.wpm;
        maxUpdates[`stats.byModifier.${mod}.bestAccuracy`] = results.accuracy;
      }

      // A superhuman run still counts as played, but must not become a
      // personal best that later feeds profiles or rankings.
      const implausible = integrity.flags.includes(INTEGRITY_FLAGS.IMPLAUSIBLE_WPM);
      await User.findByIdAndUpdate(userId, {
        $inc: incUpdates,
        ...(implausible ? {} : { $max: maxUpdates }),
      });
    }
  } catch (e) {
    // Error ignored
  }

  // Badges are evaluated server-side after every saved run. A failure here
  // must not lose the run; the next evaluation (or GET /achievements)
  // catches up because evaluation is idempotent.
  try {
    await recordPlayDay(userId);
    const { newlyUnlocked } = await syncAchievements(userId);
    results.newAchievements = newlyUnlocked;
  } catch (e) {
    results.newAchievements = [];
  }

  // Only update session if we have a DB _id for it
  if (session._id) {
    // session already exists in DB — update it
    await updateSession(session._id, {
      resultsId: savedResult._id,
      typedText: replay.typed,
      incomplete: false,
      dailyDate: null,
      practice: null,
      raceCode: null
    });
  } else {
    // No DB session exists for this run; persist one now that we have a result
    try {
      const sessionData = {
        userId: userId || null,
        text: session.text,
        typedText: replay.typed,
        keys: session.keys,
        keyCount: session.keys.length,
        rules: normaliseRules(session.rules),
        gameMode: session.gameMode,
        wordCount: session.wordCount,
        punctuationEnabled: session.punctuationEnabled || false,
        numbersEnabled: session.numbersEnabled || false,
        timeMax: session.timeMax,
        totalWords: session.totalWords,
        resultsId: savedResult._id,
        incomplete: false
      };

      const persisted = new Session(sessionData);
      await persisted.save();

      // update the saved result.sessionId to point to the new session
      try {
        savedResult.sessionId = persisted._id;
        await savedResult.save();
      } catch (e) {
        // Error ignored
      }

      // update user's lastSession
      try {
        if (userId) {
          await User.findByIdAndUpdate(userId, { $set: { lastSession: persisted._id, lastSessionAt: new Date() } });
        }
      } catch (e) {
        // Error ignored
      }
    } catch (e) {
      // Error ignored
    }
  }

  return results;
};

/**
 * Resets a game session with new text
 */
export const resetSession = async (sessionId, options = {}) => {
  const session = await getSession(sessionId);
  if (!session) return null;

  // Handle legacy call with single argument (if any) or extract from options object
  // Note: options might be just the wordCount number if called with legacy signature, so we handle that
  const overrides = typeof options === 'number' ? { wordCount: options } : (options || {});

  const effectiveGameMode = overrides.gameMode !== undefined ? overrides.gameMode : session.gameMode;
  const effectiveWordCount = overrides.wordCount !== undefined ? overrides.wordCount : session.wordCount;
  const effectivePunctuation = overrides.punctuationEnabled !== undefined ? overrides.punctuationEnabled : session.punctuationEnabled;
  const effectiveNumbers = overrides.numbersEnabled !== undefined ? overrides.numbersEnabled : session.numbersEnabled;
  const effectiveTimeMax = overrides.timeMax !== undefined ? overrides.timeMax : session.timeMax;
  const effectiveCategory = overrides.textCategory !== undefined ? overrides.textCategory : (session.textCategory || DEFAULT_TEXT_CATEGORY);
  const effectiveRules = normaliseRules({ ...(session.rules?.toObject?.() ?? session.rules ?? {}), ...(overrides.rules || {}) });

  let text, totalWords, passage = null;
  if (overrides.clientText) {
    text = overrides.clientText;
    totalWords = overrides.clientTotalWords ?? overrides.clientText.trim().split(/\s+/).filter(Boolean).length;
  } else {
    ({ text, totalWords, passage } = generateText(
      effectiveGameMode,
      effectiveWordCount,
      effectivePunctuation,
      effectiveNumbers,
      effectiveCategory
    ));
  }

  return await updateSession(sessionId, {
    text,
    typedText: '',
    totalWords,
    // Update all settings in the session
    gameMode: effectiveGameMode,
    wordCount: effectiveWordCount,
    punctuationEnabled: effectivePunctuation,
    numbersEnabled: effectiveNumbers,
    timeMax: effectiveTimeMax,
    textCategory: effectiveCategory,
    passage,
    rules: effectiveRules,
    textSource: overrides.clientText ? 'client' : 'server',
    ...FRESH_RUN,
    dailyDate: null,
    practice: null,
    raceCode: null,
    incomplete: true,
  });
};

/**
 * Updates game settings and regenerates text if needed
 */
export const updateSettings = async (sessionId, settings) => {
  const session = await getSession(sessionId);
  if (!session) return null;

  const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled, textCategory, rules } = settings;

  let textChanged = false;
  const updates = {};

  if (rules !== undefined) {
    const next = normaliseRules({ ...(session.rules?.toObject?.() ?? session.rules ?? {}), ...rules });
    const prev = normaliseRules(session.rules);
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      // Keys already typed were judged under the old rules: start over.
      Object.assign(updates, { rules: next, typedText: '', incomplete: true }, FRESH_RUN);
    }
  }

  if (gameMode !== undefined && gameMode !== session.gameMode) {
    updates.gameMode = gameMode;
    textChanged = true;
  }
  if (wordCount !== undefined && wordCount !== session.wordCount) {
    updates.wordCount = wordCount;
    textChanged = true;
  }
  if (timeMax !== undefined) {
    updates.timeMax = timeMax;
  }
  if (punctuationEnabled !== undefined && punctuationEnabled !== session.punctuationEnabled) {
    updates.punctuationEnabled = punctuationEnabled;
    if ((updates.gameMode || session.gameMode) === 'words') {
      textChanged = true;
    }
  }
  if (numbersEnabled !== undefined && numbersEnabled !== session.numbersEnabled) {
    updates.numbersEnabled = numbersEnabled;
    if ((updates.gameMode || session.gameMode) === 'words') {
      textChanged = true;
    }
  }
  if (textCategory !== undefined && textCategory !== (session.textCategory || DEFAULT_TEXT_CATEGORY)) {
    updates.textCategory = textCategory;
    if ((updates.gameMode || session.gameMode) === 'phrases') {
      textChanged = true;
    }
  }

  if (textChanged) {
    const effectiveGameMode = updates.gameMode || session.gameMode;
    const effectiveWordCount = updates.wordCount || session.wordCount;
    const effectivePunctuation = updates.punctuationEnabled !== undefined ? updates.punctuationEnabled : session.punctuationEnabled;
    const effectiveNumbers = updates.numbersEnabled !== undefined ? updates.numbersEnabled : session.numbersEnabled;

    const effectiveCategory = updates.textCategory || session.textCategory || DEFAULT_TEXT_CATEGORY;

    const { text, totalWords, passage } = generateText(
      effectiveGameMode,
      effectiveWordCount,
      effectivePunctuation,
      effectiveNumbers,
      effectiveCategory
    );

    updates.text = text;
    updates.passage = passage;
    updates.typedText = '';
    updates.totalWords = totalWords;
    updates.textSource = 'server';
    Object.assign(updates, FRESH_RUN);
    updates.currentIndex = 0;
    updates.mistakes = 0;
    updates.successes = 0;
    updates.incomplete = true;
  }

  if (Object.keys(updates).length > 0) {
    // Changing any setting abandons a daily or practice run.
    updates.dailyDate = null;
    updates.practice = null;
    updates.raceCode = null;
    return await updateSession(sessionId, updates);
  }

  return session;
};

/**
 * Adopts a guest's in-progress run as the player's session after signing in,
 * keys and clock included, so the countdown and typed progress carry on.
 * Guest text counts as client text: the run is saved but never ranked.
 */
export const adoptGuestRun = async (userId, guest) => {
  const updates = {
    text: guest.text,
    typedText: guest.typedText || '',
    totalWords: guest.totalWords,
    gameMode: guest.gameMode,
    wordCount: guest.wordCount,
    timeMax: guest.timeMax,
    punctuationEnabled: guest.punctuationEnabled,
    numbersEnabled: guest.numbersEnabled,
    textCategory: guest.textCategory || DEFAULT_TEXT_CATEGORY,
    passage: guest.passage || null,
    rules: normaliseRules(guest.rules),
    textSource: 'client',
    keys: [...guest.keys],
    keyCount: guest.keys.length,
    leadMs: 0,
    startedAt: guest.startedAt || null,
    dailyDate: null,
    practice: null,
    raceCode: null,
    incomplete: true,
    resultsId: null,
  };

  let session = await getSessionByUserId(userId);
  if (!session) {
    session = await createSession({ ...updates, persist: true }, userId);
  }
  const updated = await updateSession(session._id, updates);
  return { ...getState(updated), sessionId: updated._id.toString() };
};

/**
 * Gets top scores for leaderboard
 */
export const getLeaderboard = async (limit = 10, gameMode = null) => {
  const query = gameMode ? { gameMode } : {};
  return await Result.find(query)
    .sort({ score: -1 })
    .limit(limit)
    .select('score wpm cpm accuracy gameMode timeMax createdAt');
};
