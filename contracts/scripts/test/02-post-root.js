// Second step of the manual Stage 0 test (see ../../README.md). Posts a Merkle root as
// the keeper — the deployer wallet, since this test deployment's keeper defaults to the
// deployer's own address. Builds the simplest possible tree: a single leaf, the deployer
// claiming the campaign's entire locked pool. Run 01-create-campaign.js first.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "build", `${name}.json`), "utf8"));
}

// Matches ClaimVerifier.leaf exactly: keccak256(bytes.concat(keccak256(abi.encode(account, amount)))).
function leafHash(account, amount) {
  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account, amount]));
  return ethers.keccak256(inner);
}

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) {
    console.error("Set RPC_URL and DEPLOYER_PRIVATE_KEY in .env first.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const testCampaignPath = path.join(__dirname, "..", "..", "deployments", "test-campaign.json");
  if (!fs.existsSync(testCampaignPath)) {
    console.error(`No ${testCampaignPath} — run scripts/test/01-create-campaign.js first.`);
    process.exit(1);
  }
  const testCampaign = JSON.parse(fs.readFileSync(testCampaignPath, "utf8"));

  const campaignArtifact = loadArtifact("SHOCampaign");
  const campaign = new ethers.Contract(testCampaign.campaignAddress, campaignArtifact.abi, wallet);

  const totalLocked = await campaign.totalLocked();
  console.log(`Campaign: ${testCampaign.campaignAddress}`);
  console.log(`Total locked: ${ethers.formatEther(totalLocked)} ETH`);

  const milestoneIndex = 0;
  const claimAmount = totalLocked; // sole "winner" claims the whole pool for this test
  const root = leafHash(wallet.address, claimAmount);
  const snapshotHash = ethers.keccak256(ethers.toUtf8Bytes("manual-test-snapshot"));

  console.log("Posting milestone root as keeper...");
  const tx = await campaign.postMilestoneRoot(milestoneIndex, root, snapshotHash);
  console.log(`Tx sent: ${tx.hash}`);
  await tx.wait();

  const m = await campaign.getMilestone(milestoneIndex);
  const challengeWindowEnds = m.challengeWindowEnds.toString();
  console.log(`Challenge window ends: ${new Date(Number(challengeWindowEnds) * 1000).toISOString()}`);

  fs.writeFileSync(
    testCampaignPath,
    JSON.stringify(
      { ...testCampaign, milestoneIndex, claimAmount: claimAmount.toString(), root, challengeWindowEnds },
      null,
      2
    )
  );
  console.log("\nWait for the challenge window above to pass (24h from now), then run:");
  console.log("  node scripts/test/03-claim.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
