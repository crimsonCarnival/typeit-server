import Session from '../models/session.model.js';
import {
  createSession,
  getSession,
  getSessionByUserId,
  deleteSession,
  endGame,
  resetSession,
  updateSettings,
  getState,
  getLeaderboard,
  generateText,
  generateSessionId,
  validateElapsed,
  adoptGuestRun,
} from '../services/game.service.js';
import { appendKeys } from '../services/run.service.js';
import { normaliseRules } from '../services/run-engine.js';
import { deleteGuestRun, getGuestRun, putGuestRun } from '../services/run-store.service.js';
import { gameEvents } from '../events/game-events.js';
import Result from '../models/result.model.js';
import { clampInt, errorMessage } from '../utils/http.js';
import { CLIENT_TEXT_MAX, parseGameSettings } from '../utils/validate.js';

const badRequest = (res, error) => res.status(400).json({ success: false, error });

/** Keeps a guest run in memory so its keys can be streamed and scored. */
const registerGuest = (state) => {
  const sessionId = state.sessionId || generateSessionId();
  putGuestRun(sessionId, { ...state, sessionId, userId: null, incomplete: true });
  return { ...state, sessionId };
};

/** Creates a guest run from validated settings (server text unless the client brought its own). */
const newGuestRun = ({ gameMode, wordCount = 50, timeMax = 120, punctuationEnabled = false, numbersEnabled = false, textCategory, language, codeLanguage, rules, clientText, clientTotalWords }) => {
  const generated = clientText
    ? { text: clientText, totalWords: clientTotalWords ?? clientText.trim().split(/\s+/).length, passage: null }
    : generateText(gameMode, wordCount, punctuationEnabled, numbersEnabled, { textCategory, language, codeLanguage });
  return registerGuest({
    ...generated,
    gameMode,
    wordCount,
    timeMax,
    punctuationEnabled,
    numbersEnabled,
    textCategory,
    language,
    codeLanguage,
    rules: normaliseRules(rules),
    textSource: clientText ? 'client' : 'server',
  });
};

/** The run a request refers to: the player's session, or a guest run by id. */
const activeRun = async (req) => {
  if (req.user?._id) {
    const session = await getSessionByUserId(req.user._id);
    return session && session.incomplete ? session : null;
  }
  const run = getGuestRun(req.body?.sessionId);
  return run && !run.finished ? run : null;
};

/** Answers a failed key append (bad batch or offset mismatch); true if it answered. */
const answerAppendFailure = (res, out) => {
  if (out.error) {
    badRequest(res, out.error);
    return true;
  }
  if (out.conflict !== undefined) {
    // The client resends from the offset the server holds.
    res.status(409).json({ success: false, error: 'Key offset mismatch', data: { keyCount: out.conflict } });
    return true;
  }
  return false;
};

/**
 * Game Controller - Handles HTTP request/response logic
 */
const gameController = {
  /**
   * Creates or resumes a game session
   * POST /api/game/start
   *
   * Authenticated users get or reuse a single server-side session (resume
   * support). Unauthenticated users receive a transient in-memory session.
   */
  startGame: async (req, res) => {
    try {
      const parsed = parseGameSettings(req.body);
      if (parsed.error) return badRequest(res, parsed.error);
      const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled, textCategory, language, codeLanguage, clientText, clientTotalWords } = parsed.settings;
      const persist = req.body?.persist === true;
      const { rules } = parsed.settings;
      const userId = req.user?._id || null;
      const options = { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled, textCategory, language, codeLanguage, rules };
      // When the client provides pre-generated text (phrases + non-default source),
      // forward it so createSession skips server-side text generation.
      if (clientText) {
        options.clientText = clientText;
        options.clientTotalWords = clientTotalWords;
      }

      if (userId) {
        let session = await getSessionByUserId(userId);
        // A daily or practice run in progress outranks whatever settings the
        // client defaults to (after a reload, or when the run was started
        // from another page before the game initialised): resume it unchanged.
        if (session && session.incomplete && (session.dailyDate || session.practice || session.raceCode)) {
          return res.json({ success: true, data: getState(session) });
        }
        if (session && session.incomplete) {
          // If the client explicitly passed text or if any setting changed, regenerate/reset it
          if (
            options.clientText ||
            session.gameMode !== options.gameMode ||
            session.wordCount !== options.wordCount ||
            session.punctuationEnabled !== options.punctuationEnabled ||
            session.numbersEnabled !== options.numbersEnabled ||
            session.timeMax !== options.timeMax ||
            ['textCategory', 'language', 'codeLanguage'].some((f) => options[f] !== undefined && options[f] !== session[f]) ||
            (options.rules !== undefined &&
              JSON.stringify(normaliseRules({ ...(session.rules?.toObject?.() ?? {}), ...options.rules })) !== JSON.stringify(normaliseRules(session.rules)))
          ) {
            session = await resetSession(session._id, options);
          }
          // Resume the in-progress (or newly reset) session.
          return res.json({ success: true, data: getState(session) });
        }
        if (session) {
          // A previous session exists but is complete; regenerate fresh text on it.
          const reset = await resetSession(session._id, options);
          return res.json({ success: true, data: getState(reset) });
        }
        // No session yet: persist a new one.
        const created = await createSession({ ...options, persist: true }, userId);
        return res.json({ success: true, data: getState(created) });
      }

      const session = await createSession({ ...options, persist }, userId);
      return res.json({
        success: true,
        data: getState(registerGuest(session))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  },

  /**
   * Streams the keys typed since the last call and answers with live stats.
   * POST /api/game/progress  { sessionId? (guests), from, keys, elapsedMs, leadMs? }
   *
   * The first batch starts the run on the server clock. A `from` that doesn't
   * match the keys the server holds answers 409 with the expected offset.
   */
  progress: async (req, res) => {
    try {
      const run = await activeRun(req);
      if (!run) return res.status(404).json({ success: false, error: 'No active run' });

      const { from, keys, elapsedMs, leadMs } = req.body || {};
      const out = await appendKeys(run, { from, keys, elapsedMs, leadMs });
      if (answerAppendFailure(res, out)) return;

      if (req.user?._id && run.raceCode) {
        gameEvents.emit('run:progress', {
          userId: String(req.user._id),
          code: run.raceCode,
          index: out.replay.position,
          accuracy: out.live.accuracy,
        });
      }
      return res.json({ success: true, data: { keyCount: out.keyCount, live: out.live } });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  },

  /**
   * Gets current game state
   * GET /api/game/state
   */
  getGameState: async (req, res) => {
    try {
      const userId = req.user?._id || null;
      const { sessionData } = req.body;

      // For authenticated users, look up session by userId
      if (userId) {
        const session = await getSessionByUserId(userId);
        if (!session) {
          return res.status(404).json({
            success: false,
            error: 'Game session not found. Please start a new game.'
          });
        }
        return res.json({
          success: true,
          data: getState(session)
        });
      }

      // For unauthenticated users, use session data from request
      if (!sessionData) {
        return res.status(400).json({
          success: false,
          error: 'Session data required for unauthenticated users'
        });
      }

      res.json({
        success: true,
        data: getState(sessionData)
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  },

  /**
   * Ends the run. The server scores it from the keystroke log it holds (plus
   * any last keys sent here); the client's own numbers are never used.
   * POST /api/game/end  { sessionId? (guests), from, keys, typedText, elapsedMs }
   */
  endGame: async (req, res) => {
    try {
      const { typedText, elapsedMs, from, keys = [] } = req.body || {};
      const userId = req.user?._id || null;

      if (typeof typedText !== 'string' || typedText.length > CLIENT_TEXT_MAX) {
        return badRequest(res, 'Typed text is required');
      }

      let run = await activeRun(req);
      if (!run) {
        return res.status(400).json({ success: false, error: 'No active session. Please start a new game.' });
      }
      const timing = validateElapsed(elapsedMs, run.timeMax);
      if (!timing.ok) return badRequest(res, timing.error);

      if (from !== undefined) {
        const out = await appendKeys(run, { from, keys, elapsedMs });
        if (answerAppendFailure(res, out)) return;
        run = out.run;
      }

      // Practising without saving: score it like a guest run, keep nothing.
      const discard = !!userId && req.body?.discard === true && !run.dailyDate && !run.raceCode && !run.practice;
      const results = await endGame(run, { typedText, elapsedMs, userId: discard ? null : userId });
      if (discard) {
        // Nothing to resume after a reload: the keys go with the unsaved run.
        await Session.updateOne({ _id: run._id }, { $set: { keys: [], keyCount: 0, startedAt: null, typedText: '' } });
        return res.json({ success: true, data: { ...results, discarded: true } });
      }
      if (!userId) {
        // Kept so the run can be saved if the guest signs in now.
        run.finished = { typedText, elapsedMs };
        return res.json({
          success: true,
          data: results,
          message: 'Game completed. Log in to save your score to your profile.'
        });
      }
      return res.json({ success: true, data: results });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  },

  /**
   * Resets the game
   * POST /api/game/reset
   */
  resetGame: async (req, res) => {
    try {
      const userId = req.user?._id || null;
      const parsed = parseGameSettings(req.body);
      if (parsed.error) return badRequest(res, parsed.error);
      const { wordCount, gameMode, timeMax, punctuationEnabled, numbersEnabled, textCategory, language, codeLanguage, clientText, clientTotalWords } = parsed.settings;

      // For authenticated users, look up and reset their session
      if (userId) {
        const session = await getSessionByUserId(userId);
        if (session) {
          const updatedSession = await resetSession(session._id, {
            wordCount,
            gameMode,
            timeMax,
            punctuationEnabled,
            numbersEnabled,
            textCategory,
            language,
            codeLanguage,
            rules: parsed.settings.rules,
            clientText,
            clientTotalWords
          });
          return res.json({
            success: true,
            data: getState(updatedSession)
          });
        }
      }

      // Guests: a fresh run held in memory until it is scored.
      if (!gameMode) return badRequest(res, 'Game settings required');
      res.json({ success: true, data: getState(newGuestRun(parsed.settings)) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  },

  /**
   * Refreshes text (generates new text same mode)
   * POST /api/game/refresh
   */
  refreshText: async (req, res) => {
    try {
      const userId = req.user?._id || null;
      const parsed = parseGameSettings(req.body);
      if (parsed.error) return badRequest(res, parsed.error);
      const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled, textCategory } = parsed.settings;

      // For authenticated users, look up and refresh their session
      if (userId) {
        const session = await getSessionByUserId(userId);
        if (session) {
          const refreshed = await resetSession(session._id);
          return res.json({
            success: true,
            data: getState(refreshed)
          });
        }
      }

      // Guests: a fresh run held in memory until it is scored.
      if (!gameMode) return badRequest(res, 'Game settings required');
      res.json({ success: true, data: getState(newGuestRun(parsed.settings)) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  },

  /**
   * Updates game settings
   * PATCH /api/game/settings
   */
  updateSettings: async (req, res) => {
    try {
      const userId = req.user?._id || null;
      const parsed = parseGameSettings(req.body);
      if (parsed.error) return badRequest(res, parsed.error);
      const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled, textCategory } = parsed.settings;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'Settings can only be updated for authenticated users'
        });
      }

      let session = await getSessionByUserId(userId);

      // If no session exists, create one with the provided settings
      if (!session) {
        session = await createSession(
          {
            gameMode: gameMode || 'phrases',
            wordCount: wordCount || 50,
            timeMax: timeMax || 120,
            punctuationEnabled: punctuationEnabled || false,
            numbersEnabled: numbersEnabled || false,
            textCategory,
            language: parsed.settings.language,
            codeLanguage: parsed.settings.codeLanguage,
            persist: true
          },
          userId
        );
        return res.json({
          success: true,
          data: getState(session)
        });
      }

      const updatedSession = await updateSettings(session._id, {
        gameMode,
        wordCount,
        timeMax,
        punctuationEnabled,
        numbersEnabled,
        textCategory,
        language: parsed.settings.language,
        codeLanguage: parsed.settings.codeLanguage,
        rules: parsed.settings.rules
      });

      res.json({
        success: true,
        data: getState(updatedSession)
      });
    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  },

  /**
   * Deletes a game session
   * DELETE /api/game/delete
   */
  deleteGame: async (req, res) => {
    try {
      const userId = req.user?._id || null;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'Only authenticated users can delete sessions'
        });
      }

      const session = await getSessionByUserId(userId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Game session not found'
        });
      }

      const deleted = await deleteSession(session._id);

      res.json({
        success: true,
        data: { deleted }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  },

  /**
   * Carries a guest run into the signed-in player's account.
   * POST /api/game/migrate  { guestSessionId }
   *
   * A finished guest run is scored again from its log and saved as a result;
   * one still in progress becomes the player's session (keys and clock kept).
   * Both count as client text, so they are never ranked.
   */
  migrateGame: async (req, res) => {
    try {
      const userId = req.user._id;
      const guest = getGuestRun(req.body?.guestSessionId);
      if (!guest) return res.status(404).json({ success: false, error: 'Guest run expired' });

      if (guest.finished) {
        const run = { ...guest, textSource: 'client' };
        const results = await endGame(run, {
          typedText: guest.finished.typedText,
          elapsedMs: guest.finished.elapsedMs,
          userId,
          migrated: true,
        });
        deleteGuestRun(guest.sessionId);
        return res.json({ success: true, data: { results } });
      }

      const state = await adoptGuestRun(userId, guest);
      deleteGuestRun(guest.sessionId);
      return res.json({ success: true, data: state });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  },

  /**
   * Gets leaderboard
   * GET /api/game/leaderboard
   */
  getLeaderboard: async (req, res) => {
    try {
      const { limit = 10, gameMode } = req.query;
      const mode = gameMode === 'words' || gameMode === 'phrases' ? gameMode : null;
      const leaderboard = await getLeaderboard(clampInt(limit, 10, 1, 100), mode);

      res.json({
        success: true,
        data: leaderboard
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  }
};

export default gameController;
