-- On-chain Poster's tracking table (KEEPER_SERVICE_DESIGN.md section 4.7 and section 6's
-- idempotency requirement: "a crashed poster resumes from root_submissions' last
-- non-confirmed row for a given (campaign_address, index) rather than re-proposing a
-- duplicate [transaction]"). One row per milestone/epoch root submission attempt.
CREATE TABLE IF NOT EXISTS root_submissions (
  campaign_address  text NOT NULL REFERENCES campaigns(campaign_address),
  "index"           int NOT NULL,
  status            text NOT NULL DEFAULT 'proposed', -- proposed | confirmed | failed
  tx_hash           text,
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  PRIMARY KEY (campaign_address, "index")
);
