// Registration Service (Stage 0's last item, per BACKEND_ROADMAP.md): X OAuth 2.0 (PKCE) +
// wallet<->handle attestation signing. Handles the off-chain half of PRD.md section 12.3-12.4's
// registerHandle flow -- the wallet itself still submits registerHandle(xHandle, attestation)
// on-chain; this service only proves "this wallet completed OAuth for this X handle" and
// signs the attestation Registry.sol checks.
"use strict";
require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");
const { randomState, generateVerifier, challengeFor } = require("./pkce");
const { buildAuthorizeUrl, exchangeCodeForToken, fetchUserHandle } = require("./xOAuth");
const { signAttestation } = require("./attestation");
const sessions = require("./sessions");
const db = require("./db");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name} (see .env.example)`);
    process.exit(1);
  }
  return value;
}

const PORT = process.env.PORT || 3002;
const CLIENT_ID = requireEnv("X_CLIENT_ID");
const CLIENT_SECRET = requireEnv("X_CLIENT_SECRET");
const REDIRECT_URI = requireEnv("X_REDIRECT_URI");
const attestorWallet = new ethers.Wallet(requireEnv("ATTESTOR_PRIVATE_KEY"));
// Optional (Stage 2, docs/BACKEND_ROADMAP.md): the frontend's own origin. When set, the
// callback hands the result off to the frontend's hash router instead of rendering the debug
// page below -- see public/index.html's LinkXCallback, which is the piece that actually
// submits registerHandle(...) using the connected wallet. Unset by default so this service
// stays usable standalone for manual/dev testing exactly as before.
const FRONTEND_URL = process.env.FRONTEND_URL || null;

console.log(`Attestor address: ${attestorWallet.address}`);
console.log(
  "This must match Registry.attestor() on-chain (see ../contracts/deployments/46630.json's " +
    "\"attestor\" field) -- if it doesn't, call Registry.setAttestor(...) as the contract " +
    "owner to point it at this address."
);

const app = express();

app.get("/health", (_req, res) => res.json({ ok: true }));

// Hands the outcome off to FRONTEND_URL's hash router when configured (302, params in the
// fragment so they never hit any server log), otherwise falls back to the plain debug page
// this service has always rendered -- same fallback for both the success and error paths, so
// a partially-configured frontend never leaves the user looking at a raw Express error.
function sendResult(res, { wallet, handle, attestation, error }) {
  if (FRONTEND_URL) {
    const params = new URLSearchParams();
    if (wallet) params.set("wallet", wallet);
    if (handle) params.set("handle", handle);
    if (attestation) params.set("attestation", attestation);
    if (error) params.set("error", error);
    return res.redirect(`${FRONTEND_URL.replace(/\/$/, "")}/#/link-x?${params.toString()}`);
  }
  if (error) return res.status(400).send(error);
  res.type("html").send(`
      <!doctype html>
      <title>Registration complete</title>
      <pre>
Wallet:      ${wallet}
X handle:    ${handle}
Attestation: ${attestation}

Submit this on-chain yourself (from the wallet above) to finish linking:

  Registry.registerHandle("${handle}", "${attestation}")

Registry address: see ../contracts/deployments/46630.json
      </pre>
    `);
}

// Step 1: a wallet-connected frontend (Stage 2's job) redirects the user here with their
// wallet address, this service redirects to X's consent screen.
app.get("/auth/x/start", (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== "string" || !ethers.isAddress(wallet)) {
    return res.status(400).send("Missing or invalid ?wallet= query param.");
  }

  const state = randomState();
  const codeVerifier = generateVerifier();
  sessions.put(state, { wallet, codeVerifier });

  const authorizeUrl = buildAuthorizeUrl({
    state,
    codeChallenge: challengeFor(codeVerifier),
    redirectUri: REDIRECT_URI,
    clientId: CLIENT_ID,
  });
  res.redirect(authorizeUrl);
});

// Step 2: X redirects back here after the user approves (or denies) access.
app.get("/auth/x/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return sendResult(res, { error: `X declined authorization: ${error}` });
  }
  if (typeof code !== "string" || typeof state !== "string") {
    return sendResult(res, { error: "Missing code or state in callback." });
  }

  const session = sessions.take(state);
  if (!session) {
    return sendResult(res, { error: "Unknown or expired login session -- start over at /auth/x/start." });
  }

  try {
    const token = await exchangeCodeForToken({
      code,
      codeVerifier: session.codeVerifier,
      redirectUri: REDIRECT_URI,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    const xHandle = await fetchUserHandle(token.access_token);
    const attestation = await signAttestation(attestorWallet, session.wallet, xHandle);

    await db.recordRegistration(session.wallet, xHandle, attestation);

    sendResult(res, { wallet: session.wallet, handle: xHandle, attestation });
  } catch (e) {
    console.error(e);
    sendResult(res, { error: `Registration failed: ${e.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Registration Service listening on :${PORT}`);
});
