# Keeper Service — Stage 1, build-order step 1

Implements the first slice of [`../docs/KEEPER_SERVICE_DESIGN.md`](../docs/KEEPER_SERVICE_DESIGN.md)'s
suggested build order (§8): Chain Indexer's campaign-discovery half, plus the Volume
Aggregator, exercised against the real testnet SHOFactory from
[`../contracts/deployments/46630.json`](../contracts/deployments/46630.json).

```
src/
  db.js                 Postgres access — campaigns, sho_trades, token_pools, indexer cursors
  campaignIndexer.js    Watches SHOFactory's CampaignCreated, populates `campaigns`
  tradeIndexer.js       Per-campaign trade indexing, wired to tradeSources/uniswapV4.js
  volumeAggregator.js   Net-buy volume per wallet (PRD §2.2) — pure function + DB wrapper
  tradeSources/
    types.js             The normalized TradeEvent shape every adapter produces
    uniswapV4.js          The only wired-in venue adapter right now — see caveats below
    ponsBondingCurve.js   NOT IMPLEMENTED, and deliberately not used for now — see below
  abis/sho.js           Minimal hand-picked ABI fragments (not the full contract interface)
  index.js              Entry point: polling loop wiring the above together
migrations/
  001_init.sql            Postgres schema (subset of the full design doc's data model)
  002_token_pools.sql      Per-token Uniswap V4 pool config
scripts/
  register-token-pool.js  One-off: tell the indexer where a token's real pool lives
```

## Deliberate simplification: Uniswap V4 only, no Pons phase

PRD.md's mechanism has tokens trade on a Pons.family bonding curve before "graduating" to a
Uniswap V4 pool. Pons.family's contract ABI still isn't available to this codebase (see below)
— rather than stay blocked on it, the decision here is to skip that phase entirely for now:
**every token this keeper tracks is assumed to trade directly on a Uniswap V4 pool from
launch.** This is a deliberate, temporary product-mechanism deviation for testing/development,
not a permanent architecture change — revisit it once Pons.family's ABI is actually available,
at which point `tradeSources/ponsBondingCurve.js` can be filled in and wired alongside
`uniswapV4.js` the way the original design intended.

## What actually works right now

- **Campaign discovery**: watching the real deployed `SHOFactory`
  (`0x257F835b1066c064e9e9896c31556034f8Eee8c9`) for `CampaignCreated`, backfilling and then
  polling, writing into `campaigns`. This runs against the actual testnet campaign created by
  `contracts/scripts/test/01-create-campaign.js`.
- **Trade indexing**: for any campaign whose token has a registered pool config (see below),
  `tradeIndexer.js` pulls real swaps from that Uniswap V4 pool and writes them to `sho_trades`.
- **Volume Aggregator**: `computeNetBuyVolume` is a pure function, fully unit-tested
  (`npm test` — 6 tests, no network or DB needed) against the exact rules in PRD §2.2 (net
  sellers excluded entirely, not floored to zero; a wash-traded round trip nets to ~0, not to
  the full round-trip volume).

## Registering a token's Uniswap V4 pool

Once you've launched a real token and created its Uniswap V4 pool, tell the indexer where to
find it:

```bash
npm run register-token-pool -- <tokenAddress> <poolManagerAddress> <poolId> <true|false>
```

- `poolManagerAddress` — the Uniswap V4 `PoolManager` singleton's address on this chain.
- `poolId` — the specific pool's `PoolId` (32-byte hex), as computed/shown by whatever
  interface or SDK you used to create the pool. This tool deliberately does not compute it
  from a `PoolKey` itself — see `tradeSources/uniswapV4.js`'s file header for why.
- last argument — whether your campaigning token is `currency0` in that pool's `PoolKey`
  (`true`/`false`). Getting this backwards silently flips every trade's buy/sell label, so
  double-check it against the pool creation transaction rather than guessing.

This also fast-forwards the trade cursor to the current chain head, same rationale as
`seed-known-campaign.js` below — no need to scan for trades before the pool existed.

A campaign whose token has **no** registered pool config isn't an error — `tradeIndexer.js`
logs `no pool registered yet for token ... — skipping` and moves on; register it whenever the
real pool exists.

## What's still stubbed, and why — the remaining real blocker

**`tradeSources/ponsBondingCurve.js` is not implemented, and (per the simplification above)
not currently used at all.** Pons.family's actual bonding-curve contract ABI/event signatures
aren't available to this codebase — there's no verified interface doc or reference deployment
to check against. Rather than invent one (which would silently corrupt every net-buy-volume
figure computed from it — exactly the kind of bug that turns into a wrong or unfair payout),
this is left as an explicit, loud failure, and simply not wired into `index.js`'s polling loop.

**To unblock this:** Pons.family's bonding-curve contract ABI (or verified source) and a
reference deployment address to confirm event decoding against.

**`tradeSources/uniswapV4.js` is implemented but unverified against a real pool.** It's
written against Uniswap V4 core's publicly documented `Swap` event and delta-sign convention,
not against a transaction this codebase has actually decoded — see the caveats at the top of
that file. It currently treats the counter-asset amount as a direct USD proxy, which only
holds if that asset is a stablecoin — real TWAP-based conversion is build-order step 2 (the
Price/TWAP Oracle), not yet wired in.

## Running it

```bash
docker compose up -d       # local Postgres, matches .env.example's DATABASE_URL
cp .env.example .env       # fill in RPC_URL (an Alchemy endpoint) at minimum
npm install
npm run migrate            # applies migrations/001_init.sql
npm start                  # polls for campaigns + logs volume aggregator output
```

`npm test` runs the Volume Aggregator's unit tests only (no `.env`/DB/RPC needed) — this is
what's actually verifiable without live infrastructure.

### If the first backfill is taking a very long time

A free-tier RPC's `eth_getLogs` block-range cap (`GET_LOGS_MAX_BLOCK_RANGE`, `.env.example`)
means `campaignIndexer.js` makes one request per chunk of that many blocks between
`SHO_FACTORY_DEPLOY_BLOCK` and the current chain head. On a chain producing blocks quickly,
that can be a lot of requests even over a short wall-clock time span — confirmed slow in
practice against this project's own testnet deployment, not just a theoretical concern.

`scripts/seed-known-campaign.js` is the fast-path around this for a specific already-known
transaction (e.g. the one `contracts/scripts/test/01-create-campaign.js` produced): it looks
the transaction up directly (`eth_getTransactionReceipt`, no block-range scan at all), seeds
`campaigns` from its `CampaignCreated` log, then fast-forwards the indexer's cursor to the
current chain head so ordinary polling resumes from "now" instead of from history.

```bash
npm run seed-known-campaign -- <txHash>
```

This is a one-time bootstrap for a known transaction, not a substitute for the real backfill
— any *other* campaign created between the deploy block and whenever this runs would be
missed by this shortcut specifically (though still caught by a from-scratch
`campaignIndexer.js` backfill, just slowly). Fine for unblocking a demo/dev loop; not the
answer for a production deployment, which should either use a paid RPC tier with a wider
`eth_getLogs` range, or a proper log-streaming indexer instead of block-range polling.

## Deliberate deviations from `KEEPER_SERVICE_DESIGN.md`'s suggested stack

- **ethers, not viem.** The design doc suggests viem; this uses `ethers` v6 to stay consistent
  with `../contracts/scripts/deploy.js` and the rest of this project's existing code, rather
  than introducing a second Ethereum library for no functional reason.
- **No BullMQ yet.** This step is a single polling loop, not a job pipeline — queues earn
  their place once there's more than one stage worth decoupling (build-order steps 2+).
