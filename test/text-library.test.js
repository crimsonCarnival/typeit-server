import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listCategories, pickPassage } from '../src/services/text-library.service.js';
import { generateText } from '../src/services/game.service.js';
import { assessRun } from '../src/services/integrity.service.js';
import { parseGameSettings } from '../src/utils/validate.js';
import { INTEGRITY_FLAGS } from '../src/config/integrity.js';
import { QUOTES_MIN_WORDS, TEXT_CATEGORIES } from '../src/config/texts.js';
import { seededRandom } from '../src/utils/seeded-random.js';
import { classics } from '../src/data/texts/classics.js';
import { quotes } from '../src/data/texts/quotes.js';
import { speeches } from '../src/data/texts/speeches.js';
import { gta } from '../src/data/texts/gta.js';

describe('text library', () => {
  it('keeps every passage plain, typeable ASCII with attribution', () => {
    for (const entry of [...classics, ...quotes, ...speeches, ...gta]) {
      assert.match(entry.text, /^[\x20-\x7e]+$/, entry.text.slice(0, 40));
      assert.ok(entry.author, entry.text.slice(0, 40));
    }
  });

  it('picks from the requested category and attributes it', () => {
    for (const category of TEXT_CATEGORIES) {
      const { text, totalWords, passage } = pickPassage(category, seededRandom(category));
      assert.equal(passage.category, category);
      assert.ok(text.length > 0);
      assert.equal(totalWords, text.split(' ').length);
      assert.ok(passage.author);
    }
  });

  it('joins distinct quotes until a run is long enough', () => {
    const { totalWords, passage } = pickPassage('quotes', seededRandom('q'));
    assert.ok(totalWords >= QUOTES_MIN_WORDS);
    assert.equal(passage.title, null);
  });

  it('falls back to classics for an unknown category', () => {
    assert.equal(pickPassage('nope').passage.category, 'classics');
  });

  it('gives words mode no passage', () => {
    assert.equal(generateText('words', 10, false, false).passage, null);
    assert.equal(generateText('phrases', 10, false, false, 'speeches').passage.category, 'speeches');
  });

  it('lists categories with pool sizes', () => {
    const cats = listCategories();
    assert.deepEqual(cats.map((c) => c.id), [...TEXT_CATEGORIES]);
    assert.ok(cats.every((c) => !c.casual), 'every phrase category is ranked, GTA included');
  });

  it('validates the category setting', () => {
    assert.equal(parseGameSettings({ textCategory: 'quotes' }).settings.textCategory, 'quotes');
    assert.ok(parseGameSettings({ textCategory: 'bogus' }).error);
  });

  it('never ranks runs on casual text', () => {
    const { ranked, flags } = assessRun({
      textSource: 'server',
      casualText: true,
      serverStartedAt: null,
      serverEndedAt: new Date(),
      clientElapsedMs: 1000,
      wpm: 50,
      rawWpm: 50,
      textLength: 10,
      typedText: '',
    });
    assert.equal(ranked, false);
    assert.ok(flags.includes(INTEGRITY_FLAGS.CASUAL_TEXT));
  });
});

describe('code and language text', async () => {
  const { pickCode } = await import('../src/services/text-library.service.js');
  const { CODE_LANGUAGES, WORD_LANGUAGES } = await import('../src/config/texts.js');
  const { LANGUAGE_WORDS } = await import('../src/data/languages.js');

  it('builds code snippets as unindented lines joined by line breaks', () => {
    for (const lang of CODE_LANGUAGES) {
      const { text, passage } = pickCode(lang, seededRandom(lang));
      assert.equal(passage.category, 'code');
      assert.ok(text.split('\n').every((line) => line.length > 0 && line === line.trim()), lang);
      assert.match(text, /^[\x20-\x7e\n]+$/);
    }
  });

  it('generates words in other languages as casual text', () => {
    const es = generateText('words', 30, false, false, { language: 'spanish' });
    assert.equal(es.passage.category, 'language');
    assert.ok(es.text.split(' ').every((w) => LANGUAGE_WORDS.spanish.includes(w)));
    assert.equal(generateText('words', 10, false, false, { language: 'english' }).passage, null);
    assert.equal(generateText('code', 10, false, false, { codeLanguage: 'python' }).passage.title, 'Python');
    assert.ok(WORD_LANGUAGES.includes('german'));
  });

  it('validates the new settings', () => {
    assert.equal(parseGameSettings({ gameMode: 'code', codeLanguage: 'rust' }).settings.codeLanguage, 'rust');
    assert.ok(parseGameSettings({ codeLanguage: 'cobol' }).error);
    assert.ok(parseGameSettings({ language: 'klingon' }).error);
  });

  it('never ranks code or non-English runs', () => {
    const base = { textSource: 'server', serverStartedAt: null, serverEndedAt: new Date(), clientElapsedMs: 1000, wpm: 50, rawWpm: 50, typedText: '' };
    assert.ok(assessRun({ ...base, casualText: true }).flags.includes(INTEGRITY_FLAGS.CASUAL_TEXT));
  });
});
