import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/env.js';
import { USERNAME_PATTERN } from '../utils/public-identity.js';

// Pin the algorithm: tokens are only ever signed with HS256 here.
export const JWT_VERIFY_OPTIONS = Object.freeze({ algorithms: ['HS256'] });

/**
 * A session token for a user. It carries the account's token version, so
 * bumping the version (revoke all sessions) invalidates every older token.
 */
export const generateToken = (user) =>
  jwt.sign({ userId: String(user._id), tv: user.tokenVersion || 0 }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });

/** Whether a decoded token is still valid for this user (not revoked). */
export const tokenIsCurrent = (decoded, user) => (decoded?.tv || 0) === (user?.tokenVersion || 0);

/**
 * Registers a new user
 */
export const register = async (username, email, password, displayName) => {
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Username must be 3-20 letters, numbers, dots, dashes or underscores');
  }

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ email }, { username }]
  });

  if (existingUser) {
    if (existingUser.email === email) {
      throw new Error('Email already registered');
    }
    throw new Error('Username already taken');
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create user
  const user = new User({
    username,
    email,
    password: hashedPassword,
    displayName: displayName && displayName.trim() ? displayName.trim() : username,
  });

  await user.save();

  const token = generateToken(user);

  return {
    user: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      stats: user.stats,
      settings: user.settings || {},
      followersCount: user.followersCount ?? 0,
      followingCount: user.followingCount ?? 0,
      createdAt: user.createdAt,
    },
    token,
  };
};

/**
 * Logs in a user with email or username
 */
export const login = async (identifier, password) => {
  if (typeof identifier !== 'string' || typeof password !== 'string') {
    throw new Error('Invalid credentials');
  }
  const user = await User.findOne({
    $or: [{ email: identifier.trim().toLowerCase() }, { username: identifier.trim() }]
  });

  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Password first: account status is only revealed to its owner. Accounts
  // made with Google have no password and can only sign in with Google.
  const isMatch = !!user.password && (await bcrypt.compare(password, user.password));

  if (!isMatch) {
    throw new Error('Invalid credentials');
  }

  if (user.status === 'banned') {
    throw new Error('Account is banned');
  }

  if (user.status === 'deactivated') {
    throw new Error('Account is deactivated');
  }

  const token = generateToken(user);

  return {
    user: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      stats: user.stats,
      settings: user.settings || {},
      followersCount: user.followersCount ?? 0,
      followingCount: user.followingCount ?? 0,
      createdAt: user.createdAt,
    },
    token,
  };
};

/**
 * Verifies a JWT token and returns the user
 */
export const verifyToken = async (token) => {
  const decoded = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS);
  // Full document: the caller turns it into the public shape (toPublicUser), which says whether a password exists but never sends it.
  const user = await User.findById(decoded.userId);

  if (!user || !tokenIsCurrent(decoded, user)) {
    throw new Error('User not found');
  }

  return user;
};

/**
 * Gets user by ID (without password)
 */
export const getUserById = async (userId) => {
  return await User.findById(userId).select('-password');
};
