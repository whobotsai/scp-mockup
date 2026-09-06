// Milestone Engine (KEEPER_SERVICE_DESIGN.md section 4.5, SHO half). PRD section 2.3:
// milestones unlock independently and cumulatively -- reaching 250K doesn't require 100K to
// have been claimed first -- so every unreached tier is checked every tick against the
// current TWAP mcap, not just "the next one in order."
//
// Posting the resulting root on-chain stays a manual step here (build-order step 2's own
// scope, KEEPER_SERVICE_DESIGN.md section 8: "proves the scoring is right before automating
// the posting") -- this module computes and stores the snapshot, then prints the exact
// postMilestoneRoot call (and the scripts/post-milestone-root.js command) to run by hand.
"use strict";
const { ethers } = require("ethers");
const { SHO_CAMPAIGN_ABI, MILESTONE_USD_THRESHOLDS } = require("./abis/sho");
const { timeWeightedAveragePrice, WINDOW_MS } = require("./twapOracle");
const { allocateProportional } = require("./rewardAllocator");
const { buildTree } = require("./merkleTree");
const { netBuyVolumeForCampaign } = require("./volumeAggregator");
const db = require("./db");

const ERC20_SUPPLY_ABI = ["function totalSupply() view returns (uint256)"];

async function checkMilestones(provider, campaign) {
  const poolConfig = await db.getTokenPool(campaign.token);
  if (!poolConfig) return; // nothing to price without a registered pool

  const samples = await db.priceSamplesSince(campaign.token, new Date(Date.now() - WINDOW_MS - 60_000));
  const twapPrice = timeWeightedAveragePrice(samples);
  if (twapPrice === null) {
    console.log(`[milestoneEngine] ${campaign.campaign_address}: not enough price history yet for a valid 30-min TWAP`);
    return;
  }

  const tokenContract = new ethers.Contract(campaign.token, ERC20_SUPPLY_ABI, provider);
  const totalSupply = await tokenContract.totalSupply();
  const circulatingMcap = twapPrice * Number(ethers.formatUnits(totalSupply, 18));

  // Logged every tick once TWAP is valid, even when nothing crosses below -- otherwise this
  // module goes completely silent for a campaign sitting under every threshold, which reads
  // indistinguishably from a crash on the terminal.
  console.log(`[milestoneEngine] ${campaign.campaign_address}: TWAP mcap $${circulatingMcap.toFixed(2)}`);

  const campaignContract = new ethers.Contract(campaign.campaign_address, SHO_CAMPAIGN_ABI, provider);
  const milestoneCount = Number(await campaignContract.milestoneCount());
  const totalLocked = await campaignContract.totalLocked();

  for (let i = 0; i < milestoneCount; i++) {
    const milestone = await campaignContract.getMilestone(i);
    if (milestone.reached) continue; // already finalized on-chain, nothing to do here

    const existing = await db.getSnapshot(campaign.campaign_address, i);
    if (existing) continue; // already computed (and printed) this tier's snapshot

    const threshold = MILESTONE_USD_THRESHOLDS[Number(milestone.tier)];
    if (circulatingMcap < threshold) continue; // not crossed yet

    console.log(
      `[milestoneEngine] ${campaign.campaign_address} milestone ${i} CROSSED: ` +
        `TWAP mcap $${circulatingMcap.toFixed(2)} >= threshold $${threshold.toLocaleString()}`
    );

    const leaderboard = (
      await netBuyVolumeForCampaign(campaign.campaign_address, Number(campaign.window_seconds))
    ).slice(0, campaign.leaderboard_size);

    if (leaderboard.length === 0) {
      console.log(`[milestoneEngine] ${campaign.campaign_address} milestone ${i}: no eligible wallets yet -- not snapshotting until there's at least one`);
      continue;
    }

    const milestoneReward = (totalLocked * BigInt(milestone.rewardBps)) / 10_000n;
    const allocations = allocateProportional(leaderboard, milestoneReward);
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

    console.log(`[milestoneEngine] Snapshot computed and stored. Post it on-chain by hand:`);
    console.log(`  npm run post-milestone-root -- ${campaign.campaign_address} ${i}`);
  }
}

module.exports = { checkMilestones };
