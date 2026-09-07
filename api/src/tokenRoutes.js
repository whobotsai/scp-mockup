// Replaces the frontend prototype's hand-authored TOKEN_REGISTRY map + resolveToken()
// (docs/BACKEND_ROADMAP.md's Stage 2 scope calls this out explicitly: "now sourced from the
// real Pons.family indexer instead of a hand-authored map"). Since Pons.family integration
// itself is still blocked (see ../keeper/README.md's own stub for why), this reads what's
// actually available today: the ERC20 contract directly, plus the keeper's own indexed price
// samples for a real TWAP market cap. `website`/`twitter`/`holders` have no on-chain or
// keeper-indexed source at all -- returned as `null` rather than invented, an honest gap for
// frontend integration to design around (e.g. a creator-supplied profile field at campaign
// creation, out of scope for this API layer to decide unilaterally).
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const db = require("./db");
const { ERC20_ABI } = require("./abis");
const { timeWeightedAveragePrice, TWAP_WINDOW_MS } = require("./shared");

function router(provider) {
  const r = express.Router();

  r.get("/tokens/:address", async (req, res) => {
    const address = req.params.address;
    if (!ethers.isAddress(address)) return res.status(400).json({ error: "not a valid address" });

    try {
      const erc20 = new ethers.Contract(address, ERC20_ABI, provider);
      const [name, symbol, totalSupply] = await Promise.all([
        erc20.name().catch(() => null),
        erc20.symbol().catch(() => null),
        erc20.totalSupply().catch(() => null),
      ]);
      if (name === null && symbol === null) {
        return res.status(404).json({ error: "not an ERC20 token at this address (or the RPC call failed)" });
      }

      const samples = await db.priceSamplesSince(address, new Date(Date.now() - TWAP_WINDOW_MS - 60_000));
      const price = timeWeightedAveragePrice(samples);
      const mcap = price !== null && totalSupply !== null ? price * Number(ethers.formatUnits(totalSupply, 18)) : null;

      res.json({
        address,
        name,
        ticker: symbol,
        totalSupply: totalSupply !== null ? totalSupply.toString() : null,
        priceUsd: price,
        mcap,
        website: null,
        twitter: null,
        holders: null,
      });
    } catch (e) {
      res.status(502).json({ error: "failed to load token", detail: e.message });
    }
  });

  return r;
}

module.exports = { router };
