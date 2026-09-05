# Keeper Service — Technical Design (Stage 1)

This turns `BACKEND_ROADMAP.md`'s Stage 1 bullet points into an implementable design: concrete
modules, a data model, the job/queue architecture between them, and the operational posture
Stage 1's own guiding principle demands ("build it, test it, and monitor it like the thing
that can lose user funds if it misbehaves"). It does not re-derive the mechanism — every
behavior here traces back to `PRD.md` §2–§3 (SHO) and §12.2–§12.3 (SSO); where this doc makes
a concrete choice the PRD leaves open (a queue library, a DB schema), that choice is called
out as this design's own, not the PRD's.

## 1. Scope

One keeper service, two campaign types. SHO and SSO reuse the same downstream pipeline
(Leaderboard/Milestone-Epoch Engine → Merkle build → snapshot publish → multi-sig poster);
they differ only in what feeds the top of it (chain trades vs. social posts) and in the
on-chain call each makes (`postMilestoneRoot` vs `postEpochRoot`). One service, two upstream
adapters, shared core — not two services.

**Stage 1 exit criteria (from the roadmap, restated as this design's acceptance test):** a
testnet SHO campaign and a testnet SSO campaign each complete a full cycle — lock, organic
activity, automatic detection, root posted, challenge window elapses, claim succeeds — with
zero manual steps. `contracts/scripts/test/*.js` is what today's *manual* version of that
cycle looks like; Stage 1 is what automates step 2 of it (`postMilestoneRoot`/`postEpochRoot`)
away from a human running a script.

## 2. Architecture

```
SHO path:
  Pons bonding curve + Uniswap V4 pool
              │ (swap/transfer events)
              ▼
      Chain Indexer ──────────────┐
              │                    │
              ▼                    ▼
   Volume Aggregator      Price/TWAP Oracle
   (net-buy per wallet)   (30-min circulating mcap)
              │                    │
              └─────────┬──────────┘
                         ▼
SSO path:                Leaderboard & Milestone/Epoch Engine
  X API (keyword search)         │  - detects a crossing (SHO) or an
              │                   │    epoch boundary (SSO)
              ▼                   │  - freezes a snapshot
      Social Indexer              │  - computes each account's share
   (needs Registration            │  - builds the Merkle tree
    Service's wallet↔handle table)│
              │                   │
              └─────────┬─────────┘
                         ▼
              Snapshot Publisher (→ IPFS, hash on-chain)
                         │
                         ▼
              On-chain Poster (queues postMilestoneRoot /
                                postEpochRoot as a Safe tx)
                         │
                         ▼
              Keeper Multi-sig (3-of-5 Gnosis Safe)
                         │
                         ▼
              SHOCampaign.postMilestoneRoot() /
              SSOCampaign.postEpochRoot()
```

Everything from the Leaderboard & Milestone/Epoch Engine down is genuinely shared code —
per PRD §12.3 ("everything downstream ... is structurally identical to SHO's keeper"). Only
the two indexers and the TWAP oracle (SHO-only, per PRD §12.3: "SSO doesn't depend on token
price or mcap at all") are campaign-type-specific.

## 3. Data model

Postgres (per `BACKEND_ROADMAP.md`'s suggested stack). This is the keeper's own working
state — never a second source of truth for anything the chain or a finalized snapshot
already states authoritatively; it can be rebuilt from chain history plus the X API if lost.

```sql
-- One row per campaign the keeper has picked up (from CampaignCreated events, both factories).
campaigns (
  campaign_id        bigint,          -- factory-local nextId, not globally unique alone
  factory            text,            -- 'sho' | 'sso'
  campaign_address   text primary key,
  token              text,
  reward_token       text,
  creator            text,
  keyword            text,            -- SSO only
  created_at         timestamptz,
  duration_seconds   bigint,
  leaderboard_size    smallint,
  status             text             -- mirrors the contract's live status(); cached, not authoritative
)

-- SHO only: every indexed swap, both venues, used to compute net-buy volume.
sho_trades (
  campaign_address   text,
  tx_hash            text,
  log_index          int,
  wallet             text,
  venue              text,            -- 'pons_bonding_curve' | 'uniswap_v4'
  side               text,            -- 'buy' | 'sell'
  usd_value          numeric,         -- valued at this trade's own execution price, per PRD §2.2
  block_number        bigint,
  block_time          timestamptz,
  primary key (tx_hash, log_index)
)

-- SHO only: rolling TWAP price samples feeding the 30-min circulating-mcap oracle.
sho_price_samples (
  token              text,
  venue              text,
  price_usd          numeric,
  sampled_at         timestamptz
)

-- SSO only: qualifying posts, after the registration-table join and the age/follower gate.
sso_posts (
  campaign_address   text,
  post_id            text,
  wallet             text,            -- resolved via the Registration Service's table
  x_handle           text,
  epoch_index        int,
  retweets           int,
  quotes             int,
  replies            int,
  likes              int,
  score              numeric,         -- 2*(retweets+quotes) + replies + 0.5*likes, PRD §12.2
  posted_at          timestamptz,
  primary key (campaign_address, post_id)
)

-- Shared: one row per milestone (SHO) or epoch (SSO) crossing/close the engine has processed.
snapshots (
  campaign_address       text,
  index                  int,          -- milestoneIndex or epochIndex
  merkle_root            text,
  snapshot_hash          text,
  ipfs_cid               text,
  entries                jsonb,        -- [{account, amount}], the full published leaderboard
  status                 text,         -- 'computed' | 'posted' | 'corrected' | 'finalized'
  challenge_window_ends  timestamptz,
  computed_at            timestamptz,
  primary key (campaign_address, index)
)

-- Every on-chain post attempt, for idempotency and incident review — see §6.
root_submissions (
  id                 bigserial primary key,
  campaign_address   text,
  index              int,
  merkle_root        text,
  safe_tx_hash        text,
  tx_hash            text,
  status             text,          -- 'proposed' | 'submitted' | 'confirmed' | 'failed'
  attempted_at       timestamptz,
  error              text
)
```

## 4. Components

### 4.1 Chain Indexer (SHO)

Subscribes to swap events on a token's Pons bonding-curve contract and, post-graduation, its
Uniswap V4 pool (PRD §2.2). Per `BACKEND_ROADMAP.md`'s infra note, this runs against a
self-hosted archive node rather than polling a third-party RPC for every swap — high-frequency
event volume across many concurrent campaigns makes third-party rate limits and cost a real
constraint, not a hypothetical one.

- Tracks one token per active SHO campaign (a token can have multiple concurrent campaigns,
  PRD §2.1 — the indexer subscribes once per token, not once per campaign, and the Volume
  Aggregator fans a token's trades out to every campaign tracking it).
- Reorg handling: buffer the last N blocks unconfirmed; only write a trade into `sho_trades`
  once it has the chain's standard confirmation depth. A reorg deeper than that is an
  incident, not a case this component silently papers over.
- Backfill: on first seeing a new `CampaignCreated` event, indexes that token's trades from
  the campaign's own `createdAt` forward — a campaign only ever ranks activity from its own
  creation onward (its `window` is a trailing window measured from "now," not from the
  token's own genesis), so there is no need to replay a token's full trading history just
  because a new campaign starts tracking it.

### 4.2 Volume Aggregator (SHO)

For each campaign, maintains each wallet's **net-buy volume** (total USD-equivalent bought
minus sold, PRD §2.2) over the campaign's configured trailing `window` (24H/7D/30D). Wallets
with net-negative volume are excluded entirely, not floored to zero (PRD §2.2 — this is a
ranking-eligibility rule, not a display rule, so the aggregator's output should simply omit
them rather than emit a zero entry the engine has to filter again downstream).

Implementation note: this is a sliding-window aggregate recomputed incrementally as new trades
land, not a full recompute-from-scratch on every new block — a token that's had months of
history behind an older campaign shouldn't force a full replay every time a newer campaign
using the same token needs its own window's numbers.

### 4.3 Price/TWAP Oracle (SHO only)

Computes the 30-minute circulating-mcap TWAP (PRD §2.3) from `sho_price_samples`, combining
bonding-curve and Uniswap V4 price data. Circulating mcap = price × total supply as reported
on-chain (PRD §5 — no netting-out of locked/vesting supply; this oracle does not need to know
anything about a token's vesting schedule, deliberately).

A milestone is "confirmed crossed" only once the TWAP has been sustained over the threshold
for the full 30-minute window (PRD §2.3) — the engine (§4.5) is what checks this against each
campaign's remaining milestones; this module just exposes `twapAt(token, timestamp)`.

### 4.4 Social Indexer (SSO)

Polls the X API for posts matching a campaign's tracked `keyword` (PRD §12.2–12.3). For each
post: resolve the poster's wallet via the Registration Service's `(x_handle, wallet)` table
(a post from an unregistered account never enters `sso_posts` at all — it doesn't qualify and
never will retroactively, since registration only ever gates *future* counting), apply the
protocol-wide gates (account age ≥ 30 days, followers ≥ 25, PRD §12.5), then keep only the
account's best 5 qualifying posts for that epoch (PRD §12.2).

Rate limits are the operative constraint here, not compute — the X API's search/filtered-stream
tier in use determines poll frequency; this is an infrastructure decision to make once a tier
is chosen (see §7).

### 4.5 Leaderboard & Milestone/Epoch Engine

The shared core. Two triggers feed it:

- **SHO**: on every new TWAP value, check each active campaign's next unreached milestone
  tier against it. A crossing sustained the full 30-min window flips that milestone
  `reached` (mirrors the contract's own one-way `reached` flag, PRD §2.3).
- **SSO**: on a wall-clock schedule, check each active campaign's next unfinalized epoch's
  `endsAt` (computed once at campaign creation, PRD §12.4) — no market data involved at all.

On either trigger:
1. Freeze a leaderboard snapshot: for SHO, each eligible wallet's net-buy volume as of that
   moment (PRD §2.3); for SSO, each qualifying account's summed post scores for the epoch
   (PRD §12.2).
2. Take the top `leaderboardSize` accounts, allocate that tier's/epoch's reward proportionally
   to their score.
3. Build the Merkle tree using the exact leaf encoding `contracts/src/libraries/ClaimVerifier.sol`
   verifies on-chain (double-hashed `(account, amount)`, sorted-pair internal nodes) — this
   production build should literally port `contracts/test/helpers/merkle.js`'s `buildTree`,
   not reimplement it, so the two are guaranteed to stay in lockstep as the contracts evolve.
4. Write the result to `snapshots` as `computed`, and hand off to the Snapshot Publisher.

### 4.6 Snapshot Publisher

Publishes the full leaderboard (wallet → score → allocated reward, PRD §4.4/§12.2) to IPFS,
content-addressed, so anyone can independently recompute the root during the 24h challenge
window (PRD §2.3 — this is what makes the challenge window meaningful; without a published
snapshot, "challenge window" would just mean "wait 24 hours," not "anyone can actually check
the math"). Records the resulting CID in `snapshots.ipfs_cid`.

**Open decision, not yet made (flagging per this design's own guiding principle — no new
backend concept invented silently): which IPFS pinning provider.** Needs an account and an
API key of its own once chosen — handled the same way every other credential in this project
is: added directly via that provider's own dashboard/secrets store, never committed to the
repo.

### 4.7 On-chain Poster + Keeper Multi-sig

Takes a `computed` snapshot and turns it into a `postMilestoneRoot`/`postEpochRoot` call,
signed by the keeper multi-sig — target a 3-of-5 Gnosis Safe (PRD §3.2), gas funded from the
protocol treasury so creators/traders never pay keeper gas (PRD §2.1).

- Proposes the Safe transaction, records it in `root_submissions` as `proposed`.
- Once enough of the 5 signers approve (this is where a human-in-the-loop step exists in the
  MVP — PRD §3.2 names the multi-sig as the MVP's single trusted component precisely because
  this step is not yet permissionless; Phase 2 per PRD §7 is what removes it), executes and
  records the resulting `tx_hash`.
- A **correction** (posting again for the same index before its challenge window elapses,
  PRD §2.3) goes through the identical flow — the contract's own `RootCorrected` vs.
  `RootPosted` distinction (see `SHOCampaign.sol`) is what tells the poster which event to
  expect back.

### 4.8 Monitoring / Alerting

Per the roadmap's guiding principle ("a missed or malformed root post is a production
incident, not a bug to notice later"), Stage 1 ships monitoring alongside the poster, not
after it:

- **Missed-root alert**: a milestone confirmed crossed (SHO) or an epoch past `endsAt` (SSO)
  with no corresponding `root_submissions` row reaching `confirmed` within a defined SLA
  (e.g. 1 hour) pages whoever's on call. This is the single most safety-critical alert in the
  system — it is the thing standing between "keeper working" and "funds silently unclaimable
  because nobody posted a root."
  A milestone the TWAP oracle simply hasn't crossed yet is not an incident and must never
  page — only a *confirmed* crossing with no root counts.
- **Indexer-lag alert**: Chain Indexer or Social Indexer falling behind chain head / the X
  API's real-time stream by more than a threshold.
- **Safe-signer-availability alert**: a proposed Safe tx sitting unsigned past a threshold —
  surfaces a stuck multi-sig before it becomes a missed-root incident.
- **Snapshot/root mismatch check**: periodically re-derive a *finalized* root independently
  from `snapshots.entries` and diff it against what's actually on-chain — this is the
  automated version of what the challenge window lets any outside party do manually; running
  it as a keeper self-check catches the keeper's own mistakes before someone else has to.

## 5. Job / queue architecture

BullMQ (per the roadmap's suggested stack), one queue per stage of the pipeline so a slow or
failing stage doesn't block the others:

`chain-index` → `social-index` → `volume-aggregate` → `twap-compute` → `milestone-epoch-check`
→ `snapshot-build` → `snapshot-publish` → `root-post`

Each job is idempotent on `(campaign_address, index)` — re-running `snapshot-build` for a
milestone/epoch that already has a `computed` row is a no-op, not a duplicate. This matters
specifically because `root-post` failures (a stuck Safe tx, an RPC hiccup) need to be safely
retryable without redoing the (potentially expensive) snapshot computation above it.

## 6. Idempotency & failure recovery

- A crashed indexer resumes from its last confirmed block per token — `sho_trades`/`sso_posts`
  are append-only and keyed so a re-index of an already-seen range is a no-op.
- A crashed engine mid-snapshot recomputes from `sho_trades`/`sso_posts` — nothing about the
  snapshot computation depends on in-memory state that isn't also in Postgres.
- A crashed poster resumes from `root_submissions`' last non-`confirmed` row for a given
  `(campaign_address, index)` rather than re-proposing a duplicate Safe tx.
- Every stage's failure mode is "stall and alert," never "silently skip and move on" — a
  silent skip on this pipeline means unclaimable funds, not a cosmetic gap.

## 7. Open decisions this design surfaces

Consistent with the roadmap's own "no new backend concept that isn't already in the PRD"
principle — these are infrastructure/vendor choices, not mechanism changes, and are called
out rather than picked unilaterally:

- **IPFS pinning provider** (§4.6) — needs an account + API key before Stage 1 can actually
  publish a snapshot anywhere real.
- **X API tier** (§4.4) — determines Social Indexer poll frequency and cost; SSO can't index
  anything real without this chosen first.
- **Archive node provider** for the Chain Indexer (`BACKEND_ROADMAP.md`'s own infra note) —
  self-hosted vs. a specific managed provider.
- **On-call rotation** for the missed-root alert (§4.8) — a real person/team needs to own this
  before Stage 1 can be considered actually monitored, not just instrumented.

## 8. Suggested build order within Stage 1

Smallest thing that proves the pipeline works end-to-end first, then breadth:

1. Chain Indexer + Volume Aggregator against the Stage 0 testnet deployment's SHO factory,
   for a single manually-created campaign — reuse `contracts/scripts/test/01-create-campaign.js`'s
   campaign as the first real target instead of another synthetic one.
2. Price/TWAP Oracle + Milestone Engine's crossing detection, still manual snapshot→root (i.e.
   replace `contracts/scripts/test/02-post-root.js`'s hand-built single-leaf root with the
   engine's real multi-account output, but still post it by hand) — proves the *scoring* is
   right before automating the *posting*.
3. Snapshot Publisher (IPFS) + On-chain Poster + multi-sig wiring — now the full SHO path is
   automated end-to-end.
4. Social Indexer + SSO's epoch-scheduled trigger, reusing the same downstream engine/
   publisher/poster from step 3 — SSO should be materially cheaper to add than SHO was,
   since only the top of the pipeline is new.
5. Monitoring/alerting (§4.8) — not a bolt-on at the end despite being listed last here; in
   practice this should be stood up alongside step 1, not after step 4. Listed last only
   because its content (which alerts matter) isn't fully known until the earlier components
   exist to alert on.
