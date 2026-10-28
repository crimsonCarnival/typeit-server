import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/env.js';
import { USERNAME_PATTERN } from '../utils/public-identity.js';

/**
 * Generates a JWT token for a user
 */
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

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

  const token = generateToken(user._id);

  return {
    user: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      stats: user.stats,
      followers: user.followers?.length || 0,
      following: user.following?.length || 0,
      createdAt: user.createdAt,
    },
    token,
  };
};

/**
 * Logs in a user with email or username
 */
export const login = async (identifier, password) => {
  const user = await User.findOne({
    $or: [{ email: identifier }, { username: identifier }]
  });

  if (!user) {
    throw new Error('Invalid credentials');
  }

  if (user.status === 'banned') {
    throw new Error('Account is banned');
  }

  if (user.status === 'deactivated') {
    throw new Error('Account is deactivated');
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    throw new Error('Invalid credentials');
  }

  const token = generateToken(user._id);

  return {
    user: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      stats: user.stats,
      followers: user.followers?.length || 0,
      following: user.following?.length || 0,
      createdAt: user.createdAt,
    },
    token,
  };
};

/**
 * Verifies a JWT token and returns the user
 */
export const verifyToken = async (token) => {
  const decoded = jwt.verify(token, JWT_SECRET);
  const user = await User.findById(decoded.userId).select('-password');

  if (!user) {
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
