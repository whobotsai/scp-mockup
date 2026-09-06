// Short-lived, in-memory store for in-flight OAuth attempts, keyed by the `state` param.
// An OAuth authorization-code flow lives for at most a few minutes (the time a user takes to
// approve on X's consent screen), so this doesn't need Postgres durability -- a service
// restart mid-flow just means that one login attempt has to be retried, not a real data loss.
"use strict";

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes -- generous for a human to click "Authorize"
const sessions = new Map();

function put(state, data) {
  sessions.set(state, { ...data, expiresAt: Date.now() + SESSION_TTL_MS });
}

function take(state) {
  const entry = sessions.get(state);
  sessions.delete(state); // one-time use -- an authorization code is single-use too
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}

// Periodic sweep so an abandoned login (user never completes the X consent screen) doesn't
// leak memory forever. Not correctness-critical, just housekeeping.
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of sessions) {
    if (now > entry.expiresAt) sessions.delete(state);
  }
}, 60 * 1000).unref();

module.exports = { put, take };
