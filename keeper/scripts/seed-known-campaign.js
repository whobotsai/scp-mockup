// Fast-path bootstrap for a demo/test environment: rather than backfilling every 10-block
// chunk between SHO_FACTORY_DEPLOY_BLOCK and the current chain head (impractically slow
// against a fast-producing chain on a free-tier RPC's 10-block getLogs cap — confirmed in
// practice), this looks up ONE already-known transaction directly (no block-range scan
// involved at all) and seeds `campaigns` from it, then fast-forwards the indexer's cursor to
// the current chain head so ordinary polling picks up from "now" instead of from history.
//
// This is a one-time bootstrap tool, not a substitute for campaignIndexer.js's own backfill
// — any campaign created between SHO_FACTORY_DEPLOY_BLOCK and whenever this script runs,
// other than the one transaction given here, will NOT be picked up by this shortcut. Fine
// for seeding this one known test campaign; not a general solution.
//
// Usage: node scripts/seed-known-campaign.js <txHash>
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { indexCampaign, CURSOR_KEY } = require("../src/campaignIndexer");
const { SHO_FACTORY_ABI } = require("../src/abis/sho");
const db = require("../src/db");

async function main() {
  const txHash = process.argv[2];
  if (!txHash) {
    console.error("Usage: node scripts/seed-known-campaign.js <txHash>");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const factory = new ethers.Contract(process.env.SHO_FACTORY_ADDRESS, SHO_FACTORY_ABI, provider);

  console.log(`Fetching receipt for ${txHash}...`);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    console.error("Transaction not found on this RPC — check RPC_URL points at the right network.");
    process.exit(1);
  }

  const campaignCreatedLogs = receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((parsed) => parsed && parsed.name === "CampaignCreated");

  if (campaignCreatedLogs.length === 0) {
    console.error("No CampaignCreated event found in that transaction's logs.");
    process.exit(1);
  }

  for (const parsed of campaignCreatedLogs) {
    await indexCampaign(provider, parsed);
  }

  const latest = await provider.getBlockNumber();
  await db.setCursor(CURSOR_KEY, BigInt(latest));
  console.log(
    `Seeded ${campaignCreatedLogs.length} campaign(s) from ${txHash}.\n` +
      `Cursor fast-forwarded to block ${latest} — future polling starts from here, no historical scan.`
  );
  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
