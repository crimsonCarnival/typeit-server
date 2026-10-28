import mongoose, { Schema } from 'mongoose';

const resultSchema = new Schema(
  {
    score: {
      type: Number,
      required: true,
    },
    wpm: {
      type: Number,
      required: true,
    },
    cpm: {
      type: Number,
      required: true,
    },
    rawWpm: {
      type: Number,
      default: 0,
    },
    consistency: {
      type: Number,
      default: 0,
    },
    accuracy: {
      type: Number,
      required: true,
    },
    mistakes: {
      type: Number,
      required: true,
    },
    successes: {
      type: Number,
      required: true,
    },
    elapsedTime: {
      type: Number,
      required: true,
    },
    completionPercentage: {
      type: Number,
      required: true,
    },
    totalWords: {
      type: Number,
      required: true,
    },
    difficultyFactor: {
      type: Number,
      required: true,
    },
    gameMode: {
      type: String,
      enum: ['phrases', 'words'],
      required: true,
    },
    wordCount: {
      type: Number,
    },
    // Set when the run was a daily challenge attempt ('YYYY-MM-DD').
    dailyDate: {
      type: String,
      default: null,
    },
    // Modifier combination the run was played with; rankings never mix them.
    modifiers: {
      type: String,
      enum: ['none', 'punctuation', 'numbers', 'both'],
      default: 'none',
    },
    timeMax: {
      type: Number,
      required: true,
    },
    remainingTime: {
      type: Number,
      default: 0,
    },
    afkTime: {
      type: Number,
      default: 0,
    },
    afkPeriods: {
      type: Number,
      default: 0,
    },
    performance: [{
      timestamp: {
        type: Number,
        required: true,
      },
      wpm: {
        type: Number,
        required: true,
      },
      rawWpm: {
        type: Number,
        default: 0
      },
      accuracy: {
        type: Number,
        required: true,
      },
      currentIndex: {
        type: Number,
        required: true,
      },
      mistakes: {
        type: Number,
        required: true,
      },
      afkPeriods: [{
        timestamp: { type: Number, required: true },
        afkIndex: { type: Number, required: true }
      }]
    }],
    migrated: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Run-integrity assessment (see config/integrity.js). Pre-existing results
    // default to unranked with version 0: they were never assessed.
    ranked: {
      type: Boolean,
      default: false,
    },
    integrityVersion: {
      type: Number,
      default: 0,
    },
    integrityFlags: {
      type: [String],
      default: [],
    },
    // Keystroke log as [gapMs, char] pairs ('' = backspace) and the per-key
    // aggregates derived from it server-side (see keystroke.service.js).
    // Stored as arrays rather than maps: Mongo keys can't hold '.' or '$'.
    keystrokes: {
      type: [Schema.Types.Mixed],
      default: undefined,
    },
    keyPresses: [{ _id: false, key: String, count: Number }],
    keyErrors: [{ _id: false, expected: String, typed: String, count: Number }],
    digraphErrors: [{ _id: false, pair: String, count: Number }],
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for leaderboard queries
resultSchema.index({ score: -1 });
resultSchema.index({ wpm: -1 });
resultSchema.index({ gameMode: 1, score: -1 });
// Rankings: best ranked run per player within one board.
resultSchema.index({ ranked: 1, gameMode: 1, timeMax: 1, modifiers: 1, wpm: -1 });

const Result = mongoose.model('Result', resultSchema);

export default Result;
