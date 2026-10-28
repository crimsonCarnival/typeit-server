/**
 * Small deterministic PRNG (mulberry32) seeded from a string. Not for
 * security: only for reproducible text generation such as the daily challenge.
 *
 * @param {string} seed
 * @returns {() => number} returns floats in [0, 1), like Math.random
 */
export const seededRandom = (seed) => {
  let state = hashString(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// FNV-1a 32-bit
const hashString = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};
