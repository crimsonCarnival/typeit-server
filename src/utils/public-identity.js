/**
 * What other players may see of a user. Some accounts used their email as
 * username or display name; those must never be shown publicly, so a
 * placeholder derived from the id stands in.
 */
const hasAt = (value) => typeof value === 'string' && value.includes('@');

export const publicHandle = (user) =>
  hasAt(user.username) ? `player${String(user._id ?? user.id ?? '').slice(-4)}` : user.username;

export const publicName = (user) => (user.displayName && !hasAt(user.displayName) ? user.displayName : publicHandle(user));

/** Usernames are handles: letters, numbers and `_ . -` only (never an email). */
export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,20}$/;
