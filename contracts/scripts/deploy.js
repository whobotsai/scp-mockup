// Deploys SHOFactory, SSOFactory, and Registry to whatever RPC_URL points at.
// This talks to a real RPC endpoint over the network, which this build environment's
// egress policy blocks — run this from a machine with normal network access instead.
// See ../README.md "Deploying to a real network" for the full walkthrough.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build", `${name}.json`), "utf8"));
}

async function deployOne(name, deployer, args) {
  const artifact = loadArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ${name.padEnd(12)} ${address}`);
  return address;
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

  // On a first testnet deploy there's no real Registration Service or keeper multi-sig yet
  // (per docs/BACKEND_ROADMAP.md's Stage 0/1) — everything defaults to the deployer's own
  // address so the contracts are usable end-to-end, and gets rotated to the real
  // owner/treasury/keeper/attestor addresses via setOwner/setTreasury/setKeeper/setAttestor
  // once those exist. Never leave these defaults in place for a mainnet deploy.
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const keeper = process.env.KEEPER_ADDRESS || deployer.address;
  const attestor = process.env.ATTESTOR_ADDRESS || deployer.address;

  console.log(`Network: chainId ${network.chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    console.error("\nDeployer has 0 balance — fund it from the testnet faucet first.");
    process.exit(1);
  }
  console.log(`\nowner=${owner}\ntreasury=${treasury}\nkeeper=${keeper}\nattestor=${attestor}\n`);

  console.log("Deploying...");
  const contracts = {
    SHOFactory: await deployOne("SHOFactory", deployer, [owner, treasury, keeper]),
    SSOFactory: await deployOne("SSOFactory", deployer, [owner, treasury, keeper]),
    Registry: await deployOne("Registry", deployer, [owner, attestor]),
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${network.chainId}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      { chainId: network.chainId.toString(), deployedAt: new Date().toISOString(), owner, treasury, keeper, attestor, contracts },
      null,
      2
    )
  );
  console.log(`\nSaved deployment record to ${path.relative(path.join(__dirname, ".."), outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
