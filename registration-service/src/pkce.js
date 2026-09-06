// OAuth 2.0 PKCE (RFC 7636) helpers -- X's OAuth 2.0 user-context flow requires PKCE.
"use strict";
const crypto = require("crypto");

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomState() {
  return base64url(crypto.randomBytes(24));
}

function generateVerifier() {
  return base64url(crypto.randomBytes(32)); // 43 chars, within RFC 7636's 43-128 range
}

function challengeFor(verifier) {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

module.exports = { randomState, generateVerifier, challengeFor };
