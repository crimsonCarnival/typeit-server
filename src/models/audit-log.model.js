import mongoose, { Schema } from 'mongoose';

// Who did what to whom, and why. Written for every moderation action and kept
// (no TTL): this is the record that answers "why was this player banned".
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // The player acted on, if any (race moderation names them too).
    targetId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    reason: { type: String, default: '', maxlength: 500 },
    // What changed, e.g. { from: 'user', to: 'moderator' }.
    details: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
