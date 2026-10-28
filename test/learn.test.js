import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import LessonProgress from '../src/models/lesson-progress.model.js';
import { LESSONS } from '../src/data/lessons.js';
import { COMMON_WORDS } from '../src/data/common-words.js';
import {
  buildCommonWordsText,
  buildLessonText,
  buildListText,
  lessonPassed,
  recordPracticeResult,
  validateWordList,
} from '../src/services/learn.service.js';
import {
  COMMON_WORDS_PER_RUN,
  LESSON_PASS_ACCURACY,
  LESSON_WORD_COUNT,
  MAX_LIST_WORDS,
  MAX_WORD_LENGTH,
} from '../src/config/learn.js';
import { seededRandom } from '../src/utils/seeded-random.js';

describe('lesson content', () => {
  it('has 12 lessons with unique ids', () => {
    assert.equal(LESSONS.length, 12);
    assert.equal(new Set(LESSONS.map((l) => l.id)).size, 12);
  });

  it('only ever adds keys from one lesson to the next', () => {
    for (let i = 1; i < LESSONS.length; i++) {
      const prev = new Set(LESSONS[i - 1].keys);
      const cur = new Set(LESSONS[i].keys);
      assert.ok([...prev].every((k) => cur.has(k)), LESSONS[i].id);
    }
  });

  it('generates text using only each lesson\'s keys', () => {
    for (const lesson of LESSONS) {
      const { text, totalWords } = buildLessonText(lesson, undefined, seededRandom(lesson.id));
      assert.equal(totalWords, LESSON_WORD_COUNT, lesson.id);
      const allowed = new Set([...lesson.keys, ' ']);
      assert.ok([...text].every((c) => allowed.has(c)), `${lesson.id}: ${text}`);
    }
  });

  it('pads early lessons with key patterns when real words run short', () => {
    const lesson = LESSONS[0]; // asdf only
    const { text } = buildLessonText(lesson, () => ['dad'], seededRandom('x'));
    assert.match(text, /^[asdf ]+$/);
    assert.ok(new Set(text.split(' ')).size > 1);
  });

  it('applies word filters', () => {
    const pairs = LESSONS.find((l) => l.id === 'common-pairs');
    const longWords = LESSONS.find((l) => l.id === 'long-words');
    const pool = () => ['then', 'cat', 'winter', 'dog', 'another', 'keyboard', 'sun', 'mother', 'brother', 'hand', 'river', 'thin', 'garden', 'shine', 'water', 'answer'];
    assert.ok(buildLessonText(pairs, pool).text.split(' ').every((w) => /th|he|in|er|an/.test(w)));
    assert.ok(buildLessonText(longWords, pool).text.split(' ').every((w) => w.length >= 7 || w.length <= 5));
  });
});

describe('common words and lists', () => {
  it('has exactly 200 unique common words', () => {
    assert.equal(COMMON_WORDS.length, 200);
    assert.equal(new Set(COMMON_WORDS).size, 200);
  });

  it('draws practice text from the right pool', () => {
    const common = buildCommonWordsText(seededRandom('c'));
    assert.equal(common.totalWords, COMMON_WORDS_PER_RUN);
    assert.ok(common.text.split(' ').every((w) => COMMON_WORDS.includes(w)));
    const list = buildListText({ words: ['const', 'let', 'await'] }, seededRandom('l'));
    assert.ok(list.text.split(' ').every((w) => ['const', 'let', 'await'].includes(w)));
  });
});

describe('lessonPassed', () => {
  it('needs the whole text at the pass accuracy', () => {
    assert.equal(lessonPassed({ completionPercentage: 100, accuracy: LESSON_PASS_ACCURACY }), true);
    assert.equal(lessonPassed({ completionPercentage: 100, accuracy: LESSON_PASS_ACCURACY - 0.01 }), false);
    assert.equal(lessonPassed({ completionPercentage: 99, accuracy: 100 }), false);
  });
});

describe('validateWordList', () => {
  it('normalises words from a string or an array', () => {
    assert.deepEqual(validateWordList({ name: '  Code ', words: 'const let\nconst  await' }).value, {
      name: 'Code',
      words: ['const', 'let', 'await'],
    });
    assert.deepEqual(validateWordList({ name: 'x', words: ['a b', 'c'] }).value.words, ['a', 'b', 'c']);
  });

  it('rejects bad input', () => {
    assert.match(validateWordList({ name: '', words: 'a' }).error, /Name/);
    assert.match(validateWordList({ name: 'x'.repeat(41), words: 'a' }).error, /Name/);
    assert.match(validateWordList({ name: 'n', words: '   ' }).error, /at least one/);
    assert.match(validateWordList({ name: 'n', words: 'x'.repeat(MAX_WORD_LENGTH + 1) }).error, /characters/);
    const tooMany = Array.from({ length: MAX_LIST_WORDS + 1 }, (_, i) => `w${i}`);
    assert.match(validateWordList({ name: 'n', words: tooMany }).error, /at most/);
    assert.ok(validateWordList(undefined).error);
  });
});

describe('recordPracticeResult', () => {
  afterEach(() => mock.restoreAll());
  const userId = new mongoose.Types.ObjectId();

  it('counts every attempt but only marks a pass as completed, once', async () => {
    const update = mock.method(LessonProgress, 'updateOne', async () => ({}));

    assert.equal(await recordPracticeResult(userId, 'home-left', { wpm: 30, accuracy: 80, completionPercentage: 100 }), false);
    assert.equal(update.mock.callCount(), 1);
    assert.deepEqual(update.mock.calls[0].arguments[1].$inc, { attempts: 1 });

    const now = new Date('2026-10-28T10:00:00Z');
    assert.equal(await recordPracticeResult(userId, 'home-left', { wpm: 32, accuracy: 95, completionPercentage: 100 }, now), true);
    const [filter, change] = update.mock.calls[2].arguments;
    // Only sets completedAt while it's still null, so the first pass is kept.
    assert.deepEqual(filter, { userId, lessonId: 'home-left', completedAt: null });
    assert.deepEqual(change, { $set: { completedAt: now } });
  });

  it('always completes the common-words drill', async () => {
    mock.method(LessonProgress, 'updateOne', async () => ({}));
    assert.equal(await recordPracticeResult(userId, 'common-words', { wpm: 40, accuracy: 50, completionPercentage: 20 }), true);
  });
});
