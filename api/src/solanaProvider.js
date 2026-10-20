// Builds the Solana connection shoRoutes.js/ssoRoutes.js use for live Solana campaign
// reads. Optional, same posture as the keeper's own SOLANA_RPC_URL (see
// ../../keeper/src/index.js): unset means this API stays EVM-only, and any indexed Solana
// campaign row just fails its per-row summary load with a clear logged reason (see
// shoRoutes.js's loadSummarySafe) rather than 502-ing the whole campaigns list.
"use strict";
const { Connection } = require("@solana/web3.js");

function buildSolanaConnection() {
  if (!process.env.SOLANA_RPC_URL) return null;
  return new Connection(process.env.SOLANA_RPC_URL, "confirmed");
}

module.exports = { buildSolanaConnection };
