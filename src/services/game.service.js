import { paragraphs } from '../data/paragraphs.js';
import { generateWordContent } from '../data/words.js';
import Session from '../models/session.model.js';
import Result from '../models/result.model.js';
import User from '../models/user.model.js';

// Preset categories used to bucket stats. Values outside these are 'custom'.
const PRESET_TIMES = [30, 60, 90, 120];
const PRESET_WORD_COUNTS = [25, 50, 75, 100];

/**
 * Picks the stat bucket key for a numeric setting.
 */
const bucketKey = (value, presets) =>
  presets.includes(value) ? String(value) : 'custom';

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
 * Validates client-supplied timing against the session's configured max time.
 * Both timestamps are client-clock values, so the delta is immune to clock skew,
 * but we still bound it so impossible scores can't be fabricated.
 */
export const validateGameTiming = (startTime, endTime, timeMax = 120) => {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return { ok: false, error: 'Invalid game timing' };
  }
  const elapsedMs = endTime - startTime;
  const minMs = 1000; // at least one second of active play
  const maxMs = (timeMax + 60) * 1000; // generous slack beyond the timer
  if (elapsedMs < minMs || elapsedMs > maxMs) {
    return { ok: false, error: 'Invalid elapsed time' };
  }
  return { ok: true, elapsedMs };
};

/**
 * Generates text content based on game mode and settings
 */
export const generateText = (gameMode, wordCount, punctuationEnabled, numbersEnabled) => {
  let content = '';

  if (gameMode === 'words') {
    // Words mode: generate a word list then apply modifier toggles.
    content = generateWordContent(wordCount, {
      punctuation: punctuationEnabled,
      numbers: numbersEnabled
    });

    // Strip anything the word generator may have included if toggles are off.
    if (!punctuationEnabled) content = stripPunctuation(content);
    if (!numbersEnabled)     content = content.replace(/[0-9]/g, '');
  } else {
    // Phrases mode: use a real prose paragraph exactly as written.
    // Punctuation and numbers are part of the original text and are always kept.
    const paragraphIndex = Math.floor(Math.random() * paragraphs.length);
    content = paragraphs[paragraphIndex];
  }

  // Normalise whitespace (may have been introduced by stripping).
  const text = content.replace(/\s+/g, ' ').trim();
  const totalWords = text.split(/\s+/).length;

  return { text, totalWords };
};

/**
 * Calculates final game results from client-submitted data
 * Server recalculates everything to prevent cheating
 */
export const calculateResults = (session, typedText, startTime, endTime, afkTime = 0, afkPeriods = 0, performance = [], penalty = 0, rawKeystrokes = 0) => {
  let serverMistakes = 0;
  let serverSuccesses = 0;

  const typedLength = typedText ? typedText.length : 0;
  for (let i = 0; i < typedLength; i++) {
    if (i < session.text.length && typedText[i] === session.text[i]) {
      serverSuccesses++;
    } else {
      serverMistakes++;
    }
  }

  const elapsedMs = (endTime && startTime) ? (endTime - startTime) : 1000;
  const elapsedSeconds = Math.max(elapsedMs / 1000, 1);

  // If rawKeystrokes is provided by the client, it represents all forward typing strokes.
  // Use it to calculate true accuracy, preventing cheating via backspaces.
  const totalTyped = rawKeystrokes > 0 ? rawKeystrokes : (serverSuccesses + serverMistakes);
  const calculatedMistakes = rawKeystrokes > 0 ? Math.max(0, rawKeystrokes - serverSuccesses) : serverMistakes;
  const accuracy = totalTyped > 0 ? (serverSuccesses / totalTyped) * 100 : 0;

  const currentText = typedText || '';
  const rawChars = currentText.length;
  
  const correctChars = serverSuccesses;

  const cpm = Math.floor(correctChars * (60 / elapsedSeconds)) || 0;
  const wpm = Math.floor(cpm / 5) || 0;
  const rawWpm = elapsedSeconds > 0 ? Math.floor((rawChars / 5) / (elapsedSeconds / 60)) || 0 : 0;

  const speedMultiplier = wpm / 10;
  const accuracyDecimal = accuracy / 100;

  const requiredWPM = (session.totalWords * 60) / session.timeMax;
  const difficultyFactor = Math.min(Math.max(requiredWPM / 40, 0.25), 2.0);

  // Use exponential accuracy (cubed) to heavily penalize low accuracy
  // This rewards precision: 90% acc becomes 0.72 multiplier, 50% becomes 0.125
  const accuracyFactor = Math.pow(accuracyDecimal, 3);
  const finalScore = Math.max(0, Math.round(serverSuccesses * speedMultiplier * accuracyFactor * difficultyFactor) - (penalty || 0));

  const completionPercentage = session.text.length > 0
    ? Math.min((typedLength / session.text.length) * 100, 100)
    : 0;

  // Calculate remaining time (in seconds)
  const remainingTime = Math.max(0, session.timeMax - Math.floor(elapsedSeconds));

  // Convert afkTime from milliseconds to seconds (preserve decimals)
  const afkTimeSeconds = afkTime / 1000;

  // Calculate consistency based on standard deviation of WPM samples
  let consistency = 0;
  if (performance && performance.length > 0) {
    const wpmValues = performance.map(p => p.rawWpm);
    // Filter out initial ramp-up samples if needed, but for now we take all
    if (wpmValues.length > 0) {
      const mean = wpmValues.reduce((a, b) => a + b, 0) / wpmValues.length;

      if (mean > 0) {
        const variance = wpmValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / wpmValues.length;
        const stdDev = Math.sqrt(variance);
        // Coefficient of Variation (CV) = StdDev / Mean
        // Consistency = 100 - (CV * 100)
        // Example: Mean 60, StdDev 6 -> CV 0.1 -> Consistency 90%
        const cv = stdDev / mean;
        consistency = Math.max(0, 100 - (cv * 100));
      }
    }
  }

  // Characters never reached in the source text (MonkeyType-style "missed").
  const missedChars = Math.max(0, session.text.length - typedLength);

  // Highest WPM reached during the test, from performance samples.
  const highestWpm = performance && performance.length > 0
    ? Math.max(...performance.map(p => p.wpm || 0))
    : wpm;

  return {
    score: finalScore,
    wpm,
    rawWpm,
    cpm,
    highestWpm,
    accuracy: parseFloat(accuracy.toFixed(2)),
    mistakes: calculatedMistakes,
    successes: serverSuccesses,
    missed: missedChars,
    elapsedTime: Math.floor(elapsedSeconds),
    completionPercentage: parseFloat(completionPercentage.toFixed(2)),
    totalWords: session.totalWords,
    difficultyFactor: parseFloat(difficultyFactor.toFixed(2)),
    remainingTime,
    afkTime: afkTimeSeconds,
    afkPeriods,
    consistency: parseFloat(consistency.toFixed(2))
  };
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
    persist = false,
    clientText,
    clientTotalWords,
  } = options;

  // Use client-provided text (e.g. txtgen phrases) when available;
  // otherwise fall back to server-side generation.
  let text, totalWords;
  if (clientText) {
    text = clientText;
    totalWords = clientTotalWords ?? clientText.trim().split(/\s+/).filter(Boolean).length;
  } else {
    ({ text, totalWords } = generateText(gameMode, wordCount, punctuationEnabled, numbersEnabled));
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
 * Ends a game and saves the result
 * Creates Result first, then updates Session with resultsId
 */
export const endGame = async (session, typedText, startTime, endTime, userId = null, afkTime = 0, afkPeriods = 0, performance = [], penalty = 0, rawKeystrokes = 0, migrated = false) => {
  const results = calculateResults(session, typedText, startTime, endTime, afkTime, afkPeriods, performance, penalty, rawKeystrokes);

  // If no authenticated user, do not persist anything — just return computed results
  if (!userId) {
    return results;
  }

  // Authenticated user: persist result and update session if present in DB
  const gameResult = new Result({
    ...results,
    gameMode: session.gameMode,
    wordCount: session.wordCount,
    timeMax: session.timeMax,
    performance: performance || [],
    migrated: !!migrated,
    userId: userId || session.userId || null,
    sessionId: session._id || null
  });

  const savedResult = await gameResult.save();

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

      await User.findByIdAndUpdate(userId, {
        $inc: incUpdates,
        $max: maxUpdates,
      });
    }
  } catch (e) {
    // Error ignored
  }

  // Only update session if we have a DB _id for it
  if (session._id) {
    // session already exists in DB — update it
    await updateSession(session._id, {
      isTyping: false,
      resultsId: savedResult._id,
      typedText: typedText || '',
      incomplete: false
    });
  } else {
    // No DB session exists for this run; persist one now that we have a result
    try {
      const sessionData = {
        userId: userId || null,
        text: session.text,
        typedText: typedText || '',
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

  let text, totalWords;
  if (overrides.clientText) {
    text = overrides.clientText;
    totalWords = overrides.clientTotalWords ?? overrides.clientText.trim().split(/\s+/).filter(Boolean).length;
  } else {
    ({ text, totalWords } = generateText(
      effectiveGameMode,
      effectiveWordCount,
      effectivePunctuation,
      effectiveNumbers
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
    incomplete: true,
  });
};

/**
 * Updates game settings and regenerates text if needed
 */
export const updateSettings = async (sessionId, settings) => {
  const session = await getSession(sessionId);
  if (!session) return null;

  const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled } = settings;

  let textChanged = false;
  const updates = {};

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

  if (textChanged) {
    const effectiveGameMode = updates.gameMode || session.gameMode;
    const effectiveWordCount = updates.wordCount || session.wordCount;
    const effectivePunctuation = updates.punctuationEnabled !== undefined ? updates.punctuationEnabled : session.punctuationEnabled;
    const effectiveNumbers = updates.numbersEnabled !== undefined ? updates.numbersEnabled : session.numbersEnabled;

    const { text, totalWords } = generateText(
      effectiveGameMode,
      effectiveWordCount,
      effectivePunctuation,
      effectiveNumbers
    );

    updates.text = text;
    updates.typedText = '';
    updates.totalWords = totalWords;
    updates.currentIndex = 0;
    updates.mistakes = 0;
    updates.successes = 0;
    updates.incomplete = true;
  }

  if (Object.keys(updates).length > 0) {
    return await updateSession(sessionId, updates);
  }

  return session;
};

/**
 * Adopts a guest game into an authenticated user's session so the player can
 * continue (or persist) the work they did before signing up / signing in.
 */
export const migrateSession = async (userId, payload) => {
  const {
    text,
    typedText = '',
    totalWords,
    gameMode,
    wordCount,
    timeMax,
    timeLeft,
    punctuationEnabled,
    numbersEnabled,
  } = payload;

  if (!text) return null;

  const updates = {
    text,
    typedText,
    totalWords,
    gameMode,
    wordCount,
    timeMax,
    timeLeft: typeof timeLeft === 'number' ? timeLeft : timeMax,
    punctuationEnabled,
    numbersEnabled,
    incomplete: true,
    resultsId: null,
  };

  let session = await getSessionByUserId(userId);
  let updated;
  if (session) {
    updated = await updateSession(session._id, updates);
  } else {
    const created = await createSession(
      { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled, persist: true },
      userId
    );
    updated = await updateSession(created._id, updates);
  }

  return {
    ...getState(updated),
    sessionId: updated._id.toString(),
  };
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
