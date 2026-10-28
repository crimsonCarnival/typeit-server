import mongoose from 'mongoose';

/**
 * router.param handler that answers 404 for a malformed ObjectId instead of
 * letting the query throw a CastError (a 500).
 */
export const requireObjectIdParam = (notFoundMessage = 'Not found') => (req, res, next, value) => {
  if (!mongoose.isValidObjectId(value) || String(new mongoose.Types.ObjectId(value)) !== String(value)) {
    return res.status(404).json({ success: false, error: notFoundMessage });
  }
  next();
};
