# Keeper Service — Stage 1, build-order steps 1-4

Implements the first four slices of [`../docs/KEEPER_SERVICE_DESIGN.md`](../docs/KEEPER_SERVICE_DESIGN.md)'s
suggested build order (§8): the SHO Chain Indexer (campaign discovery + trade indexing), the
Volume Aggregator, the Price/TWAP Oracle, the Milestone Engine, the SSO Social Indexer
(campaign discovery + post indexing + registration indexing) and Epoch Engine, the Snapshot
Publisher, and the On-chain Poster — exercised against the real testnet deployments in
[`../contracts/deployments/46630.json`](../contracts/deployments/46630.json). Root posting is
automatic for both campaign types (one deliberate simplification, see below) — the whole path
from "a milestone crosses / an epoch's window closes" to "the root is on-chain" runs without a
human in the loop, for SHO and SSO alike.

```
src/
  db.js                    Postgres access — campaigns, sho_trades, sso_posts, token_pools,
                           handle_registrations, snapshots, root_submissions, cursors
  campaignIndexer.js       Watches SHOFactory's CampaignCreated, populates `campaigns`
  tradeIndexer.js          Per-campaign trade indexing, dispatches by venue to a trade source
  volumeAggregator.js      Net-buy volume per wallet (PRD §2.2) — pure function + DB wrapper
  priceSampler.js          Samples each pool's instantaneous price into sho_price_samples
  twapOracle.js            Time-weighted average price over a real 30-minute window
  milestoneEngine.js       Checks every unreached SHO milestone against the TWAP mcap each tick
  ssoCampaignIndexer.js    Watches SSOFactory's CampaignCreated, populates `campaigns`
  registrationIndexer.js   Watches Registry's HandleRegistered, populates `handle_registrations`
  socialIndexer.js         Polls X for posts matching an SSO campaign's keyword, see below
  socialScoreAggregator.js Per-account epoch score, best-5-posts cap (PRD §12.2) — pure + DB wrapper
  epochEngine.js           Checks every unfinalized SSO epoch's endsAt against wall-clock time
  rewardAllocator.js       Proportional reward split for a milestone/epoch leaderboard — shared
  merkleTree.js            Direct port of contracts/test/helpers/merkle.js — see its own header
  snapshotPublisher.js     Pins a computed snapshot to IPFS (Lighthouse.storage), see below
  onchainPoster.js         Posts a published snapshot's root on-chain (SHO or SSO), see below
  alerts.js                Missed-root alert — logs loudly if a crossing/close goes too long unposted
  tradeSources/
    types.js             The normalized TradeEvent shape every adapter produces
    uniswapV2.js          Testnet venue — validated against a real deployed pool, see below
    uniswapV4.js          Mainnet venue — implemented, not yet validated, see caveats below
    ponsBondingCurve.js   NOT IMPLEMENTED, and deliberately not used for now — see below
  abis/sho.js           Minimal hand-picked SHO ABI fragments (not the full contract interface)
  abis/sso.js           Same, for SSOFactory/SSOCampaign/Registry
  index.js              Entry point: polling loop wiring all of the above together
migrations/
  001_init.sql               Postgres schema (subset of the full design doc's data model)
  002_token_pools.sql         Per-token pool config (originally V4-only)
  003_multi_venue_pools.sql   Generalized 002 to carry either venue's config
  004_snapshots.sql           Milestone/Epoch Engine's frozen leaderboard snapshots
  005_price_samples.sql       Price/TWAP Oracle's raw price samples
  006_root_submissions.sql    On-chain Poster's proposed/confirmed/failed tracking table
  007_sso.sql                 SSO's campaigns columns, sso_posts, handle_registrations
scripts/
  register-token-pool.js     One-off: tell the indexer where a token's real pool lives
  fast-forward-cursor.js     One-off: skip a cursor past a backfill gap that's too slow to catch up
  post-milestone-root.js     Manual SHO override/backfill — normally onchainPoster.js does this
  claim-milestone.js         Claims a wallet's share of an already-posted milestone/epoch reward
```

## Deliberate simplification: no Pons phase, self-deployed AMM on testnet

PRD.md's mechanism has tokens trade on a Pons.family bonding curve before "graduating" to a
Uniswap V4 pool. Pons.family's contract ABI still isn't available to this codebase (see
below) — rather than stay blocked on it, every token this keeper tracks is assumed to trade
directly on an AMM pool from launch, no bonding-curve phase. Revisit once Pons.family's ABI
is actually available, at which point `tradeSources/ponsBondingCurve.js` gets filled in and
wired alongside the AMM adapters, the way the original design intended.

Which AMM depends on the network: **Uniswap V4 is confirmed not deployed on Robinhood Chain
Testnet at all** (mainnet only, `0x8366a39cc670b4001a1121b8f6a443a643e40951` — confirmed in
practice, not assumed), so testnet indexing uses a self-deployed Uniswap-V2-style pool
(`contracts/src/mocks/UniswapV2Factory.sol`/`UniswapV2Pair.sol`) instead. The V4 adapter
stays in the codebase, unused for now, ready for whenever mainnet is in scope.

## What actually works right now

- **Campaign discovery**: watching the real deployed `SHOFactory`
  (`0x257F835b1066c064e9e9896c31556034f8Eee8c9`) for `CampaignCreated`, backfilling and then
  polling, writing into `campaigns`.
- **Trade indexing + Volume Aggregator, validated end-to-end with real data**: a real
  `MockERC20` test token, a real self-deployed Uniswap V2 pool
  (`contracts/scripts/setup-test-pool.js`), a real SHO campaign pointed at that token
  (`contracts/scripts/create-campaign-with-token.js`), and two real swaps
  (`contracts/scripts/test-swap.js`) — one sell, one buy — produced exactly the expected
  output: the sell was correctly excluded (net sellers aren't floored to zero, PRD §2.2), and
  after the buy the wallet appeared with the exact predicted net-buy figure
  (`$40.13` — a $50 buy net of a prior $9.87 sell, both computed from the swaps' actual
  on-chain amounts). Confirms the whole pipeline — indexing, buy/sell classification, USD-proxy
  valuation, aggregation — is correct against real transactions, not just the offline unit
  tests (12 of them, still passing, still exercised without needing live infrastructure).
- **`tradeSources/uniswapV2.js`** is the venue actually proven above. It uses the
  transaction's own `from` (not the `Swap` event's `sender`, which would be a router's
  address in real-world usage) to correctly attribute trades to the real trader.
- **Price/TWAP Oracle + Milestone Engine's crossing detection** (build-order step 2):
  `priceSampler.js` samples each registered pool's price every tick; `twapOracle.js` computes
  a genuine time-weighted average (not a naive mean) over the trailing 30 minutes;
  `milestoneEngine.js` checks every one of a campaign's unreached milestones (PRD §2.3: tiers
  unlock independently, not sequentially, so all of them are checked every tick) against
  `twapPrice × live totalSupply()`. A crossing freezes a leaderboard snapshot
  (`volumeAggregator.js`), allocates the milestone's reward proportionally
  (`rewardAllocator.js`, exact BigInt math, no floating-point dust), builds the Merkle tree
  (`merkleTree.js`), and stores it in `snapshots`. 27 unit tests across the pure-logic pieces
  (TWAP weighting, proportional allocation, Merkle proof self-consistency), all passing
  without needing live infrastructure. **Validated live**: the tracked test campaign's TWAP
  market cap crossed its $100K milestone after a real 30-minute keeper runtime and a snapshot
  was computed and stored.
- **Snapshot Publisher + On-chain Poster** (build-order step 3): `snapshotPublisher.js` pins
  every computed snapshot's full leaderboard to IPFS via Lighthouse.storage (needs
  `LIGHTHOUSE_API_KEY`, see below — skips publishing, logged not errored, without one) so
  anyone can independently recompute the root during the challenge window. Publishing isn't
  latency-sensitive (nothing needs the CID within seconds, only before anyone would actually
  challenge a root), so it's throttled to its own cadence — `SNAPSHOT_PUBLISH_INTERVAL_MS`,
  2 hours by default — instead of attempting an upload every `POLL_INTERVAL_MS` tick.
  `onchainPoster.js` then posts any published snapshot's root on-chain automatically, tracked in
  `root_submissions` for the same idempotency guarantee `sho_trades`/`campaigns` already have
  (a crashed run resumes from that table's state instead of re-proposing a duplicate
  transaction). `alerts.js`'s missed-root check logs loudly if a crossing goes unposted past a
  1-hour SLA. **Deliberate simplification**: this signs with a single `KEEPER_PRIVATE_KEY` EOA
  instead of the design doc's 3-of-5 Gnosis Safe multi-sig — a real Safe needs 5 real signer
  keys and its own deployment, out of scope for this solo dev/testnet pass. `root_submissions`
  tracks proposed/confirmed exactly as the multi-sig flow would, so swapping in a real Safe
  later changes *how* a root gets signed, not the tracking model around it — revisit before
  any campaign with real funds goes live. `scripts/post-milestone-root.js` still exists as a
  manual override/backfill, now with a safety check refusing to re-post an already-`reached`
  milestone (which would otherwise hit the contract's *correction* path and silently reset an
  open challenge window). **Validated live**: restarting the keeper against a milestone already
  posted by hand correctly logged `already reached on-chain -- backfilled bookkeeping, no
  transaction sent`, with no false missed-root alert (an earlier version of this check was
  gated behind a successful IPFS publish and got that exact case wrong -- fixed by decoupling
  the two entirely).
- **Social Indexer + Epoch Engine** (build-order step 4, SSO): `ssoCampaignIndexer.js` and
  `registrationIndexer.js` watch `SSOFactory.CampaignCreated` and `Registry.HandleRegistered`
  respectively, the same backfill/cursor/progress-logging pattern as the SHO indexers.
  `socialIndexer.js` polls X for posts matching each open campaign's keyword within its
  currently-open epoch, resolves each poster's wallet via the indexed registration table,
  applies PRD §12.5's account-age/follower gates, and stores every qualifying post.
  `socialScoreAggregator.js` sums each account's best 5 posts per epoch (PRD §12.2) into the
  same `[{wallet, score}]` shape `volumeAggregator.js` produces for SHO — `rewardAllocator.js`
  and `merkleTree.js` are reused completely unmodified for SSO, exactly as
  KEEPER_SERVICE_DESIGN.md §4.5 intends. `epochEngine.js` checks every unfinalized epoch
  against wall-clock time (no market data at all, PRD §12.3) and computes/stores a snapshot
  once an epoch's window closes. `onchainPoster.js` now dispatches by campaign type — the same
  module posts `postMilestoneRoot` (SHO) or `postEpochRoot` (SSO) automatically. 9 new unit
  tests (14 total across the two new pure-logic modules combined with existing coverage), all
  passing without needing live infrastructure. **Not yet exercised against a live X account**
  -- no `X_BEARER_TOKEN` was available while building this, consistent with
  registration-service's own paused OAuth verification (neither has ever completed a real
  round-trip against X's API). See `socialIndexer.js`'s own header comment for a known X API
  tier limitation (recent-search only covers 7 days, short of a 30-day epoch's full window)
  that isn't a code defect, and revisit alongside that OAuth work during frontend integration.

**IPFS publishing itself is deliberately paused on a network issue, not a code bug.** Every
upload attempt against `node.lighthouse.storage` fails with `UND_ERR_CONNECT_TIMEOUT` at the
raw TCP level, confirmed with `curl` independent of this codebase, while
`https://lighthouse.storage` (the main site) opens normally from the same network -- pointing
at a routing/ISP issue to that one API origin rather than a global outage or a request-shape
bug. Left as a loud, logged failure rather than guessed at further; retry from a different
network once convenient.

**A real constraint, not a shortcut:** a token's TWAP is `null` (not "insufficient but
computed anyway") until there's at least 30 real minutes of price-sample history for it —
same "real time has to actually pass" rule as the 24h challenge window elsewhere in this
project. Register a pool, then leave the keeper running for at least half an hour before
expecting a milestone to ever cross. **A crossing can go quiet on the terminal right after it
happens** — once a milestone's snapshot is stored, every later tick skips it with no log at
all (see `milestoneEngine.js`'s own comment on this), so don't take silence as proof nothing
crossed; try `post-milestone-root.js` (it errors clearly if there's really no snapshot yet) or
check the `snapshots` table directly.

## Registering a token's pool

Once a token has a real pool, tell the indexer where to find it:

```bash
# Uniswap V2 (testnet)
npm run register-token-pool -- <tokenAddress> uniswap_v2 <pairAddress> <true|false>

# Uniswap V4 (mainnet, once in scope)
npm run register-token-pool -- <tokenAddress> uniswap_v4 <poolManagerAddress> <poolId> <true|false>
```

The final argument is always "is the campaigning token the first token in the pair/pool"
(`token0` for V2, `currency0` for V4) — check it against the pool creation transaction rather
than guessing; getting it backwards silently flips every trade's buy/sell label (this exact
failure mode has its own unit test, see `test/uniswapV2.test.js`).

This also fast-forwards the trade cursor to the current chain head — no need to scan for
trades before the pool existed. A campaign whose token has **no** registered pool config
isn't an error — `tradeIndexer.js` logs `no pool registered yet for token ... — skipping` and
moves on.

## What's still stubbed, and why — the remaining real blocker

**`tradeSources/ponsBondingCurve.js` is not implemented, and not currently used at all.**
Pons.family's actual bonding-curve contract ABI/event signatures aren't available to this
codebase — there's no verified interface doc or reference deployment to check against.
Rather than invent one (which would silently corrupt every net-buy-volume figure computed
from it — exactly the kind of bug that turns into a wrong or unfair payout), this is left as
an explicit, loud failure, and simply not wired into `index.js`'s polling loop.

**To unblock this:** Pons.family's bonding-curve contract ABI (or verified source) and a
reference deployment address to confirm event decoding against.

**`tradeSources/uniswapV4.js` is implemented but still unverified against a real pool** —
unlike `uniswapV2.js` above, this one hasn't had a real transaction run through it yet (no
V4 deployment reachable from testnet). It's written against Uniswap V4 core's publicly
documented `Swap` event and delta-sign convention — see the caveats at the top of that file.
`priceSampler.js` also doesn't support it yet (Uniswap V2-only for now) — extending it to V4
once there's a real pool to sample is the same shape of work as `tradeIndexer.js`'s existing
venue dispatch.

**Both venues still treat the counter-asset amount as a direct USD proxy** (in both trade
indexing and price sampling), which only holds if that asset is a stablecoin — a real price
feed for a non-stable counter asset is out of scope for this step.

## Running it

```bash
docker compose up -d       # local Postgres, matches .env.example's DATABASE_URL
cp .env.example .env       # fill in RPC_URL (an Alchemy endpoint) at minimum
npm install
npm run migrate            # applies every migrations/*.sql file
npm start                  # polls for campaigns + trades + logs volume aggregator output
```

`npm test` runs every pure-logic unit test (41 total, no `.env`/DB/RPC needed) — this is what's
actually verifiable without live infrastructure.

For SSO, also set `SSO_FACTORY_ADDRESS`/`SSO_FACTORY_DEPLOY_BLOCK`,
`REGISTRY_ADDRESS`/`REGISTRY_DEPLOY_BLOCK`, and `X_BEARER_TOKEN` (see `.env.example`'s
comments) — all optional, same posture as `KEEPER_PRIVATE_KEY`/`LIGHTHOUSE_API_KEY`. Leaving
any of them unset just keeps the keeper SHO-only, logged rather than errored.

To set up a full test loop yourself (token, pool, campaign, trade), see
`../contracts/README.md`'s "Deploying a test token + pool" section. Once a milestone crosses
(after the ~30-minute wait above), `npm start` now publishes the snapshot to IPFS and posts
its root on-chain automatically, as long as `.env` has:

- `KEEPER_PRIVATE_KEY` — the wallet SHOFactory's `keeper()` points at (see `.env.example`'s
  comment; currently the Stage 0 deployer placeholder). Without it, publishing and the
  missed-root alert still run, but posting is skipped (logged, not an error) — see
  `index.js`'s own log line on startup.
- `LIGHTHOUSE_API_KEY` — without it, publishing is skipped too (also logged, not an error),
  and posting never happens since `onchainPoster.js` only posts snapshots that already have
  an `ipfs_cid`.

`scripts/post-milestone-root.js` still exists for a manual override or to backfill a snapshot
computed before `KEEPER_PRIVATE_KEY`/`LIGHTHOUSE_API_KEY` were set:

```bash
npm run post-milestone-root -- <campaignAddress> <milestoneIndex>
```

Once the 24h challenge window from that post has actually elapsed, an eligible wallet claims
its share directly from the same snapshot (real Merkle proof, not the Stage 0 test walkthrough's
hand-built single-leaf one):

```bash
npm run claim-milestone -- <campaignAddress> <milestoneIndex>
```

This needs `CLAIMANT_PRIVATE_KEY` in `.env` — the wallet actually claiming, i.e. whichever
account is in that milestone's leaderboard (see `.env.example`'s comment). It errors clearly,
without sending a transaction, if the window hasn't elapsed yet, if the wallet isn't in the
snapshot, or if the tree it rebuilds from the stored entries doesn't match the posted root.

### If a backfill is taking a very long time

A free-tier RPC's `eth_getLogs` block-range cap (`GET_LOGS_MAX_BLOCK_RANGE`, `.env.example`)
means the indexer makes one request per chunk of that many blocks. Robinhood Chain Testnet
appears to produce blocks very quickly, so any cursor left behind for a while (the keeper
wasn't running, or a lot of wall-clock time passed during manual testing) can end up needing
a huge number of chunked requests to catch up — confirmed slow in practice, not just a
theoretical concern.

Two fast-path tools sidestep this when there's nothing meaningful to backfill:

```bash
# Seed one already-known campaign-creation transaction directly (no block-range scan at all)
npm run seed-known-campaign -- <txHash>          # SHO
npm run seed-known-sso-campaign -- <txHash>      # SSO

# Fast-forward any cursor straight to the current chain head
npm run fast-forward-cursor -- campaign_indexer
npm run fast-forward-cursor -- sso_campaign_indexer
npm run fast-forward-cursor -- registration_indexer
npm run fast-forward-cursor -- trades:<tokenAddress>
```

Both are one-time bootstraps for a dev/demo loop, not a substitute for the real backfill —
anything that happened in the skipped range is simply not indexed. Fine here; not the answer
for a production deployment, which should either use a paid RPC tier with a wider
`eth_getLogs` range, or a proper log-streaming indexer instead of block-range polling.

## Deliberate deviations from `KEEPER_SERVICE_DESIGN.md`'s suggested stack

- **ethers, not viem.** The design doc suggests viem; this uses `ethers` v6 to stay consistent
  with `../contracts/scripts/deploy.js` and the rest of this project's existing code, rather
  than introducing a second Ethereum library for no functional reason.
- **No BullMQ yet.** This step is a single polling loop, not a job pipeline — queues earn
  their place once there's more than one stage worth decoupling (build-order steps 2+).
