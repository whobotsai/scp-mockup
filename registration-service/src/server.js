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

const PORT = process.env.PORT || 3001;
const CLIENT_ID = requireEnv("X_CLIENT_ID");
const CLIENT_SECRET = requireEnv("X_CLIENT_SECRET");
const REDIRECT_URI = requireEnv("X_REDIRECT_URI");
const attestorWallet = new ethers.Wallet(requireEnv("ATTESTOR_PRIVATE_KEY"));

console.log(`Attestor address: ${attestorWallet.address}`);
console.log(
  "This must match Registry.attestor() on-chain (see ../contracts/deployments/46630.json's " +
    "\"attestor\" field) -- if it doesn't, call Registry.setAttestor(...) as the contract " +
    "owner to point it at this address."
);

const app = express();

app.get("/health", (_req, res) => res.json({ ok: true }));

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
    return res.status(400).send(`X declined authorization: ${error}`);
  }
  if (typeof code !== "string" || typeof state !== "string") {
    return res.status(400).send("Missing code or state in callback.");
  }

  const session = sessions.take(state);
  if (!session) {
    return res.status(400).send("Unknown or expired login session -- start over at /auth/x/start.");
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

    // No frontend to hand this off to yet (Stage 2) -- render it directly so this is usable
    // for manual/dev testing today, same spirit as contracts/scripts/test/*.js's manual
    // walkthrough before Stage 1 automated posting.
    res.type("html").send(`
      <!doctype html>
      <title>Registration complete</title>
      <pre>
Wallet:      ${session.wallet}
X handle:    ${xHandle}
Attestation: ${attestation}

Submit this on-chain yourself (from the wallet above) to finish linking:

  Registry.registerHandle("${xHandle}", "${attestation}")

Registry address: see ../contracts/deployments/46630.json
      </pre>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send(`Registration failed: ${e.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Registration Service listening on :${PORT}`);
});
