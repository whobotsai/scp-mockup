// Sets up a testable Uniswap-V2-style pool for two already-deployed test tokens (see
// deploy-test-token.js): deploys src/mocks/UniswapV2Factory.sol once (reusing it across
// multiple pairs, recorded in deployments/<chainId>.json), creates the pair if it doesn't
// exist yet, and adds initial liquidity if the pool is still empty. Idempotent -- safe to
// re-run.
//
// Usage: node scripts/setup-test-pool.js <campaignTokenAddress> <quoteTokenAddress> [amountCampaign=1000] [amountQuote=1000]
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build", `${name}.json`), "utf8"));
}

async function main() {
  const [campaignToken, quoteToken, amountCampaignStr, amountQuoteStr] = process.argv.slice(2);
  if (!campaignToken || !quoteToken) {
    console.error(
      "Usage: node scripts/setup-test-pool.js <campaignTokenAddress> <quoteTokenAddress> [amountCampaign=1000] [amountQuote=1000]"
    );
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) {
    console.error("Set RPC_URL and DEPLOYER_PRIVATE_KEY in .env first.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  const deploymentPath = path.join(__dirname, "..", "deployments", `${network.chainId}.json`);
  const deployment = fs.existsSync(deploymentPath)
    ? JSON.parse(fs.readFileSync(deploymentPath, "utf8"))
    : { chainId: network.chainId.toString(), contracts: {} };
  deployment.contracts = deployment.contracts || {};

  const factoryArtifact = loadArtifact("UniswapV2Factory");
  let factory;
  if (deployment.contracts.UniswapV2Factory) {
    console.log(`Using existing UniswapV2Factory: ${deployment.contracts.UniswapV2Factory}`);
    factory = new ethers.Contract(deployment.contracts.UniswapV2Factory, factoryArtifact.abi, deployer);
  } else {
    console.log("Deploying UniswapV2Factory...");
    const factoryFactory = new ethers.ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode, deployer);
    factory = await factoryFactory.deploy();
    await factory.waitForDeployment();
    deployment.contracts.UniswapV2Factory = await factory.getAddress();
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
    console.log(`Deployed: ${deployment.contracts.UniswapV2Factory}`);
  }

  let pairAddress = await factory.getPair(campaignToken, quoteToken);
  if (pairAddress === ethers.ZeroAddress) {
    console.log(`Creating pair for ${campaignToken} / ${quoteToken}...`);
    const tx = await factory.createPair(campaignToken, quoteToken);
    const receipt = await tx.wait();
    const parsed = receipt.logs
      .map((l) => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l) => l && l.name === "PairCreated");
    pairAddress = parsed.args.pair;
    console.log(`Pair created: ${pairAddress}`);
  } else {
    console.log(`Using existing pair: ${pairAddress}`);
  }

  const pairArtifact = loadArtifact("UniswapV2Pair");
  const pair = new ethers.Contract(pairAddress, pairArtifact.abi, deployer);
  const [reserve0] = await pair.getReserves();

  if (reserve0 === 0n) {
    const amountCampaign = ethers.parseUnits(amountCampaignStr || "1000", 18);
    const amountQuote = ethers.parseUnits(amountQuoteStr || "1000", 18);
    console.log(
      `Adding initial liquidity: ${ethers.formatUnits(amountCampaign, 18)} campaign token + ` +
        `${ethers.formatUnits(amountQuote, 18)} quote token...`
    );

    const erc20Artifact = loadArtifact("MockERC20");
    const campaignTokenContract = new ethers.Contract(campaignToken, erc20Artifact.abi, deployer);
    const quoteTokenContract = new ethers.Contract(quoteToken, erc20Artifact.abi, deployer);

    let tx = await campaignTokenContract.transfer(pairAddress, amountCampaign);
    await tx.wait();
    tx = await quoteTokenContract.transfer(pairAddress, amountQuote);
    await tx.wait();
    tx = await pair.mint(deployer.address);
    await tx.wait();
    console.log("Liquidity added.");
  } else {
    console.log("Pool already has liquidity -- skipping.");
  }

  const token0 = await pair.token0();
  const campaignTokenIsToken0 = token0.toLowerCase() === campaignToken.toLowerCase();

  console.log(`\nPair: ${pairAddress}`);
  console.log(`campaignTokenIsToken0: ${campaignTokenIsToken0}`);
  console.log("\nNext: register this pool with the keeper:");
  console.log(
    `  cd ../keeper && npm run register-token-pool -- ${campaignToken} uniswap_v2 ${pairAddress} ${campaignTokenIsToken0}`
  );
  console.log("\nThen generate some trades to index:");
  console.log(`  npm run test-swap -- ${pairAddress} ${campaignToken} 10`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
