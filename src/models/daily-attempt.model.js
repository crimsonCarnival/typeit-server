import mongoose, { Schema } from 'mongoose';

// A player's single attempt at one day's challenge. Created when the player
// starts (so abandoning and retrying is impossible); the unique index makes
// the one-attempt rule hold even under concurrent requests.
const dailyAttemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD' (UTC)
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    resultId: { type: Schema.Types.ObjectId, ref: 'Result', default: null },
    wpm: { type: Number, default: null },
    accuracy: { type: Number, default: null },
    // Copied from the result's integrity assessment; only ranked attempts
    // appear on the day's leaderboard.
    ranked: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

dailyAttemptSchema.index({ userId: 1, date: 1 }, { unique: true });
dailyAttemptSchema.index({ date: 1, ranked: 1, wpm: -1 });

const DailyAttempt = mongoose.model('DailyAttempt', dailyAttemptSchema);

export default DailyAttempt;
