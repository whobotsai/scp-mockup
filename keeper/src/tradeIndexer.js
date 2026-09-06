// Trade-indexing half of the Chain Indexer (KEEPER_SERVICE_DESIGN.md section 4.1), wired to
// tradeSources/uniswapV4.js. Deliberately Uniswap-V4-only for now -- no Pons.family
// bonding-curve phase (see tradeSources/ponsBondingCurve.js for why) -- so a token with no
// registered pool config (scripts/register-token-pool.js) simply has nothing indexed yet,
// not an error.
"use strict";
const { fetchTrades } = require("./tradeSources/uniswapV4");
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

  while (fromBlock <= latest) {
    const toBlock = fromBlock + MAX_BLOCK_RANGE < latest ? fromBlock + MAX_BLOCK_RANGE : latest;

    const trades = await fetchTrades(provider, {
      fromBlock,
      toBlock,
      poolManagerAddress: poolConfig.pool_manager_address,
      poolId: poolConfig.pool_id,
      campaignTokenIsCurrency0: poolConfig.campaign_token_is_currency0,
    });

    for (const t of trades) {
      await db.insertTrade({
        campaignAddress: campaign.campaign_address,
        txHash: t.txHash,
        logIndex: t.logIndex,
        wallet: t.wallet,
        venue: "uniswap_v4",
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
  }
}

module.exports = { pollTradesForCampaign, cursorKeyFor };
