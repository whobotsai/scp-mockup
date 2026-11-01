// Entry point: the Stage 2 API layer (docs/BACKEND_ROADMAP.md) -- a thin read/aggregation
// service in front of the keeper's Postgres and direct contract reads, never a second source
// of truth. Everything it returns is reconstructable from chain history plus the keeper's
// published snapshots.
//
// Solana-only by default now (EVM/Robinhood deferred to a later phase -- see
// docs/SOLANA_MAINNET_LAUNCH_PLAN.md). RPC_URL is optional, same posture as SOLANA_RPC_URL
// always had: unset means EVM campaign reads stay off (shoRoutes.js/ssoRoutes.js dispatch by
// row.network and degrade a single bad row rather than crash). tokenRoutes.js/walletRoutes.js
// are EVM-only with no Solana counterpart written yet (see walletRoutes.js's own header) and
// nothing in the frontend calls them anymore, so they're left unmounted here rather than
// deleted -- easy to re-enable when the EVM phase resumes.
"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { buildProvider } = require("./provider");
const { buildSolanaConnection } = require("./solanaProvider");
const shoRoutes = require("./shoRoutes");
const ssoRoutes = require("./ssoRoutes");
const claimRoutes = require("./claimRoutes");

function main() {
  const provider = buildProvider();
  if (!provider) {
    console.log("[api] RPC_URL not set -- EVM campaigns will fail to load individually, not block the API.");
  }
  const solanaConnection = buildSolanaConnection();
  if (!solanaConnection) {
    console.log("[api] SOLANA_RPC_URL not set -- Solana campaigns will fail to load individually, not block the API.");
  }
  const app = express();
  app.use(cors());

  app.get("/health", (req, res) => res.json({ ok: true }));

  app.use(shoRoutes.router(provider, solanaConnection));
  app.use(ssoRoutes.router(provider, solanaConnection));
  app.use(claimRoutes.router());

  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => console.log(`API listening on :${port}`));
}

main();
