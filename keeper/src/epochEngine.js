// Epoch Engine (KEEPER_SERVICE_DESIGN.md §4.5, SSO half). PRD §12.3: SSO doesn't depend on
// price/mcap at all, only on the calendar -- so unlike milestoneEngine.js's SHO half (which
// waits for a TWAP crossing), this checks every unfinalized epoch's scheduled endsAt against
// wall-clock time. Once an epoch's window has closed, freeze the leaderboard (via
// socialScoreAggregator.js), allocate the reward proportionally, build the Merkle tree, and
// store the snapshot -- reusing rewardAllocator.js/merkleTree.js/db.insertSnapshot verbatim,
// exactly as KEEPER_SERVICE_DESIGN.md §4.5 intends this engine to be shared, not duplicated,
// between SHO and SSO.
//
// Posting the resulting root on-chain is onchainPoster.js's job (build-order step 3, already
// shared between both campaign types) -- this module only computes and stores the snapshot.
"use strict";
const { ethers } = require("ethers");
const { SSO_CAMPAIGN_ABI } = require("./abis/sso");
const { epochScoresForCampaign } = require("./socialScoreAggregator");
const { allocateProportional } = require("./rewardAllocator");
const { buildTree } = require("./merkleTree");
const db = require("./db");

async function checkEpochs(provider, campaign) {
  const campaignContract = new ethers.Contract(campaign.campaign_address, SSO_CAMPAIGN_ABI, provider);
  const epochCount = Number(await campaignContract.epochCount());
  const totalLocked = await campaignContract.totalLocked();
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < epochCount; i++) {
    const epoch = await campaignContract.getEpoch(i);
    if (epoch.finalized) continue; // one-way, per the contract's own comment
    if (now < Number(epoch.endsAt)) continue; // window still open -- nothing to close yet

    const existing = await db.getSnapshot(campaign.campaign_address, i);
    if (existing) continue; // already computed (and logged) this epoch's snapshot

    console.log(`[epochEngine] ${campaign.campaign_address} epoch ${i}: window closed, computing snapshot`);

    const leaderboard = (await epochScoresForCampaign(campaign.campaign_address, i)).slice(0, campaign.leaderboard_size);

    if (leaderboard.length === 0) {
      console.log(
        `[epochEngine] ${campaign.campaign_address} epoch ${i}: zero qualifying posts -- not snapshotting, ` +
          `this epoch's share locks permanently (PRD §12.2/§12.4, same no-refund rule as an unreached SHO milestone)`
      );
      continue;
    }

    const epochReward = (totalLocked * BigInt(epoch.rewardBps)) / 10_000n;
    const allocations = allocateProportional(leaderboard, epochReward);
    const entries = allocations.map((a) => ({ account: a.account, amount: a.amount.toString() }));

    const tree = buildTree(allocations);
    const snapshotHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(entries)));

    await db.insertSnapshot({
      campaignAddress: campaign.campaign_address,
      index: i,
      merkleRoot: tree.root,
      snapshotHash,
      entries,
    });

    console.log(
      `[epochEngine] ${campaign.campaign_address} epoch ${i}: snapshot computed and stored -- ` +
        `onchainPoster.js picks this up automatically next tick`
    );
  }
}

module.exports = { checkEpochs };
