import mongoose, { Schema } from 'mongoose';

// One inbox entry. `dedupeKey` makes a notification idempotent per user: the
// same event (a follow, a race, a day's reminder) can be reported twice and
// still lands once.
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, default: '', maxlength: 400 },
    // In-app path the notification opens, e.g. '/daily'.
    link: { type: String, default: null },
    dedupeKey: { type: String, default: null },
    readAt: { type: Date, default: null },
    // When the thing happened (a caught-up notice is created later than its event).
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
// Old notifications clear themselves.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
