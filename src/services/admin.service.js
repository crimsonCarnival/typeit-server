import User from '../models/user.model.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Gets all users with pagination and filters
 */
export const getAllUsers = async (page = 1, limit = 20, filters = {}) => {
  const query = {};
  
  if (filters.role) query.role = filters.role;
  if (filters.status) query.status = filters.status;
  if (filters.search) {
    query.$or = [
      { username: { $regex: escapeRegex(filters.search), $options: 'i' } },
      { email: { $regex: escapeRegex(filters.search), $options: 'i' } },
    ];
  }

  const skip = (page - 1) * limit;
  
  const [users, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-password'),
    User.countDocuments(query),
  ]);

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

/**
 * Gets user by ID
 */
export const getUserById = async (userId) => {
  return await User.findById(userId).select('-password');
};

/**
 * Updates user role
 */
export const updateUserRole = async (userId, role, adminId) => {
  if (userId === adminId.toString()) {
    throw new Error('Cannot change your own role');
  }

  const validRoles = ['user', 'moderator', 'admin'];
  if (!validRoles.includes(role)) {
    throw new Error('Invalid role');
  }

  return await User.findByIdAndUpdate(
    userId,
    { $set: { role } },
    { new: true }
  ).select('-password');
};

/**
 * Updates user status (active, deactivated, banned)
 */
export const updateUserStatus = async (userId, status, reason = '', adminId) => {
  if (userId === adminId.toString()) {
    throw new Error('Cannot change your own status');
  }

  const validStatuses = ['active', 'deactivated', 'banned'];
  if (!validStatuses.includes(status)) {
    throw new Error('Invalid status');
  }

  const user = await User.findById(userId);
  if (!user) return null;

  // Only admins can change status of other admins
  if (user.role === 'admin') {
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      throw new Error('Only admins can change status of other admins');
    }
  }

  const updates = {
    status,
    statusChangedAt: status === 'active' ? null : new Date(),
    statusReason: status === 'active' ? '' : reason,
  };

  return await User.findByIdAndUpdate(
    userId,
    { $set: updates },
    { new: true }
  ).select('-password');
};

/**
 * Deactivates a user account
 */
export const deactivateUser = async (userId, reason = '', adminId) => {
  return await updateUserStatus(userId, 'deactivated', reason, adminId);
};

/**
 * Bans a user account
 */
export const banUser = async (userId, reason = '', adminId) => {
  return await updateUserStatus(userId, 'banned', reason, adminId);
};

/**
 * Reactivates a user account
 */
export const reactivateUser = async (userId, adminId) => {
  return await updateUserStatus(userId, 'active', '', adminId);
};

/**
 * Deletes a user permanently
 */
export const deleteUser = async (userId, adminId) => {
  if (userId === adminId.toString()) {
    throw new Error('Cannot delete your own account');
  }

  const user = await User.findById(userId);
  if (!user) return false;

  // Only admins can delete other admins
  if (user.role === 'admin') {
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      throw new Error('Only admins can delete other admins');
    }
  }

  const result = await User.findByIdAndDelete(userId);
  return !!result;
};

/**
 * Gets admin dashboard stats
 */
export const getDashboardStats = async () => {
  const [
    totalUsers,
    activeUsers,
    deactivatedUsers,
    bannedUsers,
    usersByRole,
    recentUsers,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'deactivated' }),
    User.countDocuments({ status: 'banned' }),
    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
    User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('username email createdAt status'),
  ]);

  return {
    totalUsers,
    activeUsers,
    deactivatedUsers,
    bannedUsers,
    usersByRole: usersByRole.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {}),
    recentUsers,
  };
};
