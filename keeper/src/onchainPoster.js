// On-chain Poster (KEEPER_SERVICE_DESIGN.md section 4.7): turns a published (IPFS-pinned)
// snapshot into an on-chain postMilestoneRoot call.
//
// Deliberate simplification: the design doc specs a 3-of-5 Gnosis Safe multi-sig proposing/
// approving/executing this call, gas funded from the protocol treasury -- PRD section 3.2
// names that multi-sig as the MVP's single trusted component precisely because a human
// approval step lives there. Standing up a real Safe needs 5 real signer keys and its own
// deployment, out of scope for this solo dev/testnet validation pass -- this module instead
// signs directly with KEEPER_PRIVATE_KEY (the single EOA SHOFactory.keeper() already points
// at). root_submissions still tracks proposed/confirmed exactly as the multi-sig flow would,
// so swapping in a real Safe later changes *how* a root gets signed, not the idempotency/
// tracking model around it. Revisit before any campaign with real funds goes live (see
// docs/BACKEND_ROADMAP.md).
"use strict";
const { ethers } = require("ethers");
const { SHO_CAMPAIGN_ABI } = require("./abis/sho");
const db = require("./db");

async function postPendingRoots(provider, keeperWallet) {
  const pending = await db.publishedUnpostedSnapshots();

  for (const snapshot of pending) {
    const campaign = new ethers.Contract(snapshot.campaign_address, SHO_CAMPAIGN_ABI, keeperWallet);
    const milestone = await campaign.getMilestone(snapshot.index);

    if (milestone.reached) {
      // Already posted on-chain -- most likely by a human running
      // scripts/post-milestone-root.js before this automatic path existed (exactly what
      // happened during this project's own build-order step 2 validation), or by an earlier
      // automated run whose transaction succeeded but crashed before recording it here.
      // Blindly calling postMilestoneRoot again would hit SHOCampaign.sol's *correction*
      // path, not a no-op -- it only reverts once the challenge window has actually elapsed,
      // so re-running this while that window is still open would silently reset it for a
      // milestone nothing is wrong with. Backfill the bookkeeping instead of sending a
      // transaction.
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "confirmed", txHash: null });
      await db.markSnapshotPosted(snapshot.campaign_address, snapshot.index);
      console.log(
        `[onchainPoster] ${snapshot.campaign_address} milestone ${snapshot.index}: already reached on-chain -- backfilled bookkeeping, no transaction sent`
      );
      continue;
    }

    try {
      console.log(`[onchainPoster] posting ${snapshot.campaign_address} milestone ${snapshot.index}...`);
      const tx = await campaign.postMilestoneRoot(snapshot.index, snapshot.merkle_root, snapshot.snapshot_hash);
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "proposed", txHash: tx.hash });

      await tx.wait();
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "confirmed", txHash: tx.hash });
      await db.markSnapshotPosted(snapshot.campaign_address, snapshot.index);
      console.log(`[onchainPoster] ${snapshot.campaign_address} milestone ${snapshot.index}: posted, tx=${tx.hash}`);
    } catch (e) {
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "failed", txHash: null });
      console.error(`[onchainPoster] ${snapshot.campaign_address} milestone ${snapshot.index}: post failed:`, e.message);
    }
  }
}

module.exports = { postPendingRoots };
