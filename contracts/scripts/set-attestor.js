// One-off admin action: rotates Registry's attestor to a new address -- needed once
// registration-service/ has a real attestor key, since Registry currently points at the
// deployer's own placeholder address (see ../README.md "Deploying to a real network").
// Reuses this package's own .env (RPC_URL, DEPLOYER_PRIVATE_KEY) since owner == deployer for
// this testnet deployment (see deployments/<chainId>.json) -- no new secret needed here.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const REGISTRY_ABI = [
  "function setAttestor(address) external",
  "function attestor() view returns (address)",
];

async function main() {
  const newAttestor = process.argv[2];
  if (!newAttestor || !ethers.isAddress(newAttestor)) {
    console.error("Usage: node scripts/set-attestor.js <newAttestorAddress>");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL;
  const ownerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpcUrl || !ownerPrivateKey) {
    console.error("Set RPC_URL and DEPLOYER_PRIVATE_KEY in .env first (see .env.example).");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const owner = new ethers.Wallet(ownerPrivateKey, provider);
  const network = await provider.getNetwork();

  const deploymentPath = path.join(__dirname, "..", "deployments", `${network.chainId}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const registry = new ethers.Contract(deployment.contracts.Registry, REGISTRY_ABI, owner);

  console.log(`Registry: ${deployment.contracts.Registry}`);
  console.log(`Current attestor: ${await registry.attestor()}`);

  console.log(`Setting attestor to ${newAttestor}...`);
  const tx = await registry.setAttestor(newAttestor);
  console.log(`Tx sent: ${tx.hash}`);
  await tx.wait();

  console.log(`New attestor: ${await registry.attestor()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
