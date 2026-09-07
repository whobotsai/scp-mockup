# Registration Service -- Stage 0's last item

Implements the piece of Stage 0 that wasn't done yet (see `../docs/BACKEND_ROADMAP.md`): X
OAuth 2.0 (PKCE) plus signing the attestation `contracts/src/registry/Registry.sol`'s
`registerHandle()` verifies on-chain (PRD.md section 12.3-12.4). This service never calls
`registerHandle()` itself -- the wallet does that, using the attestation this service hands
back.

```
src/
  attestation.js   Signs (and can independently verify) the ECDSA attestation Registry.sol
                    checks -- the one piece of math this whole service exists to get right
  pkce.js          OAuth 2.0 PKCE helpers (RFC 7636)
  xOAuth.js        X's OAuth 2.0 token exchange + user-info fetch (see its header for caveats)
  sessions.js      Short-lived in-memory store for in-flight OAuth attempts
  db.js            Postgres access -- the registrations audit table
  server.js        Express app: /auth/x/start, /auth/x/callback
migrations/001_init.sql  Postgres schema (one audit table)
```

## What actually works right now

- **Attestation signing + verification**: fully unit-tested (`npm test`, 9 tests, no
  network/DB needed) against the *exact* digest formula already proven correct on-chain by
  `../contracts/test/registry.test.js`'s 4 passing tests -- this service's `signAttestation`
  is line-for-line the same math, not a reimplementation that could have drifted.
- **PKCE helpers**: unit-tested against RFC 7636's length bounds and a manually-computed
  SHA-256/base64url digest.
- **The OAuth flow itself (`/auth/x/start` -> `/auth/x/callback`) has not been run against
  X's real API from this environment** -- this sandbox has no network access to complete an
  interactive OAuth consent flow, let alone reach X's API at all. It needs to be tried from a
  machine with normal network access, with a real X Developer App configured (below).

## Setting up an X Developer App

1. Create an app at [developer.x.com](https://developer.x.com/) (or whatever the current
   developer portal domain is -- naming may have moved since; search "X API developer portal"
   if this link is stale).
2. Under the app's **User authentication settings**, enable **OAuth 2.0**, set the app type to
   **Web App** (confidential client -- this service holds a client secret), and add a callback
   URL matching `X_REDIRECT_URI` exactly (`http://localhost:3002/auth/x/callback` for local
   dev).
3. Copy the **Client ID** and **Client Secret** into `.env` -- handled the same way every
   other credential in this project is: added directly to your own `.env` file, never
   committed to the repo.

**Caveat, stated plainly:** `src/xOAuth.js`'s endpoint hostnames (`x.com`/`api.x.com`) are
this codebase's best understanding of X's current OAuth 2.0 surface, unverified by an actual
completed round-trip (no network access to check from here). They're overridable via
`X_AUTH_URL`/`X_TOKEN_URL`/`X_USERINFO_URL` in `.env` specifically so a wrong default is a
config fix, not a code change, if X's real endpoints differ.

## The attestor key

`ATTESTOR_PRIVATE_KEY` signs every attestation this service issues. Its address must match
`Registry.attestor()` on-chain -- currently set to the deployer's own placeholder address
(see `../contracts/deployments/46630.json`). Generate a real key for this service, then
rotate the contract to match:

```js
// one-off, from a node REPL or a throwaway script -- not part of this service's own code,
// this is a one-time admin action against the already-deployed Registry
const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, provider); // Registry's current owner
const registry = new ethers.Contract(REGISTRY_ADDRESS, ["function setAttestor(address)"], owner);
await registry.setAttestor(ATTESTOR_PUBLIC_ADDRESS);
```

## Running it

```bash
docker compose up -d       # local Postgres on port 5433 (not 5432 -- see docker-compose.yml)
cp .env.example .env       # fill in X_CLIENT_ID, X_CLIENT_SECRET, ATTESTOR_PRIVATE_KEY
npm install
npm run migrate            # applies migrations/001_init.sql
npm start                  # listens on :3002 (../api defaults to :3001 -- see .env.example)
```

To try the flow manually: visit `http://localhost:3002/auth/x/start?wallet=0xYourAddress` in
a browser, approve on X's consent screen, and the callback page shows the wallet, handle, and
attestation -- along with the exact `registerHandle(...)` call to submit from that wallet to
finish linking on-chain. Set `FRONTEND_URL` in `.env` (Stage 2) and this hands off to the
frontend's own `#/link-x` page instead, which submits that `registerHandle(...)` call itself
using the connected wallet -- see `../public/index.html`'s `LinkXCallback`.

`npm test` runs the attestation + PKCE unit tests only (no `.env`/DB/network needed) -- this
is what's actually verifiable without live infrastructure and a real X Developer App.

## Deliberate scope limits

- **No age/follower gating here.** PRD section 12.2 places the account-age->=30-days,
  followers->=25 minimum bar on *what counts as a qualifying post* -- that's the Social
  Indexer's job (Stage 1, once built), evaluated at scoring time, not a registration-time
  gate. Any X account can register a handle; whether its posts ever count toward an SSO
  epoch is decided later, elsewhere.
- **The debug page above still exists** (whenever `FRONTEND_URL` is unset) for manual testing
  without a running frontend. With `FRONTEND_URL` set, `../public/index.html` (Stage 2) is the
  real UI: it redirects here from a connected wallet and finishes the on-chain
  `registerHandle(...)` call itself on return -- see its `LinkXCallback`.
- **ethers, not a different web3 library** -- consistent with `../contracts/` and
  `../keeper/`, same rationale as documented in both of those READMEs.
