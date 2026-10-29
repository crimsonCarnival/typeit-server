/**
 * Player settings kept on the account so they follow the player across
 * devices. Each key lists its allowed values (or a pattern); anything else is rejected.
 */
export const SETTINGS_SCHEMA = Object.freeze({
  // Themes live in the client's catalog (utils/themes.ts); the server only checks the shape.
  theme: /^[a-z0-9-]{1,32}$/,
  typingFont: ['default', 'mono', 'serif'],
  fontSize: ['s', 'm', 'l', 'xl'],
  liveStats: ['all', 'speed', 'timer'],
  soundPack: ['typewriter', 'click', 'soft', 'beep', 'pop', 'sine', 'square', 'triangle', 'sawtooth'],
  keyboardLayout: ['qwerty', 'dvorak', 'colemak'],
  caretStyle: ['line', 'block', 'underline', 'off'],
  difficulty: ['normal', 'hardcore'],
  stopOnError: ['off', 'letter', 'word'],
  spaceSkips: [true, false],
  soundMuted: [true, false],
  soundVolume: [0.1, 0.25, 0.5, 0.75, 1],
  errorSound: [true, false],
  // Seconds left when a warning sounds in a timed test (0 = off).
  timeWarning: [0, 1, 3, 5, 10],
  // Mistakes are not shown while typing.
  blindMode: [true, false],
  // How letters already typed are shown.
  typedEffect: ['keep', 'fade', 'hide'],
  timerColor: ['main', 'text', 'sub'],
  timerOpacity: [0.25, 0.5, 0.75, 1],
  // Esc gives new text and Tab restarts the same text; each can be turned off.
  quickRestart: ['both', 'esc', 'tab', 'off'],
  smoothCaret: ['off', 'slow', 'medium', 'fast'],
  highlightMode: ['letter', 'word'],
  tapeMode: [true, false],
  // A second caret at a steady speed: the player's best, their recent average, their last result, or a set speed.
  paceCaret: ['off', 'pb', 'average', 'last', 'custom'],
  paceCaretWpm: (v) => Number.isInteger(v) && v >= 10 && v <= 300,
  // Expert fails a test when a word is finished with a mistake; master on any wrong key.
  failMode: ['normal', 'expert', 'master'],
  // 0 = off, otherwise the run fails once it falls below (checked after the first seconds).
  minWpm: (v) => Number.isInteger(v) && (v === 0 || (v >= 10 && v <= 300)),
  minAccuracy: (v) => Number.isInteger(v) && (v === 0 || (v >= 50 && v <= 100)),
  // Off: tests are scored but not saved (no stats, rankings, badges or XP).
  saveResults: [true, false],
});
