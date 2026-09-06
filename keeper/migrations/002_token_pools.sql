-- Per-token Uniswap V4 pool config, needed by tradeSources/uniswapV4.js's fetchTrades.
-- Deliberate simplification for now: tokens go straight to a Uniswap V4 pool at launch,
-- no Pons.family bonding-curve phase (Pons's contract ABI still isn't available -- see
-- ../src/tradeSources/ponsBondingCurve.js -- and this decision unblocks real indexing without
-- waiting on that). A campaign's token with no row here simply has nothing to index yet
-- (src/index.js skips it with a log line, not an error).
CREATE TABLE IF NOT EXISTS token_pools (
  token                          text PRIMARY KEY,
  pool_manager_address           text NOT NULL,
  pool_id                        text NOT NULL,  -- bytes32, hex string
  campaign_token_is_currency0    boolean NOT NULL,
  registered_at                  timestamptz NOT NULL DEFAULT now()
);
