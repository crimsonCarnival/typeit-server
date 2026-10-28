import mongoose, { Schema } from 'mongoose';

// Per-category stats bucket (one per time/word preset, plus a 'custom' bucket).
const bucketStatsSchema = new Schema(
  {
    games: { type: Number, default: 0 },
    highScore: { type: Number, default: 0 },
    bestWpm: { type: Number, default: 0 },
    bestAccuracy: { type: Number, default: 0 },
    totalTimeTyping: { type: Number, default: 0 },
    afkTime: { type: Number, default: 0 },
    afkPeriods: { type: Number, default: 0 },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 30,
      default: '',
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    avatar: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      enum: ['user', 'moderator', 'admin'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'deactivated', 'banned'],
      default: 'active',
    },
    statusChangedAt: {
      type: Date,
      default: null,
    },
    statusReason: {
      type: String,
      default: '',
    },
    stats: {
      gamesPlayed: {
        type: Number,
        default: 0,
      },
      highScore: {
        type: Number,
        default: 0,
      },
      bestWpm: {
        type: Number,
        default: 0,
      },
      bestAccuracy: {
        type: Number,
        default: 0,
      },
      totalTimeTyping: {
        type: Number,
        default: 0,
      },
      incompleteSessions: {
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
      raceWins: {
        type: Number,
        default: 0,
      },
      // Quick-match rating (Elo) and how many rated races it rests on.
      raceRating: {
        type: Number,
        default: 1000,
      },
      racesRated: {
        type: Number,
        default: 0,
      },
      // Consecutive UTC days with at least one saved run (Week Streak badge).
      streak: {
        current: { type: Number, default: 0 },
        longest: { type: Number, default: 0 },
        lastDate: { type: String, default: null }, // 'YYYY-MM-DD'
      },
      byTime: {
        type: Map,
        of: bucketStatsSchema,
        default: () => new Map(),
      },
      byWords: {
        type: Map,
        of: bucketStatsSchema,
        default: () => new Map(),
      },
      byMode: {
        type: Map,
        of: bucketStatsSchema,
        default: () => new Map(),
      },
      byModifier: {
        type: Map,
        of: bucketStatsSchema,
        default: () => new Map(),
      },
    },
    lastSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
    timezone: {
      type: String,
      default: null,
    },
    // Display and typing preferences (config/settings.js); validated on write.
    settings: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    lastSessionAt: {
      type: Date,
      default: null,
    },
    // Follow edges live in the Follow collection; these counters mirror it
    // (see services/follow.service.js, scripts/migrate-follows.js).
    followersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    followingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Index for leaderboard queries
userSchema.index({ 'stats.highScore': -1 });
userSchema.index({ 'stats.bestWpm': -1 });
userSchema.index({ 'stats.raceRating': -1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });

const User = mongoose.model('User', userSchema);

export default User;
