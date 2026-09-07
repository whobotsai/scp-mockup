// Claims a wallet's share of a posted milestone reward, using the exact snapshot
// milestoneEngine.js computed and post-milestone-root.js already posted on-chain. Same
// claim(milestoneIndex, amount, proof) call as contracts/scripts/test/03-claim.js's Stage 0
// walkthrough, generalized to any campaign/wallet instead of that script's hand-built
// single-leaf tree -- the proof here is rebuilt from the snapshot's real multi-entry tree via
// merkleTree.js's buildTree (same leaf/hash logic ClaimVerifier.sol already verifies on-chain,
// see that module's own header).
//
// Usage: node scripts/claim-milestone.js <campaignAddress> <milestoneIndex> [walletAddress]
// walletAddress defaults to the address recovered from CLAIMANT_PRIVATE_KEY -- pass it
// explicitly only to double check which entry you're about to claim before signing anything.
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { SHO_CAMPAIGN_ABI } = require("../src/abis/sho");
const { buildTree } = require("../src/merkleTree");
const db = require("../src/db");

async function main() {
  const [campaignAddress, indexStr, walletArg] = process.argv.slice(2);
  if (!campaignAddress || indexStr === undefined) {
    console.error("Usage: node scripts/claim-milestone.js <campaignAddress> <milestoneIndex> [walletAddress]");
    process.exit(1);
  }
  const index = Number(indexStr);

  const rpcUrl = process.env.RPC_URL;
  const claimantPrivateKey = process.env.CLAIMANT_PRIVATE_KEY;
  if (!rpcUrl || !claimantPrivateKey) {
    console.error("Set RPC_URL and CLAIMANT_PRIVATE_KEY in .env first (see .env.example).");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const claimant = new ethers.Wallet(claimantPrivateKey, provider);
  const wallet = walletArg || claimant.address;

  const snapshot = await db.getSnapshot(campaignAddress, index);
  if (!snapshot) {
    console.error(`No computed snapshot found for ${campaignAddress} milestone ${index}.`);
    process.exit(1);
  }

  const entryIndex = snapshot.entries.findIndex((e) => e.account.toLowerCase() === wallet.toLowerCase());
  if (entryIndex === -1) {
    console.error(`${wallet} isn't in this milestone's leaderboard snapshot -- nothing to claim.`);
    process.exit(1);
  }
  const entry = snapshot.entries[entryIndex];

  const tree = buildTree(snapshot.entries);
  if (tree.root !== snapshot.merkle_root) {
    console.error("Rebuilt tree root doesn't match the stored snapshot's root -- refusing to submit a proof that wouldn't verify on-chain.");
    process.exit(1);
  }
  const proof = tree.proofFor(entryIndex);

  const campaign = new ethers.Contract(campaignAddress, SHO_CAMPAIGN_ABI, claimant);

  const milestone = await campaign.getMilestone(index);
  const now = Math.floor(Date.now() / 1000);
  const endsAt = Number(milestone.challengeWindowEnds);
  if (now < endsAt) {
    const remainingMin = Math.ceil((endsAt - now) / 60);
    console.error(`Challenge window still open -- about ${remainingMin} more minutes (ends ${new Date(endsAt * 1000).toISOString()}).`);
    process.exit(1);
  }

  console.log(`Campaign: ${campaignAddress}, milestone ${index}`);
  console.log(`Claiming ${entry.amount} wei for ${wallet}...`);
  const tx = await campaign.claim(index, entry.amount, proof);
  console.log(`Tx sent: ${tx.hash}`);
  await tx.wait();
  console.log("Claimed successfully.");

  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
