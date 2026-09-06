"use strict";
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getCursor(key) {
  const { rows } = await pool.query("SELECT last_block FROM indexer_cursors WHERE cursor_key = $1", [key]);
  return rows.length ? BigInt(rows[0].last_block) : null;
}

async function setCursor(key, lastBlock) {
  await pool.query(
    `INSERT INTO indexer_cursors (cursor_key, last_block) VALUES ($1, $2)
     ON CONFLICT (cursor_key) DO UPDATE SET last_block = EXCLUDED.last_block`,
    [key, lastBlock.toString()]
  );
}

async function upsertCampaign(c) {
  await pool.query(
    `INSERT INTO campaigns
       (campaign_id, factory, campaign_address, token, reward_token, creator,
        created_at, duration_seconds, leaderboard_size, window_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (campaign_address) DO NOTHING`,
    [
      c.campaignId, c.factory, c.campaignAddress, c.token, c.rewardToken, c.creator,
      c.createdAt, c.durationSeconds, c.leaderboardSize, c.windowSeconds,
    ]
  );
}

async function listCampaigns() {
  const { rows } = await pool.query("SELECT * FROM campaigns ORDER BY created_at ASC");
  return rows;
}

async function insertTrade(t) {
  await pool.query(
    `INSERT INTO sho_trades
       (campaign_address, tx_hash, log_index, wallet, venue, side, usd_value, block_number, block_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [t.campaignAddress, t.txHash, t.logIndex, t.wallet, t.venue, t.side, t.usdValue, t.blockNumber, t.blockTime]
  );
}

async function tradesForWallet(campaignAddress, sinceTime) {
  const { rows } = await pool.query(
    `SELECT wallet, side, usd_value FROM sho_trades
     WHERE campaign_address = $1 AND block_time >= $2`,
    [campaignAddress, sinceTime]
  );
  return rows;
}

async function getTokenPool(token) {
  const { rows } = await pool.query("SELECT * FROM token_pools WHERE token = $1", [token]);
  return rows[0] || null;
}

/// cfg.venue: 'uniswap_v2' | 'uniswap_v4'. Venue-specific fields for the other venue are
/// simply left null -- see migrations/003_multi_venue_pools.sql.
async function upsertTokenPool(token, cfg) {
  await pool.query(
    `INSERT INTO token_pools
       (token, venue, pair_address, campaign_token_is_token0,
        pool_manager_address, pool_id, campaign_token_is_currency0)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (token) DO UPDATE SET
       venue = EXCLUDED.venue,
       pair_address = EXCLUDED.pair_address,
       campaign_token_is_token0 = EXCLUDED.campaign_token_is_token0,
       pool_manager_address = EXCLUDED.pool_manager_address,
       pool_id = EXCLUDED.pool_id,
       campaign_token_is_currency0 = EXCLUDED.campaign_token_is_currency0`,
    [
      token,
      cfg.venue,
      cfg.pairAddress ?? null,
      cfg.campaignTokenIsToken0 ?? null,
      cfg.poolManagerAddress ?? null,
      cfg.poolId ?? null,
      cfg.campaignTokenIsCurrency0 ?? null,
    ]
  );
}

module.exports = {
  pool,
  getCursor,
  setCursor,
  upsertCampaign,
  listCampaigns,
  insertTrade,
  tradesForWallet,
  getTokenPool,
  upsertTokenPool,
};
