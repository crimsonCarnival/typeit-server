import mongoose from 'mongoose';
import { generate } from 'random-words';
import LessonProgress from '../models/lesson-progress.model.js';
import WordList from '../models/word-list.model.js';
import { LESSONS } from '../data/lessons.js';
import { COMMON_WORDS } from '../data/common-words.js';
import {
  COMMON_WORDS_PER_RUN,
  LESSON_CANDIDATES,
  LESSON_MIN_REAL_WORDS,
  LESSON_PASS_ACCURACY,
  LESSON_WORD_COUNT,
  LIST_WORDS_PER_RUN,
  MAX_LIST_NAME_LENGTH,
  MAX_LIST_WORDS,
  MAX_WORD_LENGTH,
  MAX_WORD_LISTS,
} from '../config/learn.js';

export const COMMON_WORDS_ID = 'common-words';

const pick = (list, random) => list[Math.floor(random() * list.length)];

/** `count` words drawn at random (with repeats) from `pool`. */
export const sampleWords = (pool, count, random = Math.random) =>
  Array.from({ length: count }, () => pick(pool, random));

const toText = (words) => ({ text: words.join(' '), totalWords: words.length });

/**
 * Builds a lesson's practice text from real words that use only the lesson's
 * keys. Early lessons have too few such words, so short key patterns
 * ("fjdk", "lads") are mixed in until there's enough variety.
 *
 * @param {object} lesson   entry from data/lessons.js
 * @param {() => string[]} candidates  real-word source (injectable for tests)
 * @param {() => number} random
 */
export const buildLessonText = (
  lesson,
  candidates = () => generate({ exactly: LESSON_CANDIDATES }),
  random = Math.random
) => {
  const allowed = new Set(lesson.keys);
  let words = [...new Set(candidates())].filter((w) => [...w].every((c) => allowed.has(c)));
  if (lesson.containsAny) words = words.filter((w) => lesson.containsAny.some((s) => w.includes(s)));
  if (lesson.minLength) words = words.filter((w) => w.length >= lesson.minLength);

  const pool = [...words];
  if (pool.length < LESSON_MIN_REAL_WORDS) {
    const keys = [...lesson.keys];
    while (pool.length < LESSON_MIN_REAL_WORDS * 2) {
      const len = 2 + Math.floor(random() * 4);
      pool.push(Array.from({ length: len }, () => pick(keys, random)).join(''));
    }
  }
  return toText(sampleWords(pool, LESSON_WORD_COUNT, random));
};

export const buildCommonWordsText = (random = Math.random) =>
  toText(sampleWords(COMMON_WORDS, COMMON_WORDS_PER_RUN, random));

export const buildListText = (list, random = Math.random) =>
  toText(sampleWords(list.words, LIST_WORDS_PER_RUN, random));

/** A lesson is passed by finishing the whole text at the target accuracy. */
export const lessonPassed = ({ completionPercentage, accuracy }) =>
  completionPercentage >= 100 && accuracy >= LESSON_PASS_ACCURACY;

/**
 * Validates and normalises a custom word list. Words are split on
 * whitespace, de-duplicated and length-limited.
 * @returns {{ value?: {name: string, words: string[]}, error?: string }}
 */
export const validateWordList = ({ name, words } = {}) => {
  if (typeof name !== 'string' || !name.trim()) return { error: 'Name is required' };
  if (name.trim().length > MAX_LIST_NAME_LENGTH) return { error: `Name must be at most ${MAX_LIST_NAME_LENGTH} characters` };

  const raw = Array.isArray(words) ? words.join(' ') : typeof words === 'string' ? words : '';
  const unique = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (unique.length === 0) return { error: 'Add at least one word' };
  if (unique.length > MAX_LIST_WORDS) return { error: `A list can hold at most ${MAX_LIST_WORDS} words` };
  if (unique.some((w) => w.length > MAX_WORD_LENGTH)) return { error: `Words must be at most ${MAX_WORD_LENGTH} characters` };

  return { value: { name: name.trim(), words: unique } };
};

/**
 * Records a finished lesson or common-words run. Attempts always count;
 * completion only on a pass, and the first pass time is kept.
 */
export const recordPracticeResult = async (userId, lessonId, results, now = new Date()) => {
  const passed = lessonId === COMMON_WORDS_ID || lessonPassed(results);
  await LessonProgress.updateOne(
    { userId, lessonId },
    { $inc: { attempts: 1 }, $max: { bestWpm: results.wpm, bestAccuracy: results.accuracy } },
    { upsert: true }
  );
  // Not $min: Mongo orders null before dates, so $min would keep the null.
  if (passed) {
    await LessonProgress.updateOne({ userId, lessonId, completedAt: null }, { $set: { completedAt: now } });
  }
  return passed;
};

/** Learn page data: lesson progress, next lesson, common-words status, lists. */
export const getLearnOverview = async (userId) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [progress, lists] = await Promise.all([
    LessonProgress.find({ userId: id }).lean(),
    WordList.find({ userId: id }).sort({ updatedAt: -1 }).select('name words updatedAt').lean(),
  ]);
  const byLesson = new Map(progress.map((p) => [p.lessonId, p]));

  const lessons = LESSONS.map((l, i) => {
    const p = byLesson.get(l.id);
    return {
      id: l.id,
      number: i + 1,
      title: l.title,
      focus: l.focus,
      hint: l.hint,
      completed: !!p?.completedAt,
      bestWpm: p?.bestWpm ?? 0,
      bestAccuracy: p?.bestAccuracy ?? 0,
    };
  });
  const common = byLesson.get(COMMON_WORDS_ID);

  return {
    lessons,
    nextLessonId: lessons.find((l) => !l.completed)?.id ?? null,
    passAccuracy: LESSON_PASS_ACCURACY,
    commonWords: { runs: common?.attempts ?? 0, bestWpm: common?.bestWpm ?? 0 },
    lists: lists.map((l) => ({ id: l._id.toString(), name: l.name, words: l.words, updatedAt: l.updatedAt })),
    maxLists: MAX_WORD_LISTS,
  };
};

export const countLists = (userId) => WordList.countDocuments({ userId });
export const findList = (userId, listId) =>
  mongoose.isValidObjectId(listId) ? WordList.findOne({ _id: listId, userId }).lean() : null;
export const createList = (userId, value) => WordList.create({ userId, ...value });
export const updateList = (userId, listId, value) =>
  mongoose.isValidObjectId(listId)
    ? WordList.findOneAndUpdate({ _id: listId, userId }, { $set: value }, { new: true }).lean()
    : null;
export const deleteList = (userId, listId) =>
  mongoose.isValidObjectId(listId) ? WordList.deleteOne({ _id: listId, userId }) : { deletedCount: 0 };

export const findLesson = (lessonId) => LESSONS.find((l) => l.id === lessonId) ?? null;
