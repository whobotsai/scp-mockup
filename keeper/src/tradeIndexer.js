// Trade-indexing half of the Chain Indexer (KEEPER_SERVICE_DESIGN.md section 4.1), wired to
// tradeSources/uniswapV2.js (testnet -- see ../README.md's "Deliberate simplification"
// section for why: Uniswap V4 isn't deployed on Robinhood Chain Testnet at all, confirmed in
// practice, only on mainnet) and tradeSources/uniswapV4.js (kept ready for whenever mainnet
// is in scope). No Pons.family bonding-curve phase (see tradeSources/ponsBondingCurve.js for
// why) -- a token with no registered pool config (scripts/register-token-pool.js) simply has
// nothing indexed yet, not an error.
"use strict";
const uniswapV2 = require("./tradeSources/uniswapV2");
const uniswapV4 = require("./tradeSources/uniswapV4");
const db = require("./db");

const MAX_BLOCK_RANGE = BigInt(process.env.GET_LOGS_MAX_BLOCK_RANGE || 9);

function cursorKeyFor(token) {
  return `trades:${token}`;
}

async function pollTradesForCampaign(provider, campaign) {
  const poolConfig = await db.getTokenPool(campaign.token);
  if (!poolConfig) {
    console.log(`[tradeIndexer] no pool registered yet for token ${campaign.token} -- skipping`);
    return;
  }

  const cursorKey = cursorKeyFor(campaign.token);
  const latest = BigInt(await provider.getBlockNumber());

  let fromBlock = await db.getCursor(cursorKey);
  if (fromBlock === null) {
    // Shouldn't normally happen -- register-token-pool.js sets this at registration time --
    // but fall back to the current head rather than risk scanning from block 0.
    fromBlock = latest;
  }
  if (fromBlock > latest) return;

  // Same silent-backfill risk campaignIndexer.js's own fix documents: a cursor that fell far
  // behind (the keeper wasn't running for a while) backfills here with nothing printed for any
  // chunk that finds zero trades, indistinguishable from a hang. Log the plan up front, then
  // progress periodically.
  const chunkSize = MAX_BLOCK_RANGE + 1n;
  const totalBlocks = latest - fromBlock + 1n;
  if (totalBlocks > chunkSize) {
    console.log(
      `[tradeIndexer] ${campaign.campaign_address}: backfilling ${totalBlocks} blocks (${fromBlock} to ` +
        `${latest}) in chunks of ${chunkSize} -- see README's "If a backfill is taking a very ` +
        `long time" section for a faster option (fast-forward-cursor.js).`
    );
  }
  let lastLoggedAt = Date.now();

  while (fromBlock <= latest) {
    const toBlock = fromBlock + MAX_BLOCK_RANGE < latest ? fromBlock + MAX_BLOCK_RANGE : latest;

    let trades;
    if (poolConfig.venue === "uniswap_v2") {
      trades = await uniswapV2.fetchTrades(provider, {
        fromBlock,
        toBlock,
        pairAddress: poolConfig.pair_address,
        campaignTokenIsToken0: poolConfig.campaign_token_is_token0,
      });
    } else if (poolConfig.venue === "uniswap_v4") {
      trades = await uniswapV4.fetchTrades(provider, {
        fromBlock,
        toBlock,
        poolManagerAddress: poolConfig.pool_manager_address,
        poolId: poolConfig.pool_id,
        campaignTokenIsCurrency0: poolConfig.campaign_token_is_currency0,
      });
    } else {
      console.warn(`[tradeIndexer] unknown venue "${poolConfig.venue}" for token ${campaign.token} -- skipping`);
      return;
    }

    for (const t of trades) {
      await db.insertTrade({
        campaignAddress: campaign.campaign_address,
        txHash: t.txHash,
        logIndex: t.logIndex,
        wallet: t.wallet,
        venue: poolConfig.venue,
        side: t.side,
        usdValue: t.usdValue,
        blockNumber: t.blockNumber,
        blockTime: t.blockTime,
      });
    }

    if (trades.length > 0) {
      console.log(
        `[tradeIndexer] ${campaign.campaign_address}: indexed ${trades.length} trade(s), blocks ${fromBlock}-${toBlock}`
      );
    }

    await db.setCursor(cursorKey, toBlock);
    fromBlock = toBlock + 1n;

    if (fromBlock <= latest && Date.now() - lastLoggedAt > 5000) {
      console.log(`[tradeIndexer] ${campaign.campaign_address}: backfill progress: at block ${toBlock} of ${latest}`);
      lastLoggedAt = Date.now();
    }
  }
}

module.exports = { pollTradesForCampaign, cursorKeyFor };
