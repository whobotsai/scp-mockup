-- The wallet<->handle table PRD.md section 12.3 refers to. This is an audit/debug record of every
-- attestation this service has ever issued -- the source of truth for "is this wallet linked"
-- is Registry.sol's own handleOf mapping (registerHandle() may never actually get submitted
-- on-chain for a given attestation, or a wallet could later be re-linked to a different
-- handle on-chain without this table knowing) -- so this table is never read by the on-chain
-- verification path, only by this service's own operators for debugging/support.
CREATE TABLE IF NOT EXISTS registrations (
  id            bigserial PRIMARY KEY,
  wallet        text NOT NULL,
  x_handle      text NOT NULL,
  attestation   text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registrations_wallet ON registrations (wallet);
