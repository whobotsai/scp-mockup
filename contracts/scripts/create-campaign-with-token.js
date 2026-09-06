// Creates a real SHO campaign pointed at a real token -- for testing the keeper's Uniswap
// indexing end-to-end (unlike scripts/test/01-create-campaign.js, which deliberately used a
// placeholder token for the Stage 0 exit-criteria walkthrough, before any real token/pool
// existed). Same milestone shape as that script (one milestone, 100% of the pool), so the
// existing scripts/test/02-post-root.js and 03-claim.js patterns still apply if you want to
// walk this campaign through its full lifecycle too.
//
// Usage: node scripts/create-campaign-with-token.js <tokenAddress> [amountEth=0.002]
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build", `${name}.json`), "utf8"));
}

async function main() {
  const [token, amountEthStr] = process.argv.slice(2);
  if (!token || !ethers.isAddress(token)) {
    console.error("Usage: node scripts/create-campaign-with-token.js <tokenAddress> [amountEth=0.002]");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) {
    console.error("Set RPC_URL and DEPLOYER_PRIVATE_KEY in .env first.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  const deploymentPath = path.join(__dirname, "..", "deployments", `${network.chainId}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const factoryArtifact = loadArtifact("SHOFactory");
  const factory = new ethers.Contract(deployment.contracts.SHOFactory, factoryArtifact.abi, wallet);

  const amount = ethers.parseEther(amountEthStr || "0.002");
  const rewardToken = ethers.ZeroAddress; // native ETH reward, no ERC20 approve needed
  const window = 0; // Types.LeaderboardWindow.H24
  const leaderboardSize = 50;
  const duration = 7 * 24 * 60 * 60; // 7 days
  const tiers = [0]; // Types.MilestoneTier.M100K -- a single milestone
  const rewardBpsList = [10000]; // 100% of the locked pool to this one milestone

  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  if (balance < amount + ethers.parseEther("0.001")) {
    console.error(`Balance too low for a ${ethers.formatEther(amount)} ETH campaign plus gas.`);
    process.exit(1);
  }

  console.log(`Creating SHO campaign for token ${token}...`);
  const tx = await factory.createCampaign(
    token,
    rewardToken,
    amount,
    window,
    leaderboardSize,
    duration,
    tiers,
    rewardBpsList,
    { value: amount }
  );
  console.log(`Tx sent: ${tx.hash}`);
  const receipt = await tx.wait();

  const parsed = receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log) => log && log.name === "CampaignCreated");

  if (!parsed) {
    console.error("CampaignCreated event not found in the receipt -- something went wrong.");
    process.exit(1);
  }

  console.log(`Campaign id: ${parsed.args.id}`);
  console.log(`Campaign address: ${parsed.args.campaign}`);
  console.log("\nThe keeper will pick this campaign up on its next campaignIndexer tick, and");
  console.log("start indexing trades for it immediately since its token's pool is already registered.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
