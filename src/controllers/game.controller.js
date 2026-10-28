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
  calculateResults,
  generateSessionId,
  updateSession,
  validateGameTiming,
  migrateSession,
  beginSession,
} from '../services/game.service.js';
import Result from '../models/result.model.js';
import { clampInt, errorMessage } from '../utils/http.js';
import { CLIENT_TEXT_MAX, TIME_MAX_MAX, parseGameSettings } from '../utils/validate.js';
import { MAX_KEYSTROKES } from '../config/integrity.js';

// One sample per second, plus slack.
const MAX_PERFORMANCE_SAMPLES = TIME_MAX_MAX + 5;

const badRequest = (res, error) => res.status(400).json({ success: false, error });

const isNonNegative = (v) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

/**
 * Shape checks for POST /game/end (and a migrated finished run). Values are
 * re-derived server-side; this only rejects payloads no honest client sends.
 */
const checkEndPayload = (body) => {
  const { typedText, text, afkTime, afkPeriods, penalty, rawKeystrokes, performance, keystrokes } = body || {};
  if (typedText.length > CLIENT_TEXT_MAX) return 'Typed text is too long';
  if (text !== undefined && (typeof text !== 'string' || text.length > CLIENT_TEXT_MAX)) return 'Invalid text';
  if (![afkTime, afkPeriods, penalty, rawKeystrokes].every(isNonNegative)) return 'Invalid run counters';
  if (performance !== undefined && (!Array.isArray(performance) || performance.length > MAX_PERFORMANCE_SAMPLES)) {
    return 'Invalid performance samples';
  }
  if (keystrokes !== undefined && keystrokes !== null && (!Array.isArray(keystrokes) || keystrokes.length > MAX_KEYSTROKES)) {
    return 'Invalid keystroke log';
  }
  return null;
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
      const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled, clientText, clientTotalWords } = parsed.settings;
      const persist = req.body?.persist === true;
      const userId = req.user?._id || null;
      const options = { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled };
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
            session.timeMax !== options.timeMax
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
        data: getState(session)
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error)
      });
    }
  },

  /**
   * Marks the first keystroke of the current run on the server clock.
   * POST /api/game/begin
   */
  beginGame: async (req, res) => {
    try {
      const session = await beginSession(req.user._id);
      if (!session) {
        return res.status(400).json({ success: false, error: 'No active session. Please start a new game.' });
      }
      return res.json({ success: true });
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
   * Ends the game and calculates final score (server-side validation)
   * POST /api/game/end
   *
   * Authenticated users are only allowed to end games against a server-side
   * session (created via /game/start with persist), so the scored text and
   * timing are never trusted from the client. Unauthenticated games have no
   * server state and are computed in-memory only.
   */
  endGame: async (req, res) => {
    try {
      const { typedText, startTime, endTime, gameMode, wordCount, timeMax, text, totalWords, afkTime = 0, afkPeriods = 0, performance = [], penalty = 0, rawKeystrokes = 0, keystrokes = null } = req.body;
      const userId = req.user?._id || null;

      if (typeof typedText !== 'string') {
        return res.status(400).json({ success: false, error: 'Typed text is required' });
      }
      const invalid = checkEndPayload(req.body);
      if (invalid) return badRequest(res, invalid);

      if (userId) {
        const session = await getSessionByUserId(userId);
        if (!session || !session.incomplete) {
          return res.status(400).json({
            success: false,
            error: 'No active session. Please start a new game.'
          });
        }

        const timing = validateGameTiming(startTime, endTime, session.timeMax);
        if (!timing.ok) {
          return res.status(400).json({ success: false, error: timing.error });
        }
        if (typedText.length > session.text.length) {
          return res.status(400).json({
            success: false,
            error: 'Typed text cannot exceed the session text'
          });
        }

        const results = await endGame(session, typedText, startTime, endTime, userId, afkTime, afkPeriods, Array.isArray(performance) ? performance : [], penalty, rawKeystrokes, false, keystrokes);
        return res.json({ success: true, data: results });
      }

      // Unauthenticated users: validate and only calculate results (no DB writes)
      if (!text || !totalWords) {
        return res.status(400).json({
          success: false,
          error: 'Game data required'
        });
      }

      const effectiveTimeMax = timeMax || 120;
      const timing = validateGameTiming(startTime, endTime, effectiveTimeMax);
      if (!timing.ok) {
        return res.status(400).json({ success: false, error: timing.error });
      }

      const tempSession = {
        text,
        totalWords,
        timeMax: effectiveTimeMax,
        gameMode,
        wordCount
      };

      const results = calculateResults(tempSession, typedText, startTime, endTime, afkTime, afkPeriods, Array.isArray(performance) ? performance : [], penalty, rawKeystrokes);

      res.json({
        success: true,
        data: results,
        message: 'Game completed. Log in to save your score to your profile.'
      });
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
      const { wordCount, gameMode, timeMax, punctuationEnabled, numbersEnabled, clientText, clientTotalWords } = parsed.settings;

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
            clientText,
            clientTotalWords
          });
          return res.json({
            success: true,
            data: getState(updatedSession)
          });
        }
      }

      // For unauthenticated sessions, generate text based on request body
      if (!gameMode) {
        return res.status(400).json({
          success: false,
          error: 'Game settings required'
        });
      }

      const { text, totalWords } = generateText(
        gameMode,
        wordCount || 50,
        punctuationEnabled || false,
        numbersEnabled || false
      );

      const newSessionData = {
        text,
        gameMode,
        wordCount: wordCount || 50,
        punctuationEnabled: punctuationEnabled || false,
        numbersEnabled: numbersEnabled || false,
        timeMax: timeMax || 120,
        totalWords,
        userId, // Include userId so isAuthenticated is set correctly
      };

      // Only generate a transient sessionId for unauthenticated flows when requested
      if (!req.body?.noSession) {
        newSessionData.sessionId = generateSessionId();
      }

      res.json({
        success: true,
        data: getState(newSessionData)
      });
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
      const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled } = parsed.settings;

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

      // For unauthenticated sessions, generate text based on request body
      if (!gameMode) {
        return res.status(400).json({
          success: false,
          error: 'Game settings required'
        });
      }

      const { text, totalWords } = generateText(
        gameMode,
        wordCount || 50,
        punctuationEnabled || false,
        numbersEnabled || false
      );

      const newSessionData = {
        text,
        gameMode,
        wordCount: wordCount || 50,
        punctuationEnabled: punctuationEnabled || false,
        numbersEnabled: numbersEnabled || false,
        timeMax: timeMax || 120,
        totalWords,
        userId, // Include userId so isAuthenticated is set correctly
      };

      if (!req.body?.noSession) {
        newSessionData.sessionId = generateSessionId();
      }

      res.json({
        success: true,
        data: getState(newSessionData)
      });
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
      const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled } = parsed.settings;

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
        numbersEnabled
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
   * Saves session state (heartbeat) for authenticated users
   * PATCH /api/game/session
   */
  saveSessionState: async (req, res) => {
    try {
      const userId = req.user?._id || null;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { currentIndex, typedText, timeLeft, isTyping, currentText } = req.body || {};
      for (const value of [typedText, currentText]) {
        if (value !== undefined && (typeof value !== 'string' || value.length > CLIENT_TEXT_MAX)) {
          return badRequest(res, 'Invalid typed text');
        }
      }
      if (currentIndex !== undefined && !Number.isInteger(currentIndex)) return badRequest(res, 'Invalid index');
      if (timeLeft !== undefined && typeof timeLeft !== 'number') return badRequest(res, 'Invalid time');

      const session = await getSessionByUserId(userId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      const updates = {};
      if (currentIndex !== undefined) updates.currentIndex = currentIndex;
      if (typedText !== undefined) updates.typedText = typedText;
      if (timeLeft !== undefined) updates.timeLeft = timeLeft;
      if (isTyping !== undefined) updates.isTyping = isTyping;
      if (currentText !== undefined) updates.currentText = currentText;

      if (Object.keys(updates).length === 0) {
        return res.json({ success: true, data: getState(session) });
      }

      // Mark as incomplete while client is actively working on it, but never
      // reopen a session that already has a saved result (a heartbeat racing
      // with endGame must not resurrect a completed game).
      if (!session.resultsId) {
        updates.incomplete = true;
      }

      const updated = await updateSession(session._id, updates);
      return res.json({ success: true, data: getState(updated) });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
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
   * Migrates a guest game into the authenticated user's account.
   * POST /api/game/migrate
   *
   * Two payload shapes:
   * - `incomplete: true`: adopt the guest's in-progress session (text, typed
   *   progress, settings) so the player can continue where they left off.
   * - `endData`: persist the guest's already-finished game (raw inputs are
   *   re-validated and re-scored server-side) as a result + session.
   */
  migrateGame: async (req, res) => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const payload = req.body || {};
      const parsed = parseGameSettings({ ...payload, clientText: undefined });
      if (parsed.error) return badRequest(res, parsed.error);
      if (typeof payload.text !== 'string' || !payload.text || payload.text.length > CLIENT_TEXT_MAX) {
        return badRequest(res, 'Invalid game data');
      }
      if (payload.typedText !== undefined && typeof payload.typedText !== 'string') {
        return badRequest(res, 'Invalid typed text');
      }

      if (payload.incomplete) {
        const state = await migrateSession(userId, payload);
        if (!state) {
          return res.status(400).json({ success: false, error: 'Invalid game data' });
        }
        return res.json({ success: true, data: state });
      }

      if (payload.endData) {
        const endData = payload.endData;
        const invalid = typeof payload.typedText === 'string'
          ? checkEndPayload({ ...endData, typedText: payload.typedText })
          : 'Invalid typed text';
        if (invalid) return badRequest(res, invalid);
        const timing = validateGameTiming(endData.startTime, endData.endTime, payload.timeMax || 120);
        if (!timing.ok) {
          return res.status(400).json({ success: false, error: timing.error });
        }
        if (typeof payload.typedText !== 'string' || payload.typedText.length > (payload.text || '').length) {
          return res.status(400).json({ success: false, error: 'Invalid typed text' });
        }

        const tempSession = {
          text: payload.text,
          totalWords: payload.totalWords,
          timeMax: payload.timeMax || 120,
          gameMode: payload.gameMode,
          wordCount: payload.wordCount,
        };

        const results = await endGame(
          tempSession,
          payload.typedText,
          endData.startTime,
          endData.endTime,
          userId,
          endData.afkTime || 0,
          endData.afkPeriods || 0,
          Array.isArray(endData.performance) ? endData.performance : [],
          endData.penalty || 0,
          endData.rawKeystrokes || 0,
          true, // migrated = true: this result originated from a guest session
          endData.keystrokes || null
        );

        return res.json({ success: true, data: { results } });
      }

      return res.status(400).json({ success: false, error: 'Invalid migration data' });
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
