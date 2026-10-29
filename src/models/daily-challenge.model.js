import mongoose, { Schema } from 'mongoose';

// One document per UTC day, written the first time the day is requested so
// the text stays fixed even if the generator or its dependencies change.
const dailyChallengeSchema = new Schema(
  {
    date: { type: String, required: true, unique: true }, // 'YYYY-MM-DD' (UTC)
    text: { type: String, required: true },
    totalWords: { type: Number, required: true },
    gameMode: { type: String, enum: ['words'], default: 'words' },
    wordCount: { type: Number, required: true },
    timeMax: { type: Number, required: true },
    punctuationEnabled: { type: Boolean, default: false },
    numbersEnabled: { type: Boolean, default: false },
    // Set once the day's rank notifications went out.
    resultsNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

const DailyChallenge = mongoose.model('DailyChallenge', dailyChallengeSchema);

export default DailyChallenge;
