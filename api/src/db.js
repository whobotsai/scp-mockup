// Read-only Postgres access against the same database the keeper writes to
// (DATABASE_URL should point at that same instance). This package never writes to any table
// the keeper owns -- it only reads what's already been indexed, matching this layer's own
// "not a source of truth" role (docs/BACKEND_ROADMAP.md's Stage 2 stack guidance).
"use strict";
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function listCampaignsByFactory(factory) {
  const { rows } = await pool.query("SELECT * FROM campaigns WHERE factory = $1 ORDER BY created_at DESC", [factory]);
  return rows;
}

async function getCampaign(campaignAddress) {
  const { rows } = await pool.query("SELECT * FROM campaigns WHERE campaign_address = $1", [campaignAddress]);
  return rows[0] || null;
}

/// SHO's live "current standing" leaderboard, for display only -- not what the keeper actually
/// used to decide a milestone crossing (that's milestoneEngine.js's own committed computation,
/// frozen into a snapshot once a milestone crosses). Same net-buy rule (PRD §2.2: buy minus
/// sell, net-negative wallets excluded entirely) expressed directly in SQL rather than porting
/// volumeAggregator.js's JS a second time -- acceptable here specifically because this result
/// is never used to compute anything that gets posted on-chain; a claim's actual proof always
/// comes from the stored snapshot (see claimProofFor below), never from this query.
async function shoLeaderboard(campaignAddress, sinceTime, limit) {
  const { rows } = await pool.query(
    `SELECT wallet, SUM(CASE WHEN side = 'buy' THEN usd_value ELSE -usd_value END) AS score
     FROM sho_trades
     WHERE campaign_address = $1 AND block_time >= $2
     GROUP BY wallet
     HAVING SUM(CASE WHEN side = 'buy' THEN usd_value ELSE -usd_value END) > 0
     ORDER BY score DESC
     LIMIT $3`,
    [campaignAddress, sinceTime, limit]
  );
  return rows.map((r) => ({ wallet: r.wallet, score: Number(r.score) }));
}

/// SSO's live "current standing" leaderboard for one epoch, same display-only caveat as
/// shoLeaderboard above. The "best 5 posts per account" cap (PRD §12.2) is expressed with a
/// window function rather than porting socialScoreAggregator.js's JS a second time, for the
/// same reason: this is never the source of a claim proof, only a live preview.
async function ssoLeaderboard(campaignAddress, epochIndex, limit) {
  const { rows } = await pool.query(
    `SELECT wallet, SUM(score) AS score FROM (
       SELECT wallet, score, ROW_NUMBER() OVER (PARTITION BY wallet ORDER BY score DESC) AS rn
       FROM sso_posts
       WHERE campaign_address = $1 AND epoch_index = $2
     ) ranked
     WHERE rn <= 5
     GROUP BY wallet
     ORDER BY score DESC
     LIMIT $3`,
    [campaignAddress, epochIndex, limit]
  );
  return rows.map((r) => ({ wallet: r.wallet, score: Number(r.score) }));
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

async function listSnapshotsForCampaign(campaignAddress) {
  const { rows } = await pool.query(
    'SELECT * FROM snapshots WHERE campaign_address = $1 ORDER BY "index" ASC',
    [campaignAddress]
  );
  return rows;
}

/// Every finalized snapshot across every campaign a wallet's address appears in as an
/// entries[].account -- the basis for that wallet's claim history (walletRoutes.js). A jsonb
/// containment query (`entries @> ...`) would need the exact-case address as stored; entries
/// are stored with whatever casing came out of ethers (checksummed), so callers should pass
/// a checksummed address, and this falls back to a full scan only if that yields nothing.
async function snapshotsForWallet(wallet) {
  const { rows } = await pool.query(
    `SELECT s.*, c.factory FROM snapshots s
     JOIN campaigns c ON c.campaign_address = s.campaign_address
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements(s.entries) e
       WHERE lower(e->>'account') = lower($1)
     )
     ORDER BY s.computed_at DESC`,
    [wallet]
  );
  return rows;
}

async function tokenTradeCampaigns(wallet) {
  const { rows } = await pool.query(
    "SELECT DISTINCT campaign_address FROM sho_trades WHERE lower(wallet) = lower($1)",
    [wallet]
  );
  return rows.map((r) => r.campaign_address);
}

async function socialPostCampaigns(wallet) {
  const { rows } = await pool.query(
    "SELECT DISTINCT campaign_address FROM sso_posts WHERE lower(wallet) = lower($1)",
    [wallet]
  );
  return rows.map((r) => r.campaign_address);
}

async function createdCampaigns(creator) {
  const { rows } = await pool.query(
    "SELECT * FROM campaigns WHERE lower(creator) = lower($1) ORDER BY created_at DESC",
    [creator]
  );
  return rows;
}

module.exports = {
  pool,
  listCampaignsByFactory,
  getCampaign,
  shoLeaderboard,
  ssoLeaderboard,
  priceSamplesSince,
  getSnapshot,
  listSnapshotsForCampaign,
  snapshotsForWallet,
  tokenTradeCampaigns,
  socialPostCampaigns,
  createdCampaigns,
};
