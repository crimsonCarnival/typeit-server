import mongoose, { Schema } from 'mongoose';

// One document per unlocked badge. Progress toward locked badges is computed
// on read from the player's runs, so only unlocks need storing.
const userAchievementSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    achievementId: { type: String, required: true },
    unlockedAt: { type: Date, required: true },
  },
  { versionKey: false }
);

userAchievementSchema.index({ userId: 1, achievementId: 1 }, { unique: true });

const UserAchievement = mongoose.model('UserAchievement', userAchievementSchema);

export default UserAchievement;
