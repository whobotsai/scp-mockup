// Registration Service (Stage 0's last item, per BACKEND_ROADMAP.md): X OAuth 2.0 (PKCE) +
// wallet<->handle attestation signing. Handles the off-chain half of PRD.md section 12.3-12.4's
// registerHandle flow -- the wallet itself still submits registerHandle(xHandle, attestation)
// on-chain; this service only proves "this wallet completed OAuth for this X handle" and
// signs the attestation Registry.sol checks.
"use strict";
require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");
const { PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58");
const { randomState, generateVerifier, challengeFor } = require("./pkce");
const { buildAuthorizeUrl, exchangeCodeForToken, fetchUserHandle } = require("./xOAuth");
const { signAttestation } = require("./attestation");
const { loadSolanaAttestorKeypair, signSolanaMessage } = require("./solanaAttestation");
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

function isValidSolanaAddress(address) {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

const PORT = process.env.PORT || 3002;
const CLIENT_ID = requireEnv("X_CLIENT_ID");
const CLIENT_SECRET = requireEnv("X_CLIENT_SECRET");
const REDIRECT_URI = requireEnv("X_REDIRECT_URI");
const attestorWallet = new ethers.Wallet(requireEnv("ATTESTOR_PRIVATE_KEY"));
// Optional, unlike ATTESTOR_PRIVATE_KEY above: a *different* key (Ed25519, not secp256k1 --
// see solanaAttestation.js's own header for why the EVM attestor key can't be reused as-is).
// This service still boots and works EVM-only without it, same "optional, stays off without
// it" posture the rest of this project's Solana support uses.
const solanaAttestorKeypair = process.env.SOLANA_ATTESTOR_PRIVATE_KEY
  ? loadSolanaAttestorKeypair(process.env.SOLANA_ATTESTOR_PRIVATE_KEY)
  : null;
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
if (solanaAttestorKeypair) {
  console.log(`Solana attestor pubkey: ${solanaAttestorKeypair.publicKey.toBase58()}`);
  console.log(
    "This must match registry_solana's Config.attestor on-chain -- if it doesn't, call " +
      "set_attestor as the program's authority to point it at this pubkey."
  );
} else {
  console.log("SOLANA_ATTESTOR_PRIVATE_KEY not set -- Solana handle registration is disabled this run.");
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// The frontend needs the attestor's pubkey *before* building a register_handle transaction
// (to list it as the second Signer account -- see registry_solana/src/lib.rs), i.e. before
// it has anything to post to /attest/solana yet. Cheap to expose directly rather than making
// the frontend read it off-chain (Config.attestor) just to bootstrap the same flow this
// service's own key already determines.
app.get("/solana-attestor", (_req, res) => {
  if (!solanaAttestorKeypair) return res.status(503).json({ error: "Solana handle registration is not configured on this service." });
  res.json({ pubkey: solanaAttestorKeypair.publicKey.toBase58() });
});

// Hands the outcome off to FRONTEND_URL's hash router when configured (302, params in the
// fragment so they never hit any server log), otherwise falls back to the plain debug page
// this service has always rendered -- same fallback for both the success and error paths, so
// a partially-configured frontend never leaves the user looking at a raw Express error.
// `network` defaults to 'evm' in the debug-page branch below purely for that page's own
// wording; the frontend branch always passes it through explicitly.
function sendResult(res, { wallet, handle, attestation, network, error }) {
  if (FRONTEND_URL) {
    const params = new URLSearchParams();
    if (wallet) params.set("wallet", wallet);
    if (handle) params.set("handle", handle);
    if (attestation) params.set("attestation", attestation);
    if (network) params.set("network", network);
    if (error) params.set("error", error);
    return res.redirect(`${FRONTEND_URL.replace(/\/$/, "")}/#/link-x?${params.toString()}`);
  }
  if (error) return res.status(400).send(error);
  if (network === "solana") {
    return res.type("html").send(`
      <!doctype html>
      <title>Registration complete (Solana)</title>
      <pre>
Wallet:   ${wallet}
X handle: ${handle}

OAuth verified. This service doesn't hand back a ready-to-submit attestation for Solana the
way it does for EVM -- the frontend builds the register_handle transaction itself, then posts
its message bytes to POST /attest/solana (with this exact wallet + handle) to get the
attestor's co-signature, attaches it alongside the wallet's own signature, and submits.
See public/index.html's Solana "link X" flow and solanaAttestation.js's own header for why.
      </pre>
    `);
  }
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
// wallet address, this service redirects to X's consent screen. `?network=solana` switches
// wallet validation (base58 pubkey, not a 0x address) and tags the session so the callback
// below knows which attestation path to take.
app.get("/auth/x/start", (req, res) => {
  const wallet = req.query.wallet;
  const network = req.query.network === "solana" ? "solana" : "evm";
  const walletValid = network === "solana" ? isValidSolanaAddress(wallet) : typeof wallet === "string" && ethers.isAddress(wallet);
  if (typeof wallet !== "string" || !walletValid) {
    return res.status(400).send(`Missing or invalid ?wallet= query param${network === "solana" ? " (expected a base58 Solana address)" : ""}.`);
  }
  if (network === "solana" && !solanaAttestorKeypair) {
    return res.status(503).send("Solana handle registration is not configured on this service (SOLANA_ATTESTOR_PRIVATE_KEY unset).");
  }

  const state = randomState();
  const codeVerifier = generateVerifier();
  sessions.put(state, { wallet, codeVerifier, network });

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

    if (session.network === "solana") {
      // No attestation to hand back yet -- see POST /attest/solana below for why. This marker
      // records that `wallet` genuinely completed OAuth for `xHandle` just now, so that
      // endpoint can refuse to sign for a (wallet, xHandle) pair nobody actually verified.
      // One-time use (sessions.take), same as the OAuth `state` above -- if the frontend's
      // transaction needs rebuilding (e.g. an expired blockhash) after this is consumed, the
      // user has to redo OAuth, an acceptable v1 UX tradeoff.
      sessions.put(`solana-verified:${session.wallet}`, { xHandle });
      return sendResult(res, { wallet: session.wallet, handle: xHandle, network: "solana" });
    }

    const attestation = await signAttestation(attestorWallet, session.wallet, xHandle);
    await db.recordRegistration(session.wallet, xHandle, attestation);
    sendResult(res, { wallet: session.wallet, handle: xHandle, attestation, network: "evm" });
  } catch (e) {
    console.error(e);
    sendResult(res, { error: `Registration failed: ${e.message}` });
  }
});

// Co-signs a Solana register_handle transaction's message on behalf of the attestor, once
// OAuth has genuinely verified (wallet, xHandle) via the callback above (see its own
// comment). Request body: { wallet, xHandle, messageBase64 } -- messageBase64 is the exact
// unsigned transaction message the frontend built (Transaction.compileMessage().serialize(),
// base64-encoded); response: { signature } (base58, matching what
// Transaction.addSignature(pubkey, Buffer) on the frontend expects after base58-decoding).
app.post("/attest/solana", (req, res) => {
  if (!solanaAttestorKeypair) {
    return res.status(503).json({ error: "Solana handle registration is not configured on this service." });
  }
  const { wallet, xHandle, messageBase64 } = req.body || {};
  if (typeof wallet !== "string" || !isValidSolanaAddress(wallet)) {
    return res.status(400).json({ error: "'wallet' must be a valid base58 Solana address." });
  }
  if (typeof xHandle !== "string" || xHandle.length === 0) {
    return res.status(400).json({ error: "'xHandle' is required." });
  }
  if (typeof messageBase64 !== "string" || messageBase64.length === 0) {
    return res.status(400).json({ error: "'messageBase64' is required." });
  }

  const verified = sessions.take(`solana-verified:${wallet}`);
  if (!verified || verified.xHandle !== xHandle) {
    return res.status(403).json({
      error: "No recent OAuth verification found for this exact (wallet, xHandle) pair -- start over at /auth/x/start?network=solana.",
    });
  }

  try {
    const messageBytes = Buffer.from(messageBase64, "base64");
    const signature = signSolanaMessage(solanaAttestorKeypair, messageBytes);
    // Both encodings of the same 64 signature bytes: base58 (Solana-ecosystem-conventional,
    // what signSolanaMessage itself returns) and base64 (what the frontend actually uses --
    // avoids needing a base58 decoder in the browser just for this one value, when base64
    // decoding is already a one-line browser built-in, atob).
    const signatureBase64 = bs58.decode(signature).toString("base64");
    res.json({ signature, signatureBase64, attestorPubkey: solanaAttestorKeypair.publicKey.toBase58() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: `Failed to sign: ${e.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Registration Service listening on :${PORT}`);
});
