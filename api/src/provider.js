// Builds the ethers provider every EVM route uses for live contract reads. Same FetchRequest
// timeout pattern keeper/src/index.js uses after a real incident there: an untimed RPC call
// hung an entire process indefinitely with no error at all (confirmed live). A shorter
// timeout than the keeper's 30s here (this serves interactive HTTP requests, not a background
// polling loop -- a slow RPC should fail an API response fast, not make a browser tab hang).
//
// Optional, same posture as solanaProvider.js's buildSolanaConnection(): unset means this API
// stays Solana-only (EVM/Robinhood deferred to a later phase -- see server.js), and
// shoRoutes.js/ssoRoutes.js's loadSummarySafe already dispatches by row.network, so an EVM
// campaign row just fails its per-row load with a clear logged reason instead of crashing
// startup or 502-ing every other campaign.
"use strict";
const { ethers } = require("ethers");

const RPC_TIMEOUT_MS = 12_000;

function buildProvider() {
  if (!process.env.RPC_URL) return null;
  const fetchRequest = new ethers.FetchRequest(process.env.RPC_URL);
  fetchRequest.timeout = RPC_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(fetchRequest);
}

module.exports = { buildProvider, RPC_TIMEOUT_MS };
