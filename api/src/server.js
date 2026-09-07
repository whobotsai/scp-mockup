// Entry point: the Stage 2 API layer (docs/BACKEND_ROADMAP.md) -- a thin read/aggregation
// service in front of the keeper's Postgres and direct contract reads, never a second source
// of truth. Everything it returns is reconstructable from chain history plus the keeper's
// published snapshots.
"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { buildProvider } = require("./provider");
const shoRoutes = require("./shoRoutes");
const ssoRoutes = require("./ssoRoutes");
const tokenRoutes = require("./tokenRoutes");
const walletRoutes = require("./walletRoutes");
const claimRoutes = require("./claimRoutes");

function main() {
  const provider = buildProvider();
  const app = express();
  app.use(cors());

  app.get("/health", (req, res) => res.json({ ok: true }));

  app.use(shoRoutes.router(provider));
  app.use(ssoRoutes.router(provider));
  app.use(tokenRoutes.router(provider));
  app.use(walletRoutes.router(provider));
  app.use(claimRoutes.router());

  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => console.log(`API listening on :${port}`));
}

main();
