// Final step of the manual Stage 0 test (see ../../README.md). Claims the deployer's own
// reward once the 24h challenge window from 02-post-root.js has actually elapsed — this is
// a real testnet, so that means literally waiting 24 real hours, not a simulated
// evm_increaseTime like the local test suite uses. Run 02-post-root.js first.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "build", `${name}.json`), "utf8"));
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
    console.error(`No ${testCampaignPath} — run scripts/test/01-create-campaign.js and 02-post-root.js first.`);
    process.exit(1);
  }
  const testCampaign = JSON.parse(fs.readFileSync(testCampaignPath, "utf8"));
  if (testCampaign.challengeWindowEnds === undefined) {
    console.error("No challenge window recorded — run scripts/test/02-post-root.js first.");
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const endsAt = Number(testCampaign.challengeWindowEnds);
  if (now < endsAt) {
    const remainingMin = Math.ceil((endsAt - now) / 60);
    console.error(`Challenge window still open — about ${remainingMin} more minutes (ends ${new Date(endsAt * 1000).toISOString()}).`);
    process.exit(1);
  }

  const campaignArtifact = loadArtifact("SHOCampaign");
  const campaign = new ethers.Contract(testCampaign.campaignAddress, campaignArtifact.abi, wallet);

  console.log(`Campaign: ${testCampaign.campaignAddress}`);
  console.log(`Claiming ${ethers.formatEther(testCampaign.claimAmount)} ETH for ${wallet.address}...`);

  const proof = []; // single-leaf tree — no sibling hashes needed
  const tx = await campaign.claim(testCampaign.milestoneIndex, testCampaign.claimAmount, proof);
  console.log(`Tx sent: ${tx.hash}`);
  await tx.wait();
  console.log("Claimed successfully — the full SHO lifecycle now works end-to-end on testnet.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
