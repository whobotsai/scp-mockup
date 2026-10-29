// Solana counterpart of epochEngine.js. Same job (every unfinalized epoch whose window has
// closed gets its leaderboard frozen, reward allocated, Merkle tree built, snapshot stored),
// reading epoch state from a decoded sso_solana Campaign account instead of live contract
// calls. epochScoresForCampaign (socialScoreAggregator.js) and allocateProportional
// (rewardAllocator.js) are reused completely unchanged -- both already chain-agnostic, same
// as they are for solanaMilestoneEngine.js's SHO equivalent. Only the merkle tree builder
// differs (solanaMerkleTree.js, not merkleTree.js -- see that module's own header for why).
"use strict";
const { PublicKey } = require("@solana/web3.js");
const { decodeSsoCampaign } = require("./abis/solana");
const { epochScoresForCampaign } = require("./socialScoreAggregator");
const { allocateProportional } = require("./rewardAllocator");
const { buildTree } = require("./solanaMerkleTree");
const { ethers } = require("ethers");
const db = require("./db");

async function checkSolanaEpochs(connection, campaignRow) {
  const info = await connection.getAccountInfo(new PublicKey(campaignRow.campaign_address));
  if (!info) {
    console.error(`[solanaEpochEngine] ${campaignRow.campaign_address}: campaign account not found on-chain -- skipping`);
    return;
  }
  const campaign = decodeSsoCampaign(info.data);
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < campaign.epochCount; i++) {
    const epoch = campaign.epochs[i];
    if (epoch.finalized) continue; // one-way, per the program's own logic
    if (now < Number(epoch.endsAt)) continue; // window still open -- nothing to close yet

    const existing = await db.getSnapshot(campaignRow.campaign_address, i);
    if (existing) continue; // already computed this epoch's snapshot

    console.log(`[solanaEpochEngine] ${campaignRow.campaign_address} epoch ${i}: window closed, computing snapshot`);

    const leaderboard = (await epochScoresForCampaign(campaignRow.campaign_address, i)).slice(0, campaignRow.leaderboard_size);

    if (leaderboard.length === 0) {
      console.log(
        `[solanaEpochEngine] ${campaignRow.campaign_address} epoch ${i}: zero qualifying posts -- not snapshotting, ` +
          `this epoch's share locks permanently (same no-refund rule as an unreached SHO milestone)`
      );
      continue;
    }

    const epochReward = (campaign.totalLocked * BigInt(epoch.rewardBps)) / 10_000n;
    const allocations = allocateProportional(leaderboard, epochReward);
    const entries = allocations.map((a) => ({ account: a.account, amount: a.amount.toString() }));

    const tree = buildTree(allocations);
    const snapshotHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(entries)));

    await db.insertSnapshot({
      campaignAddress: campaignRow.campaign_address,
      index: i,
      merkleRoot: tree.root,
      snapshotHash,
      entries,
    });

    console.log(
      `[solanaEpochEngine] ${campaignRow.campaign_address} epoch ${i}: snapshot computed and stored -- ` +
        `solanaOnchainPoster.js picks this up automatically next tick`
    );
  }
}

module.exports = { checkSolanaEpochs };
