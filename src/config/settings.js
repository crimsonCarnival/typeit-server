/**
 * Player settings kept on the account so they follow the player across
 * devices. Each key lists its allowed values; anything else is rejected.
 */
export const SETTINGS_SCHEMA = Object.freeze({
  theme: ['crimson', 'ocean', 'forest', 'light'],
  typingFont: ['default', 'mono', 'serif'],
  fontSize: ['s', 'm', 'l', 'xl'],
  liveStats: ['all', 'speed', 'timer'],
  soundPack: ['typewriter', 'click', 'soft'],
  keyboardLayout: ['qwerty', 'dvorak', 'colemak'],
  caretStyle: ['line', 'block', 'underline', 'off'],
  difficulty: ['normal', 'hardcore'],
  stopOnError: ['off', 'letter', 'word'],
  spaceSkips: [true, false],
  soundMuted: [true, false],
});
