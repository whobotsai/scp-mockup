-- Price/TWAP Oracle's raw price samples (KEEPER_SERVICE_DESIGN.md section 4.3).
-- One row per tick per token -- twapOracle.js reads a token's rows since (now - 30 minutes)
-- and computes a time-weighted average from them. This table was missing from the original
-- build-order step 2 migration set even though priceSampler.js/db.js already wrote to it --
-- fixed here rather than folded into 004_snapshots.sql, so an already-applied 004 elsewhere
-- doesn't need to be redone.
CREATE TABLE IF NOT EXISTS sho_price_samples (
  id          bigserial PRIMARY KEY,
  token       text NOT NULL,
  venue       text NOT NULL,
  price_usd   double precision NOT NULL,
  sampled_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sho_price_samples_token_sampled_at_idx
  ON sho_price_samples (token, sampled_at);
