// The one endpoint an actual claim transaction depends on: given a campaign, a
// milestone/epoch index, and a wallet, returns the exact (amount, proof) pair that wallet
// needs to call claim(index, amount, proof) itself -- both SHOCampaign.claim and
// SSOCampaign.claim share this identical signature on EVM, and claim_sol/claim_spl take the
// same (index, amount, proof) shape on Solana, so the frontend needs no factory-specific
// branching here, only network branching (dispatched below by the campaign row's own
// `network` column, same pattern shoRoutes.js/ssoRoutes.js already use). Rebuilds the Merkle
// tree from the snapshot's stored entries -- via shared.js's EVM tree for an 'evm' row,
// solanaMerkleTree.js's Solana tree for a 'solana' one (see that module's own header on why
// the leaf encoding differs between chains) -- and refuses to hand back a proof if the
// rebuilt root doesn't match what's actually posted on-chain, same safety check
// keeper/scripts/claim-milestone.js already does for EVM.
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const { PublicKey } = require("@solana/web3.js");
const db = require("./db");
const { buildTree: buildEvmTree } = require("./shared");
const { buildTree: buildSolanaTree } = require("./solanaMerkleTree");

function isValidSolanaAddress(address) {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/// Builds and validates a proof for a wallet/index against an already-fetched snapshot,
/// shared by both network branches below -- the only thing that differs between them is how
/// a wallet is found in `entries` (case-insensitive hex for EVM; base58 is case-sensitive, so
/// an exact match for Solana -- comparing it case-insensitively would be wrong, not just
/// unnecessary, since base58's alphabet treats e.g. "A" and "a" as entirely different
/// characters, not case variants of the same address) and which tree builder rebuilds it.
function resolveClaimProof(snapshot, wallet, index, { buildTree, walletMatches }) {
  const entryIndex = snapshot.entries.findIndex((e) => walletMatches(e.account, wallet));
  if (entryIndex === -1) return { error: 404, body: { error: "this wallet is not in this milestone/epoch's leaderboard snapshot" } };

  const tree = buildTree(snapshot.entries);
  if (tree.root !== snapshot.merkle_root) {
    // Should never happen -- would mean the stored entries and stored root have drifted apart
    // somehow. Refuse rather than hand back a proof that won't verify on-chain.
    return { error: 500, body: { error: "rebuilt tree root does not match the stored snapshot's root" } };
  }

  return {
    body: {
      index,
      wallet: snapshot.entries[entryIndex].account,
      amount: snapshot.entries[entryIndex].amount,
      proof: tree.proofFor(entryIndex),
      merkleRoot: snapshot.merkle_root,
    },
  };
}

function router() {
  const r = express.Router();

  r.get("/campaigns/:address/claim-proof", async (req, res) => {
    const campaignAddress = req.params.address;
    const wallet = req.query.wallet;
    const index = Number(req.query.index);

    if (!wallet) return res.status(400).json({ error: "query param 'wallet' is required" });
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: "query param 'index' (integer >= 0) is required" });

    try {
      const campaignRow = await db.getCampaign(campaignAddress);
      if (!campaignRow) return res.status(404).json({ error: "unknown campaign address" });

      const snapshot = await db.getSnapshot(campaignAddress, index);
      if (!snapshot) return res.status(404).json({ error: "no computed snapshot for this campaign/index yet" });

      let result;
      if (campaignRow.network === "solana") {
        if (!isValidSolanaAddress(wallet)) return res.status(400).json({ error: "query param 'wallet' is not a valid Solana address" });
        result = resolveClaimProof(snapshot, wallet, index, {
          buildTree: buildSolanaTree,
          walletMatches: (account, w) => account === w,
        });
      } else {
        if (!ethers.isAddress(wallet)) return res.status(400).json({ error: "query param 'wallet' is not a valid address" });
        result = resolveClaimProof(snapshot, wallet, index, {
          buildTree: buildEvmTree,
          walletMatches: (account, w) => account.toLowerCase() === w.toLowerCase(),
        });
      }

      if (result.error) return res.status(result.error).json(result.body);
      res.json({ campaignAddress, network: campaignRow.network || "evm", ...result.body });
    } catch (e) {
      console.error(`[GET /campaigns/${campaignAddress}/claim-proof]`, e);
      res.status(502).json({ error: "failed to build claim proof", detail: e.message });
    }
  });

  return r;
}

module.exports = { router };
