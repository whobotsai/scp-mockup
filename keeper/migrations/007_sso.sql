-- Extends the shared `campaigns` table for SSO (KEEPER_SERVICE_DESIGN.md section 3's own
-- data model already envisioned `keyword text -- SSO only` on this same table -- 001_init.sql
-- only carried the SHO-only columns needed for build-order step 1). window_seconds is SHO's
-- LeaderboardWindow and has no SSO equivalent, so it has to stop being NOT NULL for an SSO
-- campaign row to insert at all.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS keyword text; -- SSO only
ALTER TABLE campaigns ALTER COLUMN window_seconds DROP NOT NULL; -- SHO only

-- SSO's Social Indexer output: qualifying posts, after the registration-table join and the
-- age/follower gate (KEEPER_SERVICE_DESIGN.md section 3, PRD section 12.2). Append-only, one
-- row per counted post -- same shape as sho_trades storing every trade and letting
-- volumeAggregator.js's pure function apply the eligibility rule afterward. The "best 5 posts
-- per account per epoch" cap (PRD section 12.2) is likewise applied in
-- socialScoreAggregator.js's pure function, not here.
CREATE TABLE IF NOT EXISTS sso_posts (
  campaign_address  text NOT NULL REFERENCES campaigns(campaign_address),
  post_id           text NOT NULL,
  wallet            text NOT NULL,
  x_handle          text NOT NULL,
  epoch_index       int NOT NULL,
  retweets          int NOT NULL,
  quotes            int NOT NULL,
  replies           int NOT NULL,
  likes             int NOT NULL,
  score             numeric NOT NULL, -- 2*(retweets+quotes) + replies + 0.5*likes, PRD section 12.2
  posted_at         timestamptz NOT NULL,
  PRIMARY KEY (campaign_address, post_id)
);

CREATE INDEX IF NOT EXISTS sso_posts_campaign_epoch_wallet
  ON sso_posts (campaign_address, epoch_index, wallet);

-- Reverse index for Registry.sol's handleOf(wallet) => xHandle mapping, built by indexing
-- HandleRegistered events (registrationIndexer.js) -- a Solidity mapping isn't reverse-
-- queryable on-chain, and the Social Indexer needs exactly the reverse direction (given a
-- post's x_handle, find the wallet it belongs to). Keyed by wallet, matching the contract's
-- own "one current handle per wallet" semantics (calling registerHandle again overwrites);
-- x_handle isn't declared unique here since nothing on-chain enforces that either -- see
-- socialIndexer.js's own comment on this simplification.
CREATE TABLE IF NOT EXISTS handle_registrations (
  wallet      text PRIMARY KEY,
  x_handle    text NOT NULL,
  updated_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS handle_registrations_x_handle ON handle_registrations (lower(x_handle));
