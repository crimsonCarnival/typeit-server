import mongoose, { Schema } from 'mongoose';

const split = { guest: { type: Number, default: 0 }, user: { type: Number, default: 0 } };

// One feature (or one detail of it, e.g. 'test.words.time=30') on one UTC day.
// Visitors are keyed hashes, never raw ids; after USAGE_SET_RETENTION_DAYS the
// sets are dropped and only `people` (that day's distinct counts) remains.
const usageDaySchema = new Schema(
  {
    day: { type: String, required: true }, // 'YYYY-MM-DD' (UTC)
    key: { type: String, required: true },
    times: split,
    finished: split,
    visitors: {
      guest: { type: [String], default: undefined },
      user: { type: [String], default: undefined },
    },
    people: {
      type: new Schema({ guest: Number, user: Number, all: Number }, { _id: false }),
      default: undefined,
    },
  },
  { versionKey: false }
);

usageDaySchema.index({ day: 1, key: 1 }, { unique: true });
usageDaySchema.index({ key: 1, day: 1 });

const UsageDay = mongoose.model('UsageDay', usageDaySchema, 'usage_days');

export default UsageDay;
