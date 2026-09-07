# Keeper Service — Stage 1, build-order steps 1-2

Implements the first two slices of [`../docs/KEEPER_SERVICE_DESIGN.md`](../docs/KEEPER_SERVICE_DESIGN.md)'s
suggested build order (§8): Chain Indexer (campaign discovery + trade indexing), the Volume
Aggregator, the Price/TWAP Oracle, and the Milestone Engine's crossing detection — exercised
against the real testnet SHOFactory from
[`../contracts/deployments/46630.json`](../contracts/deployments/46630.json). Root *posting*
stays manual (step 2's own scope, see below) — everything upstream of that is automatic.

```
src/
  db.js                 Postgres access — campaigns, sho_trades, token_pools, snapshots, cursors
  campaignIndexer.js    Watches SHOFactory's CampaignCreated, populates `campaigns`
  tradeIndexer.js       Per-campaign trade indexing, dispatches by venue to a trade source
  volumeAggregator.js   Net-buy volume per wallet (PRD §2.2) — pure function + DB wrapper
  priceSampler.js       Samples each pool's instantaneous price into sho_price_samples
  twapOracle.js         Time-weighted average price over a real 30-minute window
  rewardAllocator.js    Proportional reward split for a milestone's leaderboard
  merkleTree.js         Direct port of contracts/test/helpers/merkle.js — see its own header
  milestoneEngine.js    Checks every unreached milestone against the TWAP mcap each tick
  tradeSources/
    types.js             The normalized TradeEvent shape every adapter produces
    uniswapV2.js          Testnet venue — validated against a real deployed pool, see below
    uniswapV4.js          Mainnet venue — implemented, not yet validated, see caveats below
    ponsBondingCurve.js   NOT IMPLEMENTED, and deliberately not used for now — see below
  abis/sho.js           Minimal hand-picked ABI fragments (not the full contract interface)
  index.js              Entry point: polling loop wiring all of the above together
migrations/
  001_init.sql               Postgres schema (subset of the full design doc's data model)
  002_token_pools.sql         Per-token pool config (originally V4-only)
  003_multi_venue_pools.sql   Generalized 002 to carry either venue's config
  004_snapshots.sql           Milestone Engine's frozen leaderboard snapshots
  005_price_samples.sql       Price/TWAP Oracle's raw price samples
scripts/
  register-token-pool.js     One-off: tell the indexer where a token's real pool lives
  fast-forward-cursor.js     One-off: skip a cursor past a backfill gap that's too slow to catch up
  post-milestone-root.js     Posts a computed snapshot on-chain — the manual half of step 2
  claim-milestone.js         Claims a wallet's share of an already-posted milestone reward
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
  (`merkleTree.js`), and stores it in `snapshots` — then prints the `post-milestone-root`
  command to actually post it, which stays a manual step (see below). 27 unit tests across
  the pure-logic pieces (TWAP weighting, proportional allocation, Merkle proof
  self-consistency), all passing without needing live infrastructure. **Validated live**: the
  tracked test campaign's TWAP market cap crossed its $100K milestone after a real 30-minute
  keeper runtime, a snapshot was computed and stored, and `post-milestone-root.js` posted the
  root on-chain successfully.

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

`npm test` runs every pure-logic unit test (27 total, no `.env`/DB/RPC needed) — this is what's
actually verifiable without live infrastructure.

To set up a full test loop yourself (token, pool, campaign, trade), see
`../contracts/README.md`'s "Deploying a test token + pool" section. Once a milestone crosses
(after the ~30-minute wait above), post it on-chain:

```bash
npm run post-milestone-root -- <campaignAddress> <milestoneIndex>
```

This needs `KEEPER_PRIVATE_KEY` in `.env` — the wallet SHOFactory's `keeper()` points at (see
`.env.example`'s comment; currently the Stage 0 deployer placeholder).

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
npm run seed-known-campaign -- <txHash>

# Fast-forward any cursor straight to the current chain head
npm run fast-forward-cursor -- campaign_indexer
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
