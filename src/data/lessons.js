/**
 * Finger-placement lessons. Each lesson introduces `focus` keys and may use
 * every key from earlier lessons (`keys`). Text is generated from real words
 * restricted to those keys, padded with short key patterns while the key set
 * is too small for real words. Authored for TypeIt; not from the design
 * canvas, which only names the lesson count.
 *
 * Optional word filters: `containsAny` (word must include one of these
 * strings) and `minLength`.
 */
const HOME_LEFT = 'asdf';
const HOME_RIGHT = 'jkl';
const HOME = 'asdfghjkl';
const TOP = 'qwertyuiop';
const BOTTOM = 'zxcvbnm';

export const LESSONS = Object.freeze([
  { id: 'home-left', title: 'Home row: left hand', focus: 'asdf', keys: HOME_LEFT, hint: 'Rest your left fingers on A S D F. Feel the bump on F.' },
  { id: 'home-right', title: 'Home row: right hand', focus: 'jkl', keys: HOME_LEFT + HOME_RIGHT, hint: 'Right fingers on J K L; the bump is on J.' },
  { id: 'home-reach', title: 'Index reach: G and H', focus: 'gh', keys: HOME, hint: 'Index fingers stretch inward for G and H, then return.' },
  { id: 'top-left', title: 'Top row: left hand', focus: 'qwert', keys: HOME + 'qwert', hint: 'Reach up from the home row and come straight back.' },
  { id: 'top-right', title: 'Top row: right hand', focus: 'yuiop', keys: HOME + TOP, hint: 'Y belongs to the right index finger, not the left.' },
  { id: 'top-home', title: 'Top and home rows', focus: 'eiotr', keys: HOME + TOP, hint: 'The most common letters live here. Keep your wrists still.' },
  { id: 'bottom-left', title: 'Bottom row: left hand', focus: 'zxcvb', keys: HOME + TOP + 'zxcvb', hint: 'Curl down for Z X C V B; B is a left index reach.' },
  { id: 'bottom-right', title: 'Bottom row: right hand', focus: 'nm', keys: HOME + TOP + BOTTOM, hint: 'N and M both belong to the right index finger.' },
  { id: 'all-letters', title: 'All letter rows', focus: 'etaoinshr', keys: HOME + TOP + BOTTOM, hint: 'Every letter is in play. Prefer accuracy over speed.' },
  { id: 'common-pairs', title: 'Common pairs', focus: 'th he in er an', keys: HOME + TOP + BOTTOM, containsAny: ['th', 'he', 'in', 'er', 'an'], hint: 'Pairs like th, he and er appear everywhere. Let them flow.' },
  { id: 'long-words', title: 'Longer words', focus: 'long words', keys: HOME + TOP + BOTTOM, minLength: 7, hint: 'Read a whole word ahead instead of letter by letter.' },
  { id: 'full-flow', title: 'Full flow', focus: 'everything', keys: HOME + TOP + BOTTOM, hint: 'Put it together: steady rhythm, eyes on the text.' },
]);
