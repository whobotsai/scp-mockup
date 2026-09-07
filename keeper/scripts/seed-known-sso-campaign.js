// SSO's half of seed-known-campaign.js -- same fast-path bootstrap (look up ONE already-known
// transaction directly, no block-range scan involved at all) for whenever ssoCampaignIndexer's
// own backfill has fallen far enough behind on a free-tier RPC that waiting for it to reach a
// campaign you already know about isn't worth it. See that file's own header for the full
// reasoning; this is a one-time bootstrap tool, not a substitute for the real backfill.
//
// Usage: node scripts/seed-known-sso-campaign.js <txHash>
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { indexSsoCampaign, CURSOR_KEY } = require("../src/ssoCampaignIndexer");
const { SSO_FACTORY_ABI } = require("../src/abis/sso");
const db = require("../src/db");

async function main() {
  const txHash = process.argv[2];
  if (!txHash) {
    console.error("Usage: node scripts/seed-known-sso-campaign.js <txHash>");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const factory = new ethers.Contract(process.env.SSO_FACTORY_ADDRESS, SSO_FACTORY_ABI, provider);

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
    await indexSsoCampaign(provider, parsed);
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
