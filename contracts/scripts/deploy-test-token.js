// Deploys MockERC20 (src/mocks/MockERC20.sol) as a real test-only token on whatever network
// RPC_URL points at, and mints an initial supply to the deployer. This is purely a test
// fixture -- MockERC20 is explicitly documented as "never deployed for real" in
// ../README.md's file tree, which still holds; this script exists only to unblock testing
// the keeper service's Uniswap V4 integration against a real (if fake-value) token.
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
    console.error("Set RPC_URL and DEPLOYER_PRIVATE_KEY in .env first.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(privateKey, provider);

  const name = process.argv[2] || "SCP Test Token";
  const symbol = process.argv[3] || "SCPT";
  const initialSupply = ethers.parseUnits(process.argv[4] || "1000000", 18);

  const artifact = loadArtifact("MockERC20");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);

  console.log(`Deploying MockERC20 "${name}" (${symbol})...`);
  const token = await factory.deploy(name, symbol);
  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log(`Token deployed: ${address}`);

  console.log(`Minting ${ethers.formatUnits(initialSupply, 18)} ${symbol} to ${deployer.address}...`);
  const tx = await token.mint(deployer.address, initialSupply);
  await tx.wait();
  console.log(`Tx: ${tx.hash}`);

  const outPath = path.join(__dirname, "..", "deployments", "test-token.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify({ address, name, symbol, initialSupply: initialSupply.toString(), deployedAt: new Date().toISOString() }, null, 2)
  );
  console.log(`\nSaved to ${path.relative(path.join(__dirname, ".."), outPath)}`);
  console.log("\nNext: create this token's liquidity pool (Uniswap version still to be confirmed),");
  console.log("then: cd ../keeper && npm run register-token-pool -- " + address + " <poolManagerAddress> <poolId> <true|false>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
