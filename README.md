# Strong Commitment Protocol — Mockup

An interactive frontend prototype and product documentation for **Strong Commitment
Protocol (SCP)**: a mechanism that turns tokens a creator would otherwise burn or
vest-lock into a reward pool that pays out contingently on growth, with the same
permanent-loss downside as a burn if targets are missed.

Two campaign types:

- **SHO — Strong Hold Offering.** Rewards active traders based on net-buy volume
  when a token's market-cap milestones are reached.
- **SSO — Strong Shill Offering.** Rewards social-media shillers based on
  engagement when tracked-keyword posts accumulate score, paid out per epoch.

Built for Robinhood Chain, integrating with the Pons.family launchpad.

## What's in this repo

```
public/index.html          Interactive frontend prototype (React, no build step)
docs/PRD.md                 Product & technical specification
docs/WHITEPAPER.md          Formal mechanism design write-up
docs/BACKEND_ROADMAP.md      Engineering roadmap for building the real backend
docs/KEEPER_SERVICE_DESIGN.md  Stage 1 keeper service technical design
contracts/                  Smart contracts (SHO/SSO factories and campaigns, Registry)
keeper/                      Keeper service (Stage 1) — see keeper/README.md for current status
registration-service/        Registration Service (Stage 0's last item) — see its README.md
api/                         Read/aggregation API layer (Stage 2) — see api/README.md
firebase.json               Firebase Hosting config
.firebaserc                 Firebase project binding (set your project ID here)
```

## The frontend

`public/index.html` is a self-contained single-page app: React and ReactDOM are
loaded from a CDN, Babel is vendored locally (`public/vendor/`, alongside a
vendored copy of ethers so wallet/contract calls don't depend on a third CDN),
and JSX is compiled in the browser, so there is no build step. It covers the
full flow — landing page, SHO and SSO discovery, campaign detail and creation,
registration, and a user dashboard — and is wired to real infrastructure, not
mock data: campaign/token/leaderboard reads come from `api/`, wallet connect
and `createCampaign()`/`claim()` submissions go through an injected wallet
(e.g. MetaMask) straight to the contracts on Robinhood Chain Testnet, and X
registration redirects through `registration-service`'s real OAuth flow before
submitting `Registry.registerHandle(...)` on-chain. See `public/index.html`'s
own `SCP_CONFIG` block for the addresses/URLs this points at, and each
package's own README for what's actually been verified end-to-end versus still
pending a live round-trip.

To preview it locally, just open the file in a browser, or serve the `public`
directory with any static file server. `api/` and (for SSO registration)
`registration-service/` need to be running for it to show live data instead of
per-page "couldn't load" states.

## Trying the full platform end to end

This walks through running every piece against the real Robinhood Chain Testnet
deployment (`contracts/deployments/46630.json`) from your own machine. Needs a
normal-network environment — a heavily locked-down sandbox that blocks the RPC
endpoint, X's API, and Lighthouse's IPFS endpoint can run the unit tests but
can't complete this walkthrough.

### 0. One-time setup

```bash
git clone https://github.com/whobotsai/scp-mockup.git && cd scp-mockup
for d in contracts keeper api registration-service; do (cd $d && npm install); done
```

Fund a wallet from the testnet faucet: https://faucet.testnet.chain.robinhood.com/add-chain

Copy each `.env.example` to `.env` (`contracts/`, `keeper/`, `api/`, `registration-service/`)
and fill in your keys. **The contracts are already deployed — you don't need to run
`deploy.js`.** Reuse the addresses in `contracts/deployments/46630.json`:

```
SHOFactory: 0x257F835b1066c064e9e9896c31556034f8Eee8c9
SSOFactory: 0x3770ae529595D0994297C35F7b75CEAD612749aa
Registry:   0xc2ed3d2b8CCa32B8cBC6F6a99D538129c1430065
```

`owner`/`treasury`/`keeper`/`attestor` on that deployment are all still the
deployer's own address (a Stage 0 placeholder) — using the same private key for
`DEPLOYER_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `CLAIMANT_PRIVATE_KEY`, and
`ATTESTOR_PRIVATE_KEY` avoids needing `contracts/scripts/set-attestor.js` to
rotate anything.

**The single most common way to break every service here:** `RPC_URL` must be
the *exact same, complete* URL (with `https://` scheme and the `/rpc` path) in
`contracts/.env`, `keeper/.env`, and `api/.env`. A bare domain with no scheme
(e.g. `rpc.testnet.chain.robinhood.com/`) fails with ethers' `JsonRpcProvider
failed to detect network` / `unsupported protocol` errors, which say nothing
about `.env` being the cause. Sanity-check it once, directly:

```bash
curl -s -X POST "https://rpc.testnet.chain.robinhood.com/rpc" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# expect {"jsonrpc":"2.0","id":1,"result":"0xb626"} -- 0xb626 = 46630
```

### 1. Infra

```bash
cd keeper && docker compose up -d && npm run migrate && cd ..                 # Postgres on :5432
cd registration-service && docker compose up -d && npm run migrate && cd ..   # Postgres on :5433
```

### 2. Activate the backend (one terminal per service, keep all three running)

**Terminal 1 — keeper** (chain indexer, TWAP/epoch engine, auto root-posting):
```bash
cd keeper
npm start
```
Expect `Keeper (Stage 1, steps 1-4) starting. Polling every 15000ms.` with no
repeating `JsonRpcProvider failed to detect network` after it — that error
means `RPC_URL` is still wrong (see step 0).

**Terminal 2 — api** (read/aggregation layer the frontend actually talks to):
```bash
cd api
npm start
```
Expect `API listening on :3001`. Sanity-check it before touching the frontend:
```bash
curl -s http://localhost:3001/health          # {"ok":true}
curl -s http://localhost:3001/sho/campaigns   # real campaigns, or {"campaigns":[]}
```

**Terminal 3 — registration-service** (X OAuth + attestation, only needed for SSO):
```bash
cd registration-service
npm start
```
Expect `Registration Service listening on :3002`. Requires `X_CLIENT_ID` /
`X_CLIENT_SECRET` in its `.env` (see "Setting up an X Developer App" in
`registration-service/README.md`) — it fails fast and exits without them.

### 3. Connect and use the frontend

Open the deployed frontend (`https://commitment-protocol.web.app`, or serve
`public/` locally) in a real browser with MetaMask installed —
`public/index.html`'s `SCP_CONFIG` defaults to `localhost:3001`/`localhost:3002`,
so it talks straight to the three services you just started.

**Connect Wallet** (top right, needed for both SHO and SSO) — click it, approve
the MetaMask popup. If your wallet isn't already on Robinhood Chain Testnet,
the page prompts to add/switch to it automatically (chain ID `46630`) rather
than needing it configured by hand first.

**SHO — Strong Hold Offering:**
1. **Create** (`#/sho/create`): pick a token, lock amount, reward denomination
   (campaign token or ETH — USDC is disabled until `SCP_CONFIG.USDC_ADDRESS`
   points at a real deployed stablecoin), leaderboard window/size, campaign
   duration, and milestone tiers (must sum to 100%). Review, then sign the
   `approve` (if paying in an ERC20) and `createCampaign` transactions.
2. **Discover** (`#/sho`): browse active campaigns. A campaign you *just*
   created may not appear immediately — see the indexer-lag note in
   Troubleshooting below.
3. **Detail page**: live leaderboard (net-buy volume), milestone progress bar
   against the token's TWAP mcap, and — once connected — your own rank.
4. **Claim**: once a milestone is reached and its 24h challenge window has
   elapsed, the Claim button activates for eligible wallets and submits
   `claim()` with a Merkle proof fetched from the api.

**SSO — Strong Shill Offering:**
1. **Register** (`#/register`, one-time per wallet): Connect Wallet, then
   Connect X — this redirects through `registration-service`'s real OAuth
   flow and back to `#/link-x`, which submits `Registry.registerHandle(...)`
   on-chain to finish linking your handle.
2. **Create** (`#/sso/create`): pick a token, lock amount, reward
   denomination, the tracked keyword (immutable once created), epoch length,
   leaderboard size, and campaign duration. Same approve + createCampaign
   transaction pattern as SHO, against `SSOFactory` instead.
3. **Discover** (`#/sso`) and **detail page**: same shape as SHO, scored by
   post engagement instead of net-buy volume — you'll only see real numbers
   here once posts using the campaign's keyword have actually been indexed
   from X.
4. **Claim**: identical mechanics to SHO once an epoch closes and its
   challenge window elapses.

### Troubleshooting

- **`EADDRINUSE :::3001` (or :3002) on `npm start`** — a previous run of that
  service is still alive. `lsof -ti:3001 | xargs kill -9`, then start again.
- **A campaign you just created doesn't show up in Discover** — this isn't a
  bug, it's the indexer's backfill rate limit: free-tier RPC caps `eth_getLogs`
  at a 10-block range (`GET_LOGS_MAX_BLOCK_RANGE` in `keeper/.env`), so if the
  indexer's cursor is far behind the chain head it can take a long time to
  crawl forward and notice a brand-new campaign. Skip the wait — seed it
  directly from the transaction that created it:
  ```bash
  cd keeper
  npm run seed-known-campaign -- <txHash>        # SHO (SHOFactory)
  npm run seed-known-sso-campaign -- <txHash>    # SSO (SSOFactory)
  ```
  Check which one you need by comparing the transaction's `to` address against
  `SHOFactory`/`SSOFactory` above (in MetaMask's Activity tab, or by fetching
  the receipt: `eth_getTransactionReceipt` via the same `curl` pattern as
  step 0). Either script also fast-forwards the cursor to the current chain
  head, so *subsequent* campaigns get picked up by ordinary polling without
  needing to be seeded again.
- **`No CampaignCreated event found in that transaction's logs`** from either
  seed script — the tx hash you gave it isn't actually a `createCampaign` call
  (commonly the `approve()` transaction that precedes it, when paying the
  protocol fee in an ERC20 rather than ETH). Find the transaction whose `to`
  address is the factory itself and use that hash instead.

## Deploying

```bash
npm install -g firebase-tools
firebase login
firebase projects:create        # or use an existing project
```

Set your project ID in `.firebaserc`, then:

```bash
firebase deploy --only hosting
```

That gives a live URL at `https://<project-id>.web.app`. To use a custom
domain: Firebase Console → Hosting → **Add custom domain**, then follow the DNS
verification steps (SSL is provisioned automatically).

Routing in the app is client-side (URL hash, e.g. `#/sho`), so a single
`index.html` serves every route — no server-side rewrites are needed.

## Status

Contracts deployed to Robinhood Chain Testnet, keeper and API layer running
against them, frontend wired to both plus real wallet/OAuth flows. SHO and SSO
campaign creation, X registration, and Discover/detail reads have all been
run live end to end from a normal-network machine following "Trying the full
platform end to end" above -- see `docs/BACKEND_ROADMAP.md` for exactly what
stage each piece is at. Still open: a live IPFS publish, and a milestone/epoch
reward actually claimed from a campaign created this way (as opposed to the
earlier test campaigns already marked `claimed` in `contracts/deployments/
46630.json`'s factories). A few platform-wide figures on the landing page
(total reward pool / distributed rewards) are still illustrative placeholders
-- everything else is live.
