-- Milestone Engine's frozen leaderboard snapshots (KEEPER_SERVICE_DESIGN.md section 4.5).
-- ipfs_cid stays null for now -- publishing to IPFS is a later build-order step (Snapshot
-- Publisher); this step computes and stores the snapshot locally and prints the exact
-- postMilestoneRoot call to run by hand (still a manual posting step, per section 8's build
-- order: "proves the scoring is right before automating the posting").
CREATE TABLE IF NOT EXISTS snapshots (
  campaign_address       text NOT NULL REFERENCES campaigns(campaign_address),
  "index"                int NOT NULL,
  merkle_root            text NOT NULL,
  snapshot_hash          text NOT NULL,
  ipfs_cid               text,
  entries                jsonb NOT NULL,
  status                 text NOT NULL DEFAULT 'computed',
  challenge_window_ends  timestamptz,
  computed_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_address, "index")
);
