import {
  COMMON_WORDS_ID,
  buildCommonWordsText,
  buildLessonText,
  buildListText,
  countLists,
  createList,
  deleteList,
  findLesson,
  findList,
  getLearnOverview,
  updateList,
  validateWordList,
} from '../services/learn.service.js';
import { startPracticeSession } from '../services/game.service.js';
import { buildReviewText, getReviewOverview } from '../services/review.service.js';
import { MAX_WORD_LISTS } from '../config/learn.js';

const fail = (res, status, error) => res.status(status).json({ success: false, error });

const learnController = {
  /** GET /api/learn: lessons, progress, common-words stats and word lists. */
  overview: async (req, res) => {
    try {
      const [overview, review] = await Promise.all([getLearnOverview(req.user._id), getReviewOverview(req.user._id)]);
      res.json({ success: true, data: { ...overview, review } });
    } catch (err) {
      fail(res, 500, 'Could not load lessons');
    }
  },

  /**
   * POST /api/learn/start { kind: 'lesson' | 'common-words' | 'list' | 'review', id? }
   * Loads practice text into the session. For lessons, `id` defaults to the
   * first lesson not yet passed.
   */
  start: async (req, res) => {
    const { kind, id } = req.body || {};
    const userId = req.user._id;
    try {
      let content;
      let practice;
      if (kind === 'lesson') {
        const lessonId = id ?? (await getLearnOverview(userId)).nextLessonId ?? 'home-left';
        const lesson = findLesson(lessonId);
        if (!lesson) return fail(res, 404, 'Lesson not found');
        content = buildLessonText(lesson);
        practice = { kind, id: lesson.id };
      } else if (kind === 'common-words') {
        content = buildCommonWordsText();
        practice = { kind, id: COMMON_WORDS_ID };
      } else if (kind === 'list') {
        const list = typeof id === 'string' ? await findList(userId, id) : null;
        if (!list) return fail(res, 404, 'List not found');
        content = buildListText(list);
        practice = { kind, id: list._id.toString() };
      } else if (kind === 'review') {
        const { duePairs } = await getReviewOverview(userId);
        content = buildReviewText(duePairs);
        if (!content) return fail(res, 409, 'Nothing to review right now');
        practice = { kind, id: duePairs.join(' ') };
      } else {
        return fail(res, 400, 'Invalid practice kind');
      }
      res.json({ success: true, data: await startPracticeSession(userId, content, practice) });
    } catch (err) {
      fail(res, 500, 'Could not start practice');
    }
  },

  /** POST /api/learn/lists { name, words } */
  createList: async (req, res) => {
    const { value, error } = validateWordList(req.body);
    if (error) return fail(res, 400, error);
    try {
      if ((await countLists(req.user._id)) >= MAX_WORD_LISTS) {
        return fail(res, 409, `You can keep at most ${MAX_WORD_LISTS} lists`);
      }
      const list = await createList(req.user._id, value);
      res.status(201).json({ success: true, data: { id: list._id.toString(), name: list.name, words: list.words } });
    } catch (err) {
      fail(res, 500, 'Could not save the list');
    }
  },

  /** PUT /api/learn/lists/:id { name, words } */
  updateList: async (req, res) => {
    const { value, error } = validateWordList(req.body);
    if (error) return fail(res, 400, error);
    try {
      const list = await updateList(req.user._id, req.params.id, value);
      if (!list) return fail(res, 404, 'List not found');
      res.json({ success: true, data: { id: list._id.toString(), name: list.name, words: list.words } });
    } catch (err) {
      fail(res, 500, 'Could not save the list');
    }
  },

  /** DELETE /api/learn/lists/:id */
  deleteList: async (req, res) => {
    try {
      const { deletedCount } = await deleteList(req.user._id, req.params.id);
      if (!deletedCount) return fail(res, 404, 'List not found');
      res.json({ success: true });
    } catch (err) {
      fail(res, 500, 'Could not delete the list');
    }
  },
};

export default learnController;
