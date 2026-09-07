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
against them, frontend wired to both plus real wallet/OAuth flows -- see
`docs/BACKEND_ROADMAP.md` for exactly what stage each piece is at and what's
still unverified (a live IPFS publish, a completed X OAuth round-trip, and an
actually-submitted on-chain transaction from the UI all need a normal-network
environment this sandbox doesn't have). A few platform-wide figures on the
landing page (total reward pool / distributed rewards) are still illustrative
placeholders -- everything else is live.
