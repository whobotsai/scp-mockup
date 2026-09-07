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

/// c.windowSeconds: SHO only, null for an SSO row. c.keyword: SSO only, null for an SHO row.
async function upsertCampaign(c) {
  await pool.query(
    `INSERT INTO campaigns
       (campaign_id, factory, campaign_address, token, reward_token, creator,
        created_at, duration_seconds, leaderboard_size, window_seconds, keyword)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (campaign_address) DO NOTHING`,
    [
      c.campaignId, c.factory, c.campaignAddress, c.token, c.rewardToken, c.creator,
      c.createdAt, c.durationSeconds, c.leaderboardSize, c.windowSeconds ?? null, c.keyword ?? null,
    ]
  );
}

async function listCampaigns() {
  const { rows } = await pool.query("SELECT * FROM campaigns ORDER BY created_at ASC");
  return rows;
}

async function getCampaign(campaignAddress) {
  const { rows } = await pool.query("SELECT * FROM campaigns WHERE campaign_address = $1", [campaignAddress]);
  return rows[0] || null;
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

async function insertPriceSample(token, venue, priceUsd, sampledAt) {
  await pool.query(
    "INSERT INTO sho_price_samples (token, venue, price_usd, sampled_at) VALUES ($1,$2,$3,$4)",
    [token, venue, priceUsd, sampledAt]
  );
}

async function priceSamplesSince(token, sinceTime) {
  const { rows } = await pool.query(
    "SELECT price_usd, sampled_at FROM sho_price_samples WHERE token = $1 AND sampled_at >= $2",
    [token, sinceTime]
  );
  return rows;
}

async function getSnapshot(campaignAddress, index) {
  const { rows } = await pool.query(
    'SELECT * FROM snapshots WHERE campaign_address = $1 AND "index" = $2',
    [campaignAddress, index]
  );
  return rows[0] || null;
}

/// s.entries: [{account, amount}] with amount as a decimal string (BigInt.toString()) --
/// jsonb doesn't distinguish int from string, so storing it as a string here avoids any
/// precision loss round-tripping a uint256-scale number through JSON.
async function insertSnapshot(s) {
  await pool.query(
    `INSERT INTO snapshots (campaign_address, "index", merkle_root, snapshot_hash, entries, status)
     VALUES ($1,$2,$3,$4,$5,'computed')
     ON CONFLICT (campaign_address, "index") DO NOTHING`,
    [s.campaignAddress, s.index, s.merkleRoot, s.snapshotHash, JSON.stringify(s.entries)]
  );
}

async function snapshotsMissingIpfsCid() {
  const { rows } = await pool.query("SELECT * FROM snapshots WHERE ipfs_cid IS NULL");
  return rows;
}

async function setSnapshotIpfsCid(campaignAddress, index, cid) {
  await pool.query(
    `UPDATE snapshots SET ipfs_cid = $3, status = 'published'
     WHERE campaign_address = $1 AND "index" = $2`,
    [campaignAddress, index, cid]
  );
}

/// Every snapshot the On-chain Poster hasn't yet marked 'posted' -- deliberately not filtered
/// by ipfs_cid. Whether a milestone is already reached() on-chain is independent of whether
/// its snapshot ever got pinned to IPFS: gating this query on ipfs_cid meant a snapshot whose
/// publish kept failing could never get its bookkeeping backfilled even after a human posted
/// it by hand, so the missed-root alert (alerts.js) fired forever on an already-fine milestone
/// -- confirmed live. postPendingRoots (onchainPoster.js) checks on-chain state per snapshot
/// and only requires ipfs_cid before actually sending a transaction for one that truly isn't
/// reached yet.
async function unpostedSnapshots() {
  const { rows } = await pool.query("SELECT * FROM snapshots WHERE status != 'posted'");
  return rows;
}

async function markSnapshotPosted(campaignAddress, index) {
  await pool.query(
    `UPDATE snapshots SET status = 'posted' WHERE campaign_address = $1 AND "index" = $2`,
    [campaignAddress, index]
  );
}

async function getRootSubmission(campaignAddress, index) {
  const { rows } = await pool.query(
    'SELECT * FROM root_submissions WHERE campaign_address = $1 AND "index" = $2',
    [campaignAddress, index]
  );
  return rows[0] || null;
}

async function upsertRootSubmission(s) {
  await pool.query(
    `INSERT INTO root_submissions (campaign_address, "index", status, tx_hash, confirmed_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'confirmed' THEN now() ELSE NULL END)
     ON CONFLICT (campaign_address, "index") DO UPDATE SET
       status = EXCLUDED.status,
       tx_hash = COALESCE(EXCLUDED.tx_hash, root_submissions.tx_hash),
       confirmed_at = CASE WHEN EXCLUDED.status = 'confirmed' THEN now() ELSE root_submissions.confirmed_at END`,
    [s.campaignAddress, s.index, s.status, s.txHash ?? null]
  );
}

/// Snapshots crossed at least slaMs ago with no root_submissions row that ever reached
/// 'confirmed' -- the missed-root alert (KEEPER_SERVICE_DESIGN.md section 4.8), the single
/// most safety-critical check in the system: it's what stands between "keeper working" and
/// "funds silently unclaimable because nobody posted a root."
async function overdueUnconfirmedSnapshots(slaMs) {
  const { rows } = await pool.query(
    `SELECT s.* FROM snapshots s
     LEFT JOIN root_submissions r ON r.campaign_address = s.campaign_address AND r."index" = s."index" AND r.status = 'confirmed'
     WHERE r.campaign_address IS NULL AND s.computed_at < $1`,
    [new Date(Date.now() - slaMs)]
  );
  return rows;
}

/// Upserts the current (wallet -> xHandle) direction of Registry.sol's handleOf mapping, from
/// an indexed HandleRegistered event. Last write wins per wallet, same as the contract itself
/// (calling registerHandle again just overwrites) -- see migrations/007_sso.sql's own comment
/// on why this table is keyed by wallet, not x_handle.
async function upsertHandleRegistration(wallet, xHandle, updatedAt) {
  await pool.query(
    `INSERT INTO handle_registrations (wallet, x_handle, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (wallet) DO UPDATE SET x_handle = EXCLUDED.x_handle, updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at >= handle_registrations.updated_at`,
    [wallet, xHandle, updatedAt]
  );
}

/// Case-insensitive, since X handles aren't case-sensitive in practice. Returns null if no
/// wallet has ever registered this handle -- socialIndexer.js treats that as "post doesn't
/// qualify," not an error (PRD section 12.2: "a post from an unregistered account never
/// enters sso_posts at all").
async function resolveWalletForHandle(xHandle) {
  const { rows } = await pool.query(
    "SELECT wallet FROM handle_registrations WHERE lower(x_handle) = lower($1) LIMIT 1",
    [xHandle]
  );
  return rows.length ? rows[0].wallet : null;
}

/// Upsert, not insert-once: a post's engagement metrics (and therefore its score) keep
/// changing for as long as the epoch stays open, so re-polling the same post needs to refresh
/// its stored row rather than freeze it at whatever it was the first time it was seen.
async function insertSsoPost(p) {
  await pool.query(
    `INSERT INTO sso_posts
       (campaign_address, post_id, wallet, x_handle, epoch_index, retweets, quotes, replies, likes, score, posted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (campaign_address, post_id) DO UPDATE SET
       retweets = EXCLUDED.retweets,
       quotes = EXCLUDED.quotes,
       replies = EXCLUDED.replies,
       likes = EXCLUDED.likes,
       score = EXCLUDED.score`,
    [
      p.campaignAddress, p.postId, p.wallet, p.xHandle, p.epochIndex,
      p.retweets, p.quotes, p.replies, p.likes, p.score, p.postedAt,
    ]
  );
}

async function postsForEpoch(campaignAddress, epochIndex) {
  const { rows } = await pool.query(
    "SELECT wallet, score FROM sso_posts WHERE campaign_address = $1 AND epoch_index = $2",
    [campaignAddress, epochIndex]
  );
  return rows;
}

module.exports = {
  pool,
  getCursor,
  setCursor,
  upsertCampaign,
  listCampaigns,
  getCampaign,
  insertTrade,
  tradesForWallet,
  getTokenPool,
  upsertTokenPool,
  insertPriceSample,
  priceSamplesSince,
  getSnapshot,
  insertSnapshot,
  snapshotsMissingIpfsCid,
  setSnapshotIpfsCid,
  unpostedSnapshots,
  markSnapshotPosted,
  getRootSubmission,
  upsertRootSubmission,
  overdueUnconfirmedSnapshots,
  upsertHandleRegistration,
  resolveWalletForHandle,
  insertSsoPost,
  postsForEpoch,
};
