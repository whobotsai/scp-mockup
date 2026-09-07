// Builds the ethers provider every route uses for live contract reads. Same FetchRequest
// timeout pattern keeper/src/index.js uses after a real incident there: an untimed RPC call
// hung an entire process indefinitely with no error at all (confirmed live). A shorter
// timeout than the keeper's 30s here (this serves interactive HTTP requests, not a background
// polling loop -- a slow RPC should fail an API response fast, not make a browser tab hang).
"use strict";
const { ethers } = require("ethers");

const RPC_TIMEOUT_MS = 12_000;

function buildProvider() {
  const fetchRequest = new ethers.FetchRequest(process.env.RPC_URL);
  fetchRequest.timeout = RPC_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(fetchRequest);
}

module.exports = { buildProvider, RPC_TIMEOUT_MS };
