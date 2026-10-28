import { classics } from '../data/texts/classics.js';
import { quotes } from '../data/texts/quotes.js';
import { speeches } from '../data/texts/speeches.js';
import { gta } from '../data/texts/gta.js';
import { CODE_SNIPPETS } from '../data/texts/code.js';
import {
  CASUAL_TEXT_CATEGORIES,
  CODE_LANGUAGE_NAMES,
  DEFAULT_CODE_LANGUAGE,
  DEFAULT_TEXT_CATEGORY,
  QUOTES_MAX_PER_RUN,
  QUOTES_MIN_WORDS,
  TEXT_CATEGORIES,
} from '../config/texts.js';

const POOLS = Object.freeze({ classics, quotes, speeches, gta });

export const isTextCategory = (value) => TEXT_CATEGORIES.includes(value);
export const isCasualCategory = (value) => CASUAL_TEXT_CATEGORIES.includes(value);

const countWords = (text) => text.split(/\s+/).filter(Boolean).length;
const normalise = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Picks quotes without repeats until the run is long enough. The passage is
 * attributed to every author used, in order.
 */
const pickQuotes = (random) => {
  const indices = [...quotes.keys()];
  const picked = [];
  let words = 0;
  while (indices.length && picked.length < QUOTES_MAX_PER_RUN && words < QUOTES_MIN_WORDS) {
    const [i] = indices.splice(Math.floor(random() * indices.length), 1);
    picked.push(quotes[i]);
    words += countWords(quotes[i].text);
  }
  const authors = [...new Set(picked.map((q) => q.author))];
  return {
    text: normalise(picked.map((q) => q.text).join(' ')),
    title: null,
    author: authors.join(', '),
  };
};

/**
 * Picks a passage for phrases mode.
 * @param {string} category  one of TEXT_CATEGORIES (falls back to the default)
 * @param {() => number} random
 * @returns {{ text: string, totalWords: number, passage: { category: string, title: string|null, author: string } }}
 */
export const pickPassage = (category = DEFAULT_TEXT_CATEGORY, random = Math.random) => {
  const cat = isTextCategory(category) ? category : DEFAULT_TEXT_CATEGORY;
  const chosen = cat === 'quotes'
    ? pickQuotes(random)
    : (() => {
        const pool = POOLS[cat];
        const entry = pool[Math.floor(random() * pool.length)];
        return { text: normalise(entry.text), title: entry.title ?? null, author: entry.author };
      })();
  return {
    text: chosen.text,
    totalWords: countWords(chosen.text),
    passage: { category: cat, title: chosen.title, author: chosen.author },
  };
};

/**
 * Picks a code snippet. Lines keep their order and line breaks (typed with
 * Enter) but lose leading indentation.
 */
export const pickCode = (language = DEFAULT_CODE_LANGUAGE, random = Math.random) => {
  const lang = CODE_SNIPPETS[language] ? language : DEFAULT_CODE_LANGUAGE;
  const pool = CODE_SNIPPETS[lang];
  const snippet = pool[Math.floor(random() * pool.length)];
  const text = snippet
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return {
    text,
    totalWords: countWords(text),
    passage: { category: 'code', title: CODE_LANGUAGE_NAMES[lang] ?? lang, author: 'TypeIt snippets' },
  };
};

/** Category list with pool sizes, for the client's text-source menu. */
export const listCategories = () =>
  TEXT_CATEGORIES.map((id) => ({ id, passages: POOLS[id].length, casual: isCasualCategory(id) }));
