// On-chain Poster (KEEPER_SERVICE_DESIGN.md section 4.7): turns a published (IPFS-pinned)
// snapshot into an on-chain postMilestoneRoot (SHO) or postEpochRoot (SSO) call -- one
// shared module for both, dispatching on the snapshot's campaign's `factory` column, exactly
// as the design doc intends everything downstream of the Leaderboard & Milestone/Epoch
// Engine to be shared, not duplicated, between campaign types (section 4.5).
//
// Deliberate simplification: the design doc specs a 3-of-5 Gnosis Safe multi-sig proposing/
// approving/executing this call, gas funded from the protocol treasury -- PRD section 3.2
// names that multi-sig as the MVP's single trusted component precisely because a human
// approval step lives there. Standing up a real Safe needs 5 real signer keys and its own
// deployment, out of scope for this solo dev/testnet validation pass -- this module instead
// signs directly with KEEPER_PRIVATE_KEY (the single EOA both factories' keeper() already
// point at). root_submissions still tracks proposed/confirmed exactly as the multi-sig flow
// would, so swapping in a real Safe later changes *how* a root gets signed, not the
// idempotency/tracking model around it. Revisit before any campaign with real funds goes
// live (see docs/BACKEND_ROADMAP.md).
"use strict";
const { ethers } = require("ethers");
const { SHO_CAMPAIGN_ABI } = require("./abis/sho");
const { SSO_CAMPAIGN_ABI } = require("./abis/sso");
const db = require("./db");

/// Everything that differs between SHO and SSO for this module, in one place -- adding a
/// third campaign type later (if that ever happens) only needs a third entry here, not a
/// third copy of postPendingRoots' logic.
const FACTORY_CONFIG = {
  sho: {
    abi: SHO_CAMPAIGN_ABI,
    label: "milestone",
    getPeriod: (c, i) => c.getMilestone(i),
    isFinal: (period) => period.reached,
    post: (c, i, root, hash) => c.postMilestoneRoot(i, root, hash),
  },
  sso: {
    abi: SSO_CAMPAIGN_ABI,
    label: "epoch",
    getPeriod: (c, i) => c.getEpoch(i),
    isFinal: (period) => period.finalized,
    post: (c, i, root, hash) => c.postEpochRoot(i, root, hash),
  },
};

async function postPendingRoots(provider, keeperWallet) {
  const pending = await db.unpostedSnapshots();

  for (const snapshot of pending) {
    const campaignRow = await db.getCampaign(snapshot.campaign_address);
    if (!campaignRow || !FACTORY_CONFIG[campaignRow.factory]) {
      console.error(`[onchainPoster] ${snapshot.campaign_address}: unknown or missing campaign factory -- skipping`);
      continue;
    }
    const { abi, label, getPeriod, isFinal, post } = FACTORY_CONFIG[campaignRow.factory];
    const campaign = new ethers.Contract(snapshot.campaign_address, abi, keeperWallet);
    const period = await getPeriod(campaign, snapshot.index);

    if (isFinal(period)) {
      // Already posted on-chain -- most likely by a human running
      // scripts/post-milestone-root.js before this automatic path existed (exactly what
      // happened during this project's own build-order step 2 validation), or by an earlier
      // automated run whose transaction succeeded but crashed before recording it here.
      // Blindly posting again would hit the contract's *correction* path, not a no-op -- it
      // only reverts once the challenge window has actually elapsed, so re-running this while
      // that window is still open would silently reset it for a period nothing is wrong with.
      // Backfill the bookkeeping instead of sending a transaction -- deliberately independent
      // of whether this snapshot ever got an ipfs_cid, since a milestone/epoch can be
      // legitimately finalized on-chain regardless of whether its IPFS publish ever succeeded.
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "confirmed", txHash: null });
      await db.markSnapshotPosted(snapshot.campaign_address, snapshot.index);
      console.log(
        `[onchainPoster] ${snapshot.campaign_address} ${label} ${snapshot.index}: already finalized on-chain -- backfilled bookkeeping, no transaction sent`
      );
      continue;
    }

    if (!snapshot.ipfs_cid) {
      // Not finalized yet, and not published yet either -- wait for snapshotPublisher.js
      // rather than posting a root nobody can independently verify during the challenge
      // window (the whole point of publishing first, KEEPER_SERVICE_DESIGN.md section 4.6).
      continue;
    }

    try {
      console.log(`[onchainPoster] posting ${snapshot.campaign_address} ${label} ${snapshot.index}...`);
      const tx = await post(campaign, snapshot.index, snapshot.merkle_root, snapshot.snapshot_hash);
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "proposed", txHash: tx.hash });

      await tx.wait();
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "confirmed", txHash: tx.hash });
      await db.markSnapshotPosted(snapshot.campaign_address, snapshot.index);
      console.log(`[onchainPoster] ${snapshot.campaign_address} ${label} ${snapshot.index}: posted, tx=${tx.hash}`);
    } catch (e) {
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "failed", txHash: null });
      console.error(`[onchainPoster] ${snapshot.campaign_address} ${label} ${snapshot.index}: post failed:`, e.message);
    }
  }
}

module.exports = { postPendingRoots };
