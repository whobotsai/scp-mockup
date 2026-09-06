-- token_pools was written V4-only in 002_token_pools.sql before it became clear Uniswap V4
-- isn't deployed on Robinhood Chain Testnet at all (only mainnet) -- confirmed in practice,
-- not assumed. Testnet indexing uses a self-deployed Uniswap-V2-style pair instead (see
-- contracts/src/mocks/UniswapV2Pair.sol), while the V4 path stays available for whenever
-- mainnet is in scope. This migration generalizes the table to carry either venue's config.
ALTER TABLE token_pools ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT 'uniswap_v4';
ALTER TABLE token_pools ALTER COLUMN pool_manager_address DROP NOT NULL;
ALTER TABLE token_pools ALTER COLUMN pool_id DROP NOT NULL;
ALTER TABLE token_pools ALTER COLUMN campaign_token_is_currency0 DROP NOT NULL;
ALTER TABLE token_pools ADD COLUMN IF NOT EXISTS pair_address text;
ALTER TABLE token_pools ADD COLUMN IF NOT EXISTS campaign_token_is_token0 boolean;
