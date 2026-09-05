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
contracts/                  Smart contracts (SHO/SSO factories and campaigns, Registry)
firebase.json               Firebase Hosting config
.firebaserc                 Firebase project binding (set your project ID here)
```

## The prototype

`public/index.html` is a self-contained single-page app: React, ReactDOM, and
Babel are loaded from a CDN and JSX is compiled in the browser, so there is no
build step. It covers the full flow — landing page, SHO and SSO discovery,
campaign detail and creation, registration, and a user dashboard — running
entirely on mock data. There is no backend and no on-chain integration; nothing
here executes real transactions.

To preview it locally, just open the file in a browser, or serve the `public`
directory with any static file server.

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

Prototype and documentation draft. Figures shown in the UI are illustrative
mock data, not live metrics.
