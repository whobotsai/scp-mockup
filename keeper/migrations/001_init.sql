-- Subset of the full data model in ../../docs/KEEPER_SERVICE_DESIGN.md §3 needed for the
-- Chain Indexer + Volume Aggregator (build order step 1 in that doc's §8). Later steps'
-- tables (sso_posts, snapshots, root_submissions) are added in a later migration once those
-- components are actually being built — not created ahead of time unused.

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id       bigint NOT NULL,
  factory           text NOT NULL,             -- 'sho' | 'sso' — only 'sho' populated so far
  campaign_address  text PRIMARY KEY,
  token             text NOT NULL,
  reward_token      text NOT NULL,
  creator           text NOT NULL,
  created_at        timestamptz NOT NULL,
  duration_seconds  bigint NOT NULL,
  leaderboard_size  smallint NOT NULL,
  window_seconds    bigint NOT NULL            -- SHO's LeaderboardWindow, resolved to seconds
);

CREATE TABLE IF NOT EXISTS sho_trades (
  campaign_address  text NOT NULL REFERENCES campaigns(campaign_address),
  tx_hash           text NOT NULL,
  log_index         int NOT NULL,
  wallet            text NOT NULL,
  venue             text NOT NULL,             -- 'uniswap_v2' | 'pons_bonding_curve'
  side              text NOT NULL,             -- 'buy' | 'sell'
  usd_value         numeric NOT NULL,
  block_number      bigint NOT NULL,
  block_time        timestamptz NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS sho_trades_campaign_wallet_time
  ON sho_trades (campaign_address, wallet, block_time);

-- Tracks the last block each indexed source has fully processed, per campaign, so a
-- restart resumes instead of re-scanning from SHO_FACTORY_DEPLOY_BLOCK every time.
CREATE TABLE IF NOT EXISTS indexer_cursors (
  cursor_key   text PRIMARY KEY,   -- e.g. 'campaign_factory', or 'trades:<campaign_address>'
  last_block   bigint NOT NULL
);
