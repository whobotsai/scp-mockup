// One-off: deploys a *fresh* Registry (picking up the walletOfHandle uniqueness fix) without
// touching SHOFactory/SSOFactory or any already-created SHO/SSO campaign -- deploy.js deploys
// all three from scratch, which would be needless churn here (and would orphan every existing
// campaign's factory reference) when only Registry's bytecode actually changed.
//
// Registry has no proxy/upgrade path (a plain Ownable contract, by design -- see its own
// header), so "updating" it always means this: a brand-new contract at a brand-new address,
// starting from an *empty* handleOf/walletOfHandle. See ../README.md's "Deploying to a real
// network" for why this can't run from this sandbox (RPC egress is blocked here) -- run it
// from a machine with real network access instead, same as deploy.js.
//
// Usage: node scripts/redeploy-registry.js
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build", `${name}.json`), "utf8"));
}

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) {
    console.error("Set RPC_URL and DEPLOYER_PRIVATE_KEY (see .env.example) before running this.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  const deploymentPath = path.join(__dirname, "..", "deployments", `${network.chainId}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  // Same owner/attestor as the Registry being replaced -- this is a like-for-like redeploy of
  // one contract, not a chance to also rotate who controls it. Override via env only if you
  // deliberately want a different owner/attestor on the new Registry.
  const owner = process.env.OWNER_ADDRESS || deployment.owner;
  const attestor = process.env.ATTESTOR_ADDRESS || deployment.attestor;

  console.log(`Network: chainId ${network.chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    console.error("\nDeployer has 0 balance — fund it from the testnet faucet first.");
    process.exit(1);
  }
  console.log(`\nowner=${owner}\nattestor=${attestor}`);
  console.log(`\nReplacing Registry ${deployment.contracts.Registry} (old, pre-fix bytecode)...`);

  const artifact = loadArtifact("Registry");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const registry = await factory.deploy(owner, attestor);
  await registry.waitForDeployment();
  const newAddress = await registry.getAddress();
  // The actual mined block, not just "latest" -- avoids being off by however many blocks land
  // between waitForDeployment() resolving and this call.
  const deployReceipt = await registry.deploymentTransaction().wait();
  const deployBlock = deployReceipt.blockNumber;

  deployment.contracts.Registry = newAddress;
  deployment.registryRedeployedAt = new Date().toISOString();
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

  console.log(`\nNew Registry: ${newAddress} (block ${deployBlock})`);
  console.log(`Updated ${path.relative(path.join(__dirname, ".."), deploymentPath)}.`);
  console.log(
    "\nThis new Registry starts EMPTY -- nobody's registerHandle() from the old contract carried " +
      "over. Everyone who registered before (including any handle that was legitimately linked, " +
      "not just the duplicates this fix closes) needs to call registerHandle() again against " +
      "this new address.\n" +
      "\nRemaining steps (not done by this script):\n" +
      "  1. public/index.html: update SCP_CONFIG.REGISTRY_ADDRESS to the new address above, " +
      "then redeploy the frontend (see README's Firebase Hosting section).\n" +
      "  2. keeper/.env and keeper/.env.example: update REGISTRY_ADDRESS to the new address, " +
      `and set REGISTRY_DEPLOY_BLOCK=${deployBlock} so the indexer doesn't rescan from block 0.\n` +
      "  3. Keeper DB: TRUNCATE handle_registrations (and reset its cursor, e.g. via " +
      "fast-forward-cursor.js or just restarting the keeper after step 2) before it starts " +
      "polling the new Registry -- rows resolved against the OLD, pre-fix contract may reflect " +
      "the exact duplicate-handle bug this redeploy fixes, and nothing here reconciles them " +
      "automatically. Fresh HandleRegistered events from the new contract will repopulate it.\n" +
      "  4. registration-service needs no change -- it only signs attestations, it never calls " +
      "Registry itself, so it doesn't hold the address anywhere."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
