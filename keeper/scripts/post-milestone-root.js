// Posts a milestone snapshot computed by src/milestoneEngine.js on-chain by hand -- normally
// src/onchainPoster.js does this automatically as part of build-order step 3, so this script
// is now a manual override/backfill tool rather than the primary path. Requires
// KEEPER_PRIVATE_KEY, since SHOCampaign.postMilestoneRoot is onlyKeeper.
//
// Usage: node scripts/post-milestone-root.js <campaignAddress> <milestoneIndex>
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { SHO_CAMPAIGN_ABI } = require("../src/abis/sho");
const db = require("../src/db");

async function main() {
  const [campaignAddress, indexStr] = process.argv.slice(2);
  if (!campaignAddress || indexStr === undefined) {
    console.error("Usage: node scripts/post-milestone-root.js <campaignAddress> <milestoneIndex>");
    process.exit(1);
  }
  const index = Number(indexStr);

  const rpcUrl = process.env.RPC_URL;
  const keeperPrivateKey = process.env.KEEPER_PRIVATE_KEY;
  if (!rpcUrl || !keeperPrivateKey) {
    console.error("Set RPC_URL and KEEPER_PRIVATE_KEY in .env first (see .env.example).");
    process.exit(1);
  }

  const snapshot = await db.getSnapshot(campaignAddress, index);
  if (!snapshot) {
    console.error(`No computed snapshot found for ${campaignAddress} milestone ${index}.`);
    console.error("Run the keeper (npm start) until milestoneEngine reports this milestone crossed first.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const keeper = new ethers.Wallet(keeperPrivateKey, provider);
  const campaign = new ethers.Contract(campaignAddress, SHO_CAMPAIGN_ABI, keeper);

  const milestone = await campaign.getMilestone(index);
  if (milestone.reached) {
    console.error(
      `Milestone ${index} is already reached on-chain -- posting again would hit the ` +
        `*correction* path (SHOCampaign.sol's postMilestoneRoot), which only reverts once the ` +
        `challenge window has elapsed, so this would silently reset that window if it's still open.`
    );
    console.error("Refusing to send a transaction. If this really needs correcting, do that deliberately, not via this script's default path.");
    process.exit(1);
  }

  console.log(`Posting milestone ${index} root for ${campaignAddress}...`);
  console.log(`  merkleRoot:   ${snapshot.merkle_root}`);
  console.log(`  snapshotHash: ${snapshot.snapshot_hash}`);
  console.log(`  entries:      ${snapshot.entries.length}`);

  const tx = await campaign.postMilestoneRoot(index, snapshot.merkle_root, snapshot.snapshot_hash);
  console.log(`Tx sent: ${tx.hash}`);
  await tx.wait();
  console.log("Posted. The 24h challenge window has now started -- claim() opens once it elapses.");

  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
