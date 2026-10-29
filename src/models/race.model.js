import mongoose, { Schema } from 'mongoose';

// A finished live race. Rooms live in memory while open; only the outcome is
// stored, once the race ends.
const raceSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, default: '' },
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isPrivate: { type: Boolean, default: false },
    mode: { type: String, enum: ['words', 'time', 'phrases'], default: 'words' },
    rated: { type: Boolean, default: false },
    category: { type: String, default: null },
    wordCount: { type: Number, required: true },
    timeLimit: { type: Number, default: null },
    text: { type: String, required: true },
    startAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    winnerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    players: [
      {
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        place: { type: Number, default: null }, // null = did not finish
        finishedAt: { type: Date, default: null },
        wpm: { type: Number, default: null },
        accuracy: { type: Number, default: null },
        ranked: { type: Boolean, default: false },
        resultId: { type: Schema.Types.ObjectId, ref: 'Result', default: null },
        // When the racer passed 75% of the text (server clock); null if unknown.
        reached75At: { type: Date, default: null },
        ratingChange: { type: Number, default: null },
      },
    ],
  },
  { timestamps: true, versionKey: false }
);

raceSchema.index({ 'players.userId': 1, finishedAt: -1 });

const Race = mongoose.model('Race', raceSchema);

export default Race;
