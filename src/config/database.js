import mongoose from 'mongoose';
import { MONGO_URI, NODE_ENV } from './env.js';

let isConnected = false;

export const connectDB = async () => {
  if (isConnected) {
    return mongoose.connection;
  }

  // If no URI provided and we're not in production, skip DB connect so the
  // server can run in dev (useful for port-forwarding / tunnels).
  if (!MONGO_URI && NODE_ENV !== 'production') {
    console.warn('MONGO_URI not set; skipping DB connection in development.');
    return mongoose.connection;
  }

  try {
    const conn = await mongoose.connect(MONGO_URI);
    isConnected = true;

    let retries = 0;

    mongoose.connection.on('disconnected', () => {
      isConnected = false;

      if (retries < 5) {
        retries++;
        const delay = 3000 * retries;
        setTimeout(connectDB, delay);
      }
    });

    mongoose.connection.on('reconnected', () => {
      isConnected = true;
      retries = 0;
    });

    mongoose.connection.on('error', (err) => {
      console.error('[database] connection error:', err?.message || err);
    });

    return conn;
  } catch (e) {
    console.error('Failed to connect to MongoDB:', e.message || e);
    if (NODE_ENV === 'production') {
      process.exit(1);
    }
    return mongoose.connection;
  }
};
