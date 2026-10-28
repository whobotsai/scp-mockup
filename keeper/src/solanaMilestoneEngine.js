// Solana counterpart of milestoneEngine.js. Same job (PRD section 2.3: every unreached tier
// is checked every tick against the current TWAP mcap, not just "the next one in order"), but
// reads campaign/token state directly from decoded account buffers instead of ethers.Contract
// calls, and sources its leaderboard from solanaTraderIndexer.js (Birdeye) instead of
// volumeAggregator.js's local trades table.
//
// twapOracle.js, rewardAllocator.js, and db.insertSnapshot/getSnapshot are reused unchanged --
// all already chain-agnostic (twapOracle operates on {price_usd, sampled_at} rows regardless
// of source; rewardAllocator is pure wallet/BigInt math; snapshots are keyed by
// campaign_address + index with no chain-specific fields). Only the merkle tree builder
// differs (solanaMerkleTree.js, not merkleTree.js -- see that module's own header for why).
"use strict";
const { PublicKey } = require("@solana/web3.js");
const { decodeShoCampaign, decodeMint, MILESTONE_USD_THRESHOLDS } = require("./abis/solana");
const { timeWeightedAveragePrice, WINDOW_MS } = require("./twapOracle");
const { allocateProportional } = require("./rewardAllocator");
const { buildTree } = require("./solanaMerkleTree");
const { netBuyVolumeForSolanaToken } = require("./solanaTraderIndexer");
const { ethers } = require("ethers");
const db = require("./db");

async function checkSolanaMilestones(connection, campaignRow) {
  const samples = await db.priceSamplesSince(campaignRow.token, new Date(Date.now() - WINDOW_MS - 60_000));
  const twapPrice = timeWeightedAveragePrice(samples);
  if (twapPrice === null) {
    console.log(`[solanaMilestoneEngine] ${campaignRow.campaign_address}: not enough price history yet for a valid 30-min TWAP`);
    return;
  }

  const mintInfo = await connection.getAccountInfo(new PublicKey(campaignRow.token));
  if (!mintInfo) {
    console.error(`[solanaMilestoneEngine] ${campaignRow.campaign_address}: tracked mint ${campaignRow.token} not found on-chain -- skipping`);
    return;
  }
  const mint = decodeMint(mintInfo.data);
  const circulatingMcap = twapPrice * Number(ethers.formatUnits(mint.supply, mint.decimals));

  console.log(`[solanaMilestoneEngine] ${campaignRow.campaign_address}: TWAP mcap $${circulatingMcap.toFixed(2)}`);

  const campaignInfo = await connection.getAccountInfo(new PublicKey(campaignRow.campaign_address));
  if (!campaignInfo) {
    console.error(`[solanaMilestoneEngine] ${campaignRow.campaign_address}: campaign account not found on-chain -- skipping`);
    return;
  }
  const campaign = decodeShoCampaign(campaignInfo.data);

  for (let i = 0; i < campaign.milestoneCount; i++) {
    const milestone = campaign.milestones[i];
    if (milestone.reached) continue; // already finalized on-chain, nothing to do here

    const existing = await db.getSnapshot(campaignRow.campaign_address, i);
    if (existing) continue; // already computed this tier's snapshot -- solanaOnchainPoster.js
    // picks up any unposted one on its own next tick, same as the EVM path.

    const threshold = MILESTONE_USD_THRESHOLDS[milestone.tier];
    if (circulatingMcap < threshold) continue; // not crossed yet

    console.log(
      `[solanaMilestoneEngine] ${campaignRow.campaign_address} milestone ${i} CROSSED: ` +
        `TWAP mcap $${circulatingMcap.toFixed(2)} >= threshold $${threshold.toLocaleString()}`
    );

    const leaderboard = await netBuyVolumeForSolanaToken(campaignRow.token, Number(campaignRow.window_seconds), campaignRow.leaderboard_size);
    if (leaderboard.length === 0) {
      console.log(`[solanaMilestoneEngine] ${campaignRow.campaign_address} milestone ${i}: no eligible wallets yet -- not snapshotting until there's at least one`);
      continue;
    }

    const milestoneReward = (campaign.totalLocked * BigInt(milestone.rewardBps)) / 10_000n;
    const allocations = allocateProportional(leaderboard, milestoneReward);
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

    console.log(`[solanaMilestoneEngine] Snapshot computed and stored -- solanaOnchainPoster.js will post it automatically.`);
  }
}

module.exports = { checkSolanaMilestones };
