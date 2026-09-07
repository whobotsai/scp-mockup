// The one endpoint an actual claim transaction depends on: given a campaign, a
// milestone/epoch index, and a wallet, returns the exact (amount, proof) pair that wallet
// needs to call claim(index, amount, proof) itself -- both SHOCampaign.claim and
// SSOCampaign.claim share this identical signature, so the frontend needs no factory-specific
// branching here at all. Rebuilds the Merkle tree from the snapshot's stored entries via
// shared.js's direct port of merkleTree.js (see that file's own header on why this can't be
// an approximation the way the display-only leaderboard queries in db.js are) and refuses to
// hand back a proof if the rebuilt root doesn't match what's actually posted on-chain --
// same safety check keeper/scripts/claim-milestone.js already does.
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const db = require("./db");
const { buildTree } = require("./shared");

function router() {
  const r = express.Router();

  r.get("/campaigns/:address/claim-proof", async (req, res) => {
    const campaignAddress = req.params.address;
    const wallet = req.query.wallet;
    const index = Number(req.query.index);

    if (!ethers.isAddress(campaignAddress)) return res.status(400).json({ error: "not a valid campaign address" });
    if (!wallet || !ethers.isAddress(wallet)) return res.status(400).json({ error: "query param 'wallet' (address) is required" });
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: "query param 'index' (integer >= 0) is required" });

    try {
      const snapshot = await db.getSnapshot(campaignAddress, index);
      if (!snapshot) return res.status(404).json({ error: "no computed snapshot for this campaign/index yet" });

      const entryIndex = snapshot.entries.findIndex((e) => e.account.toLowerCase() === wallet.toLowerCase());
      if (entryIndex === -1) {
        return res.status(404).json({ error: "this wallet is not in this milestone/epoch's leaderboard snapshot" });
      }

      const tree = buildTree(snapshot.entries);
      if (tree.root !== snapshot.merkle_root) {
        // Should never happen -- would mean the stored entries and stored root have drifted
        // apart somehow. Refuse rather than hand back a proof that won't verify on-chain.
        return res.status(500).json({ error: "rebuilt tree root does not match the stored snapshot's root" });
      }

      res.json({
        campaignAddress,
        index,
        wallet: snapshot.entries[entryIndex].account,
        amount: snapshot.entries[entryIndex].amount,
        proof: tree.proofFor(entryIndex),
        merkleRoot: snapshot.merkle_root,
      });
    } catch (e) {
      res.status(502).json({ error: "failed to build claim proof", detail: e.message });
    }
  });

  return r;
}

module.exports = { router };
