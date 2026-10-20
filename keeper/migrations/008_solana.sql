-- Adds Solana as a second supported network (see ../../contracts-solana/README.md and
-- ../src/solanaCampaignIndexer.js). 'evm' default backfills every existing row correctly,
-- since EVM campaigns are the only kind that existed before this migration.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'evm'; -- 'evm' | 'solana'

CREATE INDEX IF NOT EXISTS campaigns_network ON campaigns (network);
