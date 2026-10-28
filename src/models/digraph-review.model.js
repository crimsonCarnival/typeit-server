import mongoose, { Schema } from 'mongoose';

// A missed digraph in a player's review queue (see REVIEW_* in config/learn.js).
const digraphReviewSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pair: { type: String, required: true },
    box: { type: Number, default: 1 },
    dueAt: { type: Date, required: true },
    misses: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

digraphReviewSchema.index({ userId: 1, pair: 1 }, { unique: true });
digraphReviewSchema.index({ userId: 1, dueAt: 1 });

const DigraphReview = mongoose.model('DigraphReview', digraphReviewSchema);

export default DigraphReview;
