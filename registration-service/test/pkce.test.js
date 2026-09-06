"use strict";
const crypto = require("crypto");
const { test, summary } = require("./helpers/harness");
const { randomState, generateVerifier, challengeFor } = require("../src/pkce");

test("generateVerifier produces a URL-safe string within RFC 7636's 43-128 char range", () => {
  const v = generateVerifier();
  if (v.length < 43 || v.length > 128) throw new Error(`length ${v.length} out of range`);
  if (/[+/=]/.test(v)) throw new Error("verifier contains non-URL-safe base64 characters");
});

test("challengeFor is deterministic for the same verifier", () => {
  const v = generateVerifier();
  if (challengeFor(v) !== challengeFor(v)) throw new Error("challenge should be deterministic");
});

test("challengeFor matches a manually computed sha256 base64url digest", () => {
  const v = "test-verifier-value";
  const expected = crypto
    .createHash("sha256")
    .update(v)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (challengeFor(v) !== expected) throw new Error("challenge does not match manual sha256/base64url computation");
});

test("randomState produces different values each call", () => {
  if (randomState() === randomState()) throw new Error("randomState should not repeat (astronomically unlikely if correct)");
});

summary();
