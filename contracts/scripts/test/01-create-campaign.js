// Manual Stage 0 exit-criteria test (see ../../README.md "Manual end-to-end test on
// testnet"): creates one real SHO campaign on whatever network RPC_URL points at, funded
// with a small amount of native ETH, with a single milestone that pays out 100% of the
// pool. Run this from a machine with normal network access — see ../deploy.js's header for
// why this can't run from this build environment.
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
  const network = await provider.getNetwork();

  const deploymentPath = path.join(__dirname, "..", "..", "deployments", `${network.chainId}.json`);
  if (!fs.existsSync(deploymentPath)) {
    console.error(`No deployment record at ${deploymentPath} — run npm run deploy first.`);
    process.exit(1);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const factoryArtifact = loadArtifact("SHOFactory");
  const factory = new ethers.Contract(deployment.contracts.SHOFactory, factoryArtifact.abi, wallet);

  // The token this campaign's off-chain keeper would normally track. No keeper/indexer
  // exists yet (Stage 1 of the roadmap) — this address is never actually read by anything
  // on-chain, so the deployer's own address is used here as an obviously-fake placeholder
  // for this manual test only. A real campaign needs a real token address.
  const placeholderToken = wallet.address;

  const amount = ethers.parseEther("0.002"); // gross, before the 0.5% protocol fee
  const rewardToken = ethers.ZeroAddress; // native ETH reward, no ERC20 approve needed
  const window = 0; // Types.LeaderboardWindow.H24
  const leaderboardSize = 50;
  const duration = 7 * 24 * 60 * 60; // 7 days
  const tiers = [0]; // Types.MilestoneTier.M100K — a single milestone
  const rewardBpsList = [10000]; // 100% of the locked pool to this one milestone

  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  const minNeeded = amount + ethers.parseEther("0.001"); // rough gas headroom
  if (balance < minNeeded) {
    console.error(
      `Balance too low for a ${ethers.formatEther(amount)} ETH campaign plus gas — top up from the faucet first.`
    );
    process.exit(1);
  }

  console.log("Creating test SHO campaign...");
  const tx = await factory.createCampaign(
    placeholderToken,
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
    console.error("CampaignCreated event not found in the receipt — something went wrong.");
    process.exit(1);
  }

  const campaignId = parsed.args.id.toString();
  const campaignAddress = parsed.args.campaign;
  console.log(`Campaign id: ${campaignId}`);
  console.log(`Campaign address: ${campaignAddress}`);

  const outPath = path.join(__dirname, "..", "..", "deployments", "test-campaign.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      { chainId: network.chainId.toString(), campaignId, campaignAddress, createdAt: new Date().toISOString() },
      null,
      2
    )
  );
  console.log(`Saved to ${path.relative(path.join(__dirname, "..", ".."), outPath)}`);
  console.log("\nNext: node scripts/test/02-post-root.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
