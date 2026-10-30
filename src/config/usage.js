/**
 * Usage statistics: what is counted, and the values each detail may take.
 *
 * Every key the server records must be listed here; anything else is dropped,
 * so a client can't invent rows. A detail value outside its list becomes
 * 'other' rather than a new row. The admin Usage page renders this tree.
 */
import { CODE_LANGUAGES, TEXT_CATEGORIES, WORD_LANGUAGES } from './texts.js';
import { LESSONS } from '../data/lessons.js';

export const USAGE_RANGES = Object.freeze([7, 30, 90]);
// The 90d view compares with the 90 days before it, so the hashed visitor
// sets must outlive two of them; older days keep only their daily counts.
export const USAGE_SET_RETENTION_DAYS = 180;
// New visitor ids one IP may bring in per UTC day (a household or classroom fits).
export const USAGE_NEW_IDS_PER_IP = 20;
export const USAGE_EVENTS_PER_REQUEST = 20;
export const BOT_SPEEDS = Object.freeze([40, 60, 80, 100]);

const LENGTHS = ['10', '25', '50', '75', '100'];
const TIMES = ['15', '30', '60', '90', '120'];
const LENGTH_LABELS = Object.fromEntries(LENGTHS.map((n) => [n, `${n} words`]));
const TIME_LABELS = Object.fromEntries(TIMES.map((t) => [t, `${t}s`]));

/**
 * @typedef {{ label: string, values: string[], labels?: Record<string, string> }} UsageDim
 * @typedef {{ key: string, group: 'tests'|'features'|'pages', label: string, account?: boolean,
 *             finish?: boolean, dims?: Record<string, UsageDim> }} UsageEntry
 * account: only signed-in players can use it. finish: started and finished are both counted.
 */
/** @type {readonly UsageEntry[]} */
export const USAGE_CATALOGUE = Object.freeze([
  {
    key: 'test.words', group: 'tests', label: 'Words test', finish: true,
    dims: {
      words: { label: 'By word count', values: LENGTHS, labels: LENGTH_LABELS },
      time: { label: 'By time limit', values: TIMES, labels: TIME_LABELS },
      language: { label: 'By language', values: [...WORD_LANGUAGES] },
      modifiers: { label: 'By modifiers', values: ['none', 'punctuation', 'numbers', 'both'] },
    },
  },
  {
    key: 'test.phrases', group: 'tests', label: 'Phrases test', finish: true,
    dims: { category: { label: 'By category', values: [...TEXT_CATEGORIES] } },
  },
  {
    key: 'test.code', group: 'tests', label: 'Code test', finish: true,
    dims: {
      language: { label: 'By language', values: [...CODE_LANGUAGES] },
      time: { label: 'By time limit', values: TIMES, labels: TIME_LABELS },
    },
  },
  {
    key: 'daily', group: 'features', label: 'Daily', account: true,
    dims: { action: { label: 'By action', values: ['attempt', 'ghost', 'past-day'], labels: { attempt: 'Attempt', ghost: 'Ghost race after', 'past-day': 'Opened a past day' } } },
  },
  {
    key: 'lessons', group: 'features', label: 'Lessons', account: true, finish: true,
    dims: { lesson: { label: 'By lesson', values: LESSONS.map((l) => l.id), labels: Object.fromEntries(LESSONS.map((l, i) => [l.id, `${i + 1}. ${l.title}`])) } },
  },
  {
    key: 'practice', group: 'features', label: 'Practice', account: true, finish: true,
    dims: { kind: { label: 'By kind', values: ['drills', 'common-words', 'review', 'word-lists'], labels: { drills: 'Key drills', 'common-words': 'Common words', review: 'Review', 'word-lists': 'Word lists' } } },
  },
  {
    key: 'race.live', group: 'features', label: 'Live races', account: true,
    dims: {
      action: { label: 'By action', values: ['created', 'joined', 'started', 'finished'], labels: { created: 'Created a room', joined: 'Joined a room', started: 'Started a race', finished: 'Finished a race' } },
      size: { label: 'By room size', values: ['2', '3-4', '5+'], labels: { 2: '2 players', '3-4': '3–4 players', '5+': '5+ players' } },
    },
  },
  {
    key: 'race.bot', group: 'features', label: 'Bot race', finish: true,
    dims: { speed: { label: 'By bot speed', values: BOT_SPEEDS.map(String), labels: Object.fromEntries(BOT_SPEEDS.map((s) => [s, `${s} wpm`])) } },
  },
  { key: 'page.rankings', group: 'pages', label: 'Rankings' },
  { key: 'page.error-map', group: 'pages', label: 'Error map', account: true },
  { key: 'page.replays', group: 'pages', label: 'Replays' },
  { key: 'page.achievements', group: 'pages', label: 'Achievements' },
  { key: 'page.stats', group: 'pages', label: 'Stats', account: true },
  { key: 'page.players', group: 'pages', label: 'Players' },
  { key: 'page.learn', group: 'pages', label: 'Learn' },
]);

export const USAGE_BY_KEY = Object.freeze(Object.fromEntries(USAGE_CATALOGUE.map((e) => [e.key, e])));

/** What the browser may report itself (everything else is recorded where it happens on the server). */
export const CLIENT_USAGE_EVENTS = Object.freeze(
  new Set([...USAGE_CATALOGUE.filter((e) => e.group === 'pages').map((e) => e.key), 'daily:past-day'])
);
