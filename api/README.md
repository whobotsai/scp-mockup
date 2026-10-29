# API Layer — Stage 2

The read/aggregation layer [`../docs/BACKEND_ROADMAP.md`](../docs/BACKEND_ROADMAP.md)'s Stage 2
calls for: a thin service in front of the keeper's Postgres and direct contract reads,
replacing the frontend prototype's hand-authored mock arrays (`SHO_CAMPAIGNS`,
`SSO_CAMPAIGNS`, `TOKEN_REGISTRY`, `MY_SHO_POSITIONS`/`MY_SSO_POSITIONS`, `MY_CREATED_*`,
`CLAIM_HISTORY`) with real data. **Never a second source of truth** — everything this returns
is reconstructable from chain history plus the keeper's own indexed state; this service holds
no state of its own beyond an ethers provider and a read-only Postgres connection.

```
src/
  db.js          Read-only Postgres queries against the keeper's own database
  abis.js        Minimal ABI fragments — duplicated from keeper/src/abis/*.js, see its own header
  solanaAbis.js  Hand-written Borsh decoders for sho_solana/sso_solana — duplicated from
                 keeper/src/abis/solana.js, see "Solana support" below
  shared.js      Merkle tree + TWAP, ported (not reimplemented) from keeper/src/merkleTree.js
                 and twapOracle.js — see its own header for why this one can't be approximate
  provider.js    ethers provider with a request-appropriate RPC timeout
  solanaProvider.js  Optional Solana Connection, see "Solana support" below
  shoRoutes.js   GET /sho/campaigns, /sho/campaigns/:address, /sho/campaigns/:address/leaderboard
  ssoRoutes.js   Same shape for SSO
  tokenRoutes.js GET /tokens/:address
  walletRoutes.js GET /wallets/:address/standings, /claims, /created
  claimRoutes.js GET /campaigns/:address/claim-proof — the one endpoint an actual claim() call
                 depends on
  server.js      Entry point: wires every router onto one Express app
```

## Why some logic is duplicated, and some isn't

- **`shared.js`'s Merkle tree** is a direct port of `keeper/src/merkleTree.js` (itself a port
  of `contracts/test/helpers/merkle.js`) — this has to produce byte-identical hashes to what
  the keeper actually posted on-chain, or a claim proof this API hands back would fail
  `claim()`'s `ClaimVerifier.verify` check. Not optional to approximate.
- **`shared.js`'s TWAP** is likewise ported, purely so a campaign's displayed market cap
  matches what the keeper actually used to decide a milestone crossing — a UI showing a
  different number than what fired the milestone would just confuse people, even though
  nothing here computes anything that gets posted on-chain.
- **`db.js`'s leaderboard queries** (`shoLeaderboard`/`ssoLeaderboard`), by contrast, are
  written directly in SQL rather than porting `volumeAggregator.js`/`socialScoreAggregator.js`
  a second time. This is deliberate and safe specifically because these are *display-only,
  live, mutable* previews of an *open* milestone/epoch — never the source of a claim. The
  actual claim amount always comes from the immutable snapshot the keeper already computed
  and posted (`claimRoutes.js`), never from a live re-aggregation.

## Real gaps, not invented data

The frontend prototype's mock data included fields with no on-chain or keeper-indexed source
at all: `creatorType` (Dev/Holder — a cosmetic UI-only distinction never modeled in the
contracts or PRD), and a token's `website`/`twitter`/`holders`. Rather than invent plausible-
looking values for these, the relevant endpoints return `null` — an honest gap for frontend
integration to design around (e.g. a creator-supplied profile field at campaign creation),
not something this read layer should decide unilaterally.

This API also surfaces a real on-chain state the original frontend mock never modeled: a
milestone/epoch that's `reached`/`finalized` but still inside its 24h challenge window. The
mock's status set (`pending`/`active`/`claimable`/`claimed`) had no slot for this — the API
adds `challenge_window` rather than folding it into `claimable`, since claiming during that
window would revert on-chain anyway.

## Solana support: read path + claiming, nothing deployed yet

`shoRoutes.js`/`ssoRoutes.js` now dispatch each campaign row by `row.network` ('evm' |
'solana', set by `keeper/src/solanaCampaignIndexer.js`). A Solana row's summary comes from
decoding its Campaign PDA directly (`solanaAbis.js`), not a contract call — Solana has no
"view function" distinct from reading account data. Every response now carries a `network`
field so the frontend can tell which chain a campaign lives on.

`claimRoutes.js`'s `/campaigns/:address/claim-proof` endpoint now serves Solana SHO rows too
(dispatched by the campaign row's own `network`), rebuilding the proof with
`solanaMerkleTree.js` (a direct port of `keeper/src/solanaMerkleTree.js` — see that module's
header on why its leaf encoding differs from the EVM tree's). A Solana wallet is matched by
exact (case-sensitive) string equality against a snapshot entry's `account`, not
`toLowerCase()` the way an EVM address is — base58 is case-sensitive, so lower-casing would
silently never match a real wallet.

A Solana SHO row's `mcap` and leaderboard (`topLeaderboard` / `GET .../leaderboard`) are now
real for Solana too: `solanaTokenTwapMcap()` reads the same `sho_price_samples` table
`solanaPriceSampler.js` writes into (chain-agnostic `timeWeightedAveragePrice` math, same as
EVM) plus the tracked mint's on-chain supply (`solanaAbis.js::decodeMint`); `solanaLeaderboard()`
calls the new `solanaTraderIndexer.js` (a direct port of `keeper/src/solanaTraderIndexer.js`,
Birdeye-based — see that module's header) instead of `db.shoLeaderboard`, which only ever
queried `sho_trades` (a table nothing writes Solana rows into). Both need
`BIRDEYE_API_KEY`/`SOLANA_RPC_URL` configured on this API instance — unset means `mcap`
stays `null`/the leaderboard stays empty, same "optional, stays off without it" posture as
every other env-gated piece of this project, not a crash.

**Remaining real gaps on the Solana side**: `name`/`token` (symbol) are still `null` for a
mint with no Metaplex metadata account (not a bug — a genuinely unminted field, same honest
"not invented" posture as everywhere else in this API). SSO has no Solana leaderboard
equivalent at all — blocked on a separate, bigger gap (no Solana Registry program exists for
wallet↔X-handle linking, see `keeper/README.md`), not on anything fixable in this API alone.

A single Solana campaign failing to load (`SOLANA_RPC_URL` unset, or
`contracts-solana/`'s programs — [still undeployed anywhere](../contracts-solana/README.md)
— simply not existing on whatever cluster is configured) is caught per-row and logged, not
surfaced as a 502 for the whole `/sho/campaigns`/`/sso/campaigns` list — see each file's own
`loadSummarySafe`.

**Known accepted risk**: same `@solana/web3.js@1.95.3` / `bigint-buffer` advisory noted in
`keeper/README.md`'s own Solana section — this API only decodes data from the RPC endpoint
you configure in `SOLANA_RPC_URL`, not arbitrary user input.

## Running it

```bash
cp .env.example .env   # DATABASE_URL must point at the same Postgres the keeper writes to
npm install
npm start               # listens on PORT (default 3001)
```

`npm test` runs the ported pure-logic tests (Merkle tree, TWAP, `daysLeft`, plus the Solana
Borsh decoder round-trips — 13 total), no
`.env`/DB/RPC needed. The route handlers themselves aren't unit-tested (they're thin glue over
`db.js` and direct contract reads) — they were validated by hand against a real seeded
Postgres instance and a fake RPC endpoint while building this: every route returns a clean
JSON error (never crashes the process) when a dependency is unreachable, the SHO/SSO
leaderboard SQL was checked against known net-buy/epoch-score arithmetic, and the claim-proof
endpoint was confirmed to both succeed with a genuine root and correctly *refuse* a proof
against a deliberately wrong stored root rather than silently serving one that wouldn't verify
on-chain.

## Known limitations

- **`GET /wallets/:address/standings` and `/claims`** do one contract read per campaign the
  wallet has touched (and, for `/claims`, an extra `queryFilter` per already-claimed entry to
  find its transaction) — fine for a single wallet's own dashboard, not something to call in a
  loop over many wallets. A future iteration could have the keeper index `RewardClaimed`
  events directly instead of this API querying for them live per request.
- **No caching layer.** Every request re-reads Postgres and, for most endpoints, the chain.
  Acceptable for now given this is read-only against already-indexed/cheap state, but a
  frontend hitting `/sho/campaigns` on every render would want a short cache in front of this
  eventually.
- **CORS is wide open** (`cors()` with no options) — fine for a dev/testnet API with no
  cookies or credentials involved; revisit before any production deployment.
