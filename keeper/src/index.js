// Entry point: runs the Chain Indexer (SHO campaign discovery + trade indexing), the Social
// Indexer (SSO campaign discovery + post indexing + registration indexing), price sampling,
// the Milestone/Epoch Engine, the Snapshot Publisher, the On-chain Poster, and the
// missed-root alert on a polling loop. This is Stage 1 build-order steps 1-4
// (KEEPER_SERVICE_DESIGN.md section 8) — root posting is automatic for both campaign types
// on EVM (see src/onchainPoster.js for the one deliberate simplification shared by both: a
// single-signer EOA standing in for the design doc's 3-of-5 Gnosis Safe) and, for Solana SHO,
// via src/solanaOnchainPoster.js (same single-keypair simplification, see its own header).
// scripts/post-milestone-root.js still exists for a manual EVM SHO override, but is no longer
// needed for the normal path.
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { Connection } = require("@solana/web3.js");
const { pollNewCampaigns } = require("./campaignIndexer");
const { pollNewSolanaCampaigns } = require("./solanaCampaignIndexer");
const { pollTradesForCampaign } = require("./tradeIndexer");
const { netBuyVolumeForCampaign } = require("./volumeAggregator");
const { samplePrice } = require("./priceSampler");
const { sampleSolanaPrice } = require("./solanaPriceSampler");
const { checkMilestones } = require("./milestoneEngine");
const { checkSolanaMilestones } = require("./solanaMilestoneEngine");
const { pollNewSsoCampaigns } = require("./ssoCampaignIndexer");
const { pollNewRegistrations } = require("./registrationIndexer");
const { pollPostsForCampaign } = require("./socialIndexer");
const { epochScoresForCampaign } = require("./socialScoreAggregator");
const { checkEpochs } = require("./epochEngine");
const { publishPendingSnapshots, DEFAULT_PUBLISH_INTERVAL_MS } = require("./snapshotPublisher");
const { postPendingRoots } = require("./onchainPoster");
const { postPendingSolanaRoots, loadKeeperKeypair } = require("./solanaOnchainPoster");
const { checkMissedRootAlerts } = require("./alerts");
const db = require("./db");

async function tickSho(provider, c) {
  // Deliberate simplification: no Pons.family bonding-curve phase (its contract ABI still
  // isn't available — see tradeSources/ponsBondingCurve.js). A token with no registered
  // pool config (scripts/register-token-pool.js) simply has nothing indexed/priced yet,
  // logged inside pollTradesForCampaign/samplePrice rather than treated as an error.
  await pollTradesForCampaign(provider, c);

  const leaderboard = await netBuyVolumeForCampaign(c.campaign_address, Number(c.window_seconds));
  console.log(
    `[volumeAggregator] ${c.campaign_address}: ${leaderboard.length} eligible wallet(s)` +
      (leaderboard.length ? `, top: ${leaderboard[0].wallet} ($${leaderboard[0].score.toFixed(2)})` : "")
  );

  const poolConfig = await db.getTokenPool(c.token);
  if (poolConfig) {
    await samplePrice(provider, c.token, poolConfig);
    await checkMilestones(provider, c);
  }
}

// Solana SHO: price sampling + milestone detection + snapshot computation now mirror the EVM
// path end to end (solanaMilestoneEngine.js uses solanaTraderIndexer.js/Birdeye for the
// leaderboard instead of a local trades table -- see that module's own header). Posting the
// resulting snapshot on-chain is solanaOnchainPoster.js's job, same shared "any unposted
// snapshot gets picked up automatically" step as the EVM path below, not done here.
// BIRDEYE_API_KEY is optional, same posture as KEEPER_PRIVATE_KEY and SOLANA_RPC_URL:
// milestone detection simply stays off without it (netBuyVolumeForSolanaToken needs it)
// rather than hard-exiting the whole keeper.
async function tickSolanaSho(connection, c) {
  await sampleSolanaPrice(c.token);

  if (process.env.BIRDEYE_API_KEY) {
    try {
      await checkSolanaMilestones(connection, c);
    } catch (e) {
      console.error(`[solanaMilestoneEngine] check failed for ${c.campaign_address}:`, e.message);
    }
  }
}

// Solana SSO: nothing implemented yet beyond discovery (no epoch/root/claim mechanics ported
// to the keeper side) -- a log line here is a deliberate placeholder, not a bug, so a
// discovered Solana SSO campaign isn't silently ignored in the logs while the rest of the
// pipeline catches up.
async function tickSolanaSso(c) {
  console.log(`[keeper] Solana SSO campaign ${c.campaign_address}: epoch/root tracking not implemented yet -- skipping.`);
}

async function tickSso(provider, c) {
  const epochIndex = await pollPostsForCampaign(provider, c);
  if (epochIndex !== null) {
    const leaderboard = await epochScoresForCampaign(c.campaign_address, epochIndex);
    console.log(
      `[socialScoreAggregator] ${c.campaign_address} epoch ${epochIndex}: ${leaderboard.length} eligible account(s)` +
        (leaderboard.length ? `, top: ${leaderboard[0].wallet} (${leaderboard[0].score.toFixed(2)})` : "")
    );
  }
  await checkEpochs(provider, c);
}

async function tick(provider, keeperWallet, publishIntervalMs, solanaConnection, solanaKeeperKeypair) {
  await pollNewCampaigns(provider, process.env.SHO_FACTORY_ADDRESS, Number(process.env.SHO_FACTORY_DEPLOY_BLOCK || 0));

  // SSO/Registry discovery only run once their addresses are actually configured -- this
  // keeper still works SHO-only (as it always has) for anyone who hasn't set these yet,
  // same "optional, not a hard requirement" posture KEEPER_PRIVATE_KEY/LIGHTHOUSE_API_KEY use.
  if (process.env.SSO_FACTORY_ADDRESS) {
    await pollNewSsoCampaigns(provider, process.env.SSO_FACTORY_ADDRESS, Number(process.env.SSO_FACTORY_DEPLOY_BLOCK || 0));
  }
  if (process.env.REGISTRY_ADDRESS) {
    await pollNewRegistrations(provider, process.env.REGISTRY_ADDRESS, Number(process.env.REGISTRY_DEPLOY_BLOCK || 0));
  }

  // Solana campaign discovery (see solanaCampaignIndexer.js) -- same "optional" posture:
  // stays off entirely unless SOLANA_RPC_URL plus a program id is actually configured, and
  // each program is independently optional of the other. Trade indexing / root posting for
  // a Solana campaign aren't implemented yet (see contracts-solana/README.md), so a
  // discovered Solana campaign sits in `campaigns` with no further ticks against it below.
  if (solanaConnection && process.env.SHO_SOLANA_PROGRAM_ID) {
    await pollNewSolanaCampaigns(solanaConnection, process.env.SHO_SOLANA_PROGRAM_ID, "sho");
  }
  if (solanaConnection && process.env.SSO_SOLANA_PROGRAM_ID) {
    await pollNewSolanaCampaigns(solanaConnection, process.env.SSO_SOLANA_PROGRAM_ID, "sso");
  }

  // Each campaign's tick is wrapped in its own try/catch: without this, one campaign
  // throwing (e.g. a Solana campaign's base58 address reaching an EVM-only code path) would
  // abort the whole loop, skipping every later campaign plus the snapshot/root-posting/alert
  // steps below for that entire tick cycle.
  const campaigns = await db.listCampaigns();
  for (const c of campaigns) {
    try {
      if (c.network === "solana") {
        if (c.factory === "sso") {
          await tickSolanaSso(c);
        } else {
          await tickSolanaSho(solanaConnection, c);
        }
      } else if (c.factory === "sso") {
        await tickSso(provider, c);
      } else {
        await tickSho(provider, c);
      }
    } catch (e) {
      console.error(`[keeper] tick failed for campaign ${c.campaign_address} (${c.network || "evm"}/${c.factory}):`, e);
    }
  }

  // Build-order step 3: publish any newly computed snapshot to IPFS, post any published
  // snapshot's root on-chain (SHO or SSO, onchainPoster.js dispatches by factory), then check
  // whether anything crossed/closed too long ago with still no confirmed root. Each stage is
  // idempotent on its own DB state (section 6), so running all three every tick is safe even
  // though most ticks find nothing pending in any of them. publishPendingSnapshots throttles
  // itself internally (see its own comment) -- posting and the alert stay on the regular tick
  // cadence since neither costs an external API call.
  await publishPendingSnapshots(publishIntervalMs);
  if (keeperWallet) {
    await postPendingRoots(provider, keeperWallet);
  }
  if (solanaConnection && solanaKeeperKeypair) {
    await postPendingSolanaRoots(solanaConnection, solanaKeeperKeypair);
  }
  await checkMissedRootAlerts();
}

// No RPC call anywhere in this keeper (getBlockNumber, queryFilter, a contract read, ...) had
// any timeout -- confirmed live: a slow/unresponsive RPC endpoint hung the very first call of
// a tick (campaignIndexer.js's provider.getBlockNumber()) forever, with no error and no further
// log line at all, indistinguishable from the process being frozen. A FetchRequest with a
// timeout bounds every call this provider makes, not just one call site -- a hung request now
// rejects instead, gets caught by main()'s own try/catch below, logged, and retried next tick.
const RPC_TIMEOUT_MS = 30_000;

function buildProvider(rpcUrl) {
  const fetchRequest = new ethers.FetchRequest(rpcUrl);
  fetchRequest.timeout = RPC_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(fetchRequest);
}

async function main() {
  const provider = buildProvider(process.env.RPC_URL);
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 15000);
  const publishIntervalMs = Number(process.env.SNAPSHOT_PUBLISH_INTERVAL_MS || DEFAULT_PUBLISH_INTERVAL_MS);

  // KEEPER_PRIVATE_KEY is now used by the main process itself, not just the manual scripts --
  // build-order step 3 automates postMilestoneRoot/postEpochRoot, which needs a signer. Still
  // optional here (rather than a hard exit) so the rest of the pipeline keeps running for
  // anyone who hasn't set it up yet; onchainPoster.js simply doesn't run without it, same as
  // a token with no registered pool skipping price sampling above.
  const keeperWallet = process.env.KEEPER_PRIVATE_KEY
    ? new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY, provider)
    : null;
  if (!keeperWallet) {
    console.log("[keeper] KEEPER_PRIVATE_KEY not set -- automatic root posting is disabled this run.");
  }

  // Solana campaign discovery (see "if (solanaConnection ..." in tick() above) is entirely
  // optional, same posture as SSO_FACTORY_ADDRESS/REGISTRY_ADDRESS — no SOLANA_RPC_URL means
  // no Connection is even constructed, and the keeper stays EVM-only, exactly as it always
  // has been.
  const solanaConnection = process.env.SOLANA_RPC_URL ? new Connection(process.env.SOLANA_RPC_URL, "confirmed") : null;
  if (!solanaConnection) {
    console.log("[keeper] SOLANA_RPC_URL not set -- Solana campaign discovery is disabled this run.");
  }
  if (!process.env.BIRDEYE_API_KEY) {
    console.log("[keeper] BIRDEYE_API_KEY not set -- Solana SHO leaderboard computation is disabled this run.");
  }

  // Same optional posture as keeperWallet above, for the same reason -- see
  // solanaOnchainPoster.js's own header for the signer-model rationale (single keypair now,
  // a real multisig before any Solana campaign with real funds goes live).
  const solanaKeeperKeypair = loadKeeperKeypair();
  if (!solanaKeeperKeypair) {
    console.log("[keeper] SOLANA_KEEPER_PRIVATE_KEY not set -- automatic Solana root posting is disabled this run.");
  }

  console.log(`Keeper (Stage 1, steps 1-4) starting. Polling every ${pollIntervalMs}ms.`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(provider, keeperWallet, publishIntervalMs, solanaConnection, solanaKeeperKeypair);
    } catch (e) {
      console.error("[keeper] tick failed:", e);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
