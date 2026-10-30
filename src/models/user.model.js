import mongoose, { Schema } from 'mongoose';
import { permissionsFor } from '../config/permissions.js';
import { levelInfo } from '../config/levels.js';

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
    // Null for accounts made with Google that never set one.
    password: {
      type: String,
      default: null,
    },
    googleId: { type: String, default: undefined },
    googleEmail: { type: String, default: null },
    // Bumped by "revoke all sessions": tokens carry the version they were made with.
    tokenVersion: { type: Number, default: 0 },
    // Username changes are limited (see USERNAME_CHANGE_DAYS).
    usernameChangedAt: { type: Date, default: null },
    // Hours added to UTC when deciding which day a run counts for a streak; set once.
    streakHourOffset: { type: Number, default: 0 },
    streakOffsetSetAt: { type: Date, default: null },
    // Opted out of every leaderboard, for good.
    leaderboardOptOut: { type: Boolean, default: false },
    // Turned off anonymous usage statistics; the server drops this account's events.
    usageOptOut: { type: Boolean, default: false },
    // Personal bests only count results after this moment.
    pbResetAt: { type: Date, default: null },
    avatar: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      enum: ['user', 'moderator', 'admin', 'founder'],
      default: 'user',
    },
    // Single permissions an admin added to or took from this player on top of
    // their role's (config/permissions.js). Ignored for admins.
    permissionGrants: { type: [String], default: [] },
    permissionRevokes: { type: [String], default: [] },
    // When missed notifications were last looked for (services/notification-catchup.js).
    notificationsSyncedAt: { type: Date, default: null },
    // Optional notification categories the player muted (false = muted); missing = on.
    notificationPrefs: {
      social: Boolean,
      achievements: Boolean,
      races: Boolean,
      daily: Boolean,
      releases: Boolean,
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
      // Tests whose first key was typed. gamesPlayed counts the finished
      // ones, so a started-but-abandoned test only shows up here.
      // Total experience: grows with play and staff grants (config/levels.js turns it into a level).
      xp: {
        type: Number,
        default: 0,
        min: 0,
      },
      testsStarted: {
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
    // True once the player picked their zone: the client then stops overwriting
    // it with whatever the browser reports.
    timezoneManual: {
      type: Boolean,
      default: false,
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
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ status: 1 });

// Every response that sends a user document also says what that user may do, so
// the client never has to guess (and an edit to a profile can't drop it).
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.permissions = permissionsFor(doc);
    ret.level = levelInfo(doc.stats?.xp);
    // Which sign-in methods the account has; the hash and internals never leave the server.
    if (ret.password !== undefined) ret.hasPassword = !!ret.password;
    delete ret.password;
    delete ret.googleId;
    delete ret.tokenVersion;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

export default User;
