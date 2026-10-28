import mongoose, { Schema } from 'mongoose';

// A player's record for one finger-placement lesson (or the common-words
// drill, lessonId 'common-words'). `completedAt` is set on the first pass.
const lessonProgressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lessonId: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
    bestWpm: { type: Number, default: 0 },
    bestAccuracy: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

lessonProgressSchema.index({ userId: 1, lessonId: 1 }, { unique: true });

const LessonProgress = mongoose.model('LessonProgress', lessonProgressSchema);

export default LessonProgress;
