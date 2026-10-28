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

const Result = mongoose.model('Result', resultSchema);

export default Result;
