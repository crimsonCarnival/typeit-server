import AuditLog from '../models/audit-log.model.js';
import { publicHandle } from '../utils/public-identity.js';

/** Records a moderation action. Failing to log must never undo the action, so errors are only reported. */
export const recordAudit = async (actorId, action, { targetId = null, reason = '', details = null } = {}) => {
  try {
    const entry = await AuditLog.create({ actorId, targetId, action, reason: String(reason || '').slice(0, 500), details });
    return String(entry._id);
  } catch (err) {
    console.error('[audit] could not record', action, err?.message || err);
    return null;
  }
};

const who = (u) => (u ? { userId: String(u._id), username: publicHandle(u), role: u.role } : null);

/** One page of the audit log, newest first, optionally for one target, actor or action. */
export const listAudit = async (page = 1, limit = 30, { targetId, actorId, action } = {}) => {
  const query = {};
  if (targetId) query.targetId = targetId;
  if (actorId) query.actorId = actorId;
  if (action) query.action = action;
  const [rows, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('actorId', 'username role')
      .populate('targetId', 'username role')
      .lean(),
    AuditLog.countDocuments(query),
  ]);
  return {
    entries: rows.map((r) => ({
      id: String(r._id),
      action: r.action,
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt,
      actor: who(r.actorId),
      target: who(r.targetId),
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};
