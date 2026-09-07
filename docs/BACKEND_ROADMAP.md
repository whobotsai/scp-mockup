# Backend Engineering Roadmap

This turns the architecture already specified in [`PRD.md`](./PRD.md) (§3–§4, §10, §12) and
[`WHITEPAPER.md`](./WHITEPAPER.md) into a sequenced build plan. It does not re-derive the
mechanism — it assumes the PRD's contract interfaces, economics, and keeper design are the
source of truth, and answers *what gets built in what order, by whom, with what stack, and
what has to be true before moving to the next stage.*

The frontend prototype (`public/index.html`) is feature-complete against this spec on mock
data. Everything below replaces that mock data with the real thing, one workstream at a time,
without ever leaving the frontend unable to run against something.

## Guiding principles

- **Testnet fast, mainnet slow.** Get SHO and SSO working end-to-end on a testnet within the
  first stage, even in a deliberately unhardened form. Real user-facing risk (Phase 1 in
  PRD §7) only starts once real funds are escrowed, so front-load the parts that are cheap to
  get wrong and expensive to skip.
- **The keeper multi-sig is the one trust assumption everything else defers to.** Per PRD §3.2
  and §6, it is explicitly the MVP's single trusted component. Build it, test it, and monitor
  it like the thing that can lose user funds if it misbehaves — before spending effort on
  anything downstream of it.
- **No new backend concept that isn't already in the PRD.** If a workstream below needs
  something the PRD doesn't specify (a claim deadline, a stablecoin-allowlist governance
  process, per-campaign configurable scoring — see PRD §13), that's flagged as a decision to
  make, not something to quietly invent while implementing.
- **The frontend is the acceptance test.** Each stage below ends when `public/index.html`
  (or its eventual real-data successor) can point at that stage's output and behave
  identically to how it behaves today on mock data — same flows, real numbers.

## Workstreams

Five things get built. They have real dependencies on each other (below), but within a stage
they can proceed in parallel if more than one person is working on this.

| # | Workstream | Depends on |
|---|---|---|
| 1 | **Contracts** — `SHOFactory`/`SHOCampaign`, `SSOFactory`/`SSOCampaign`, shared Merkle-claim + fee-treasury libraries (PRD §3.1, §4, §10, §12.3–12.4) | Nothing — can start immediately |
| 2 | **Keeper service** — chain indexer, TWAP oracle, social indexer, leaderboard/milestone/epoch engine, multi-sig poster (PRD §3.2, §12.3) | Contracts' event/function signatures finalized |
| 3 | **Registration service** — X OAuth, `(x_handle, wallet)` linking (PRD §12.3) | Nothing — can start immediately, in parallel with Contracts |
| 4 | **API layer** — the thing the frontend actually talks to: campaign listing, leaderboards, claim-proof generation, profile positions | Contracts deployed to a testnet; Keeper producing real snapshot data |
| 5 | **Frontend integration** — replace `SHO_CAMPAIGNS`/`SSO_CAMPAIGNS`/`MY_*` mock arrays and `useMockUser`'s fake connect with real wallet connect + API calls | API layer's endpoints stable |

## Suggested stack

Concrete enough to start on, not prescriptive beyond that — swap anything below for an
equivalent the team already knows.

- **Contracts**: Solidity, Foundry (fast fuzzing/fork-testing fits the TWAP and Merkle logic
  well). OpenZeppelin for the Merkle-proof and access-control primitives PRD §3.1 already
  assumes.
- **Keeper / indexer**: TypeScript, viem for chain reads/writes, a job queue (BullMQ or
  similar) for the polling + snapshot-build pipeline, Postgres for indexed events and
  published snapshot data before it's pinned to IPFS.
- **Registration service**: same TypeScript stack; standard OAuth 2.0 flow against the X API.
- **API layer**: a thin TypeScript service in front of Postgres + direct contract reads —
  this is a read/aggregation layer, not a source of truth. It should be possible to
  reconstruct everything it returns from on-chain data plus the published snapshot files.
- **Infra**: Robinhood Chain is an Arbitrum Orbit L2 (PRD's chain-ID references), so an
  Arbitrum-compatible RPC provider plus a self-hosted archive node for the keeper's indexer
  (polling third-party RPC for high-frequency swap events at scale gets expensive and rate
  limited fast).

## Stages

### Stage 0 — Foundations (contracts + registration in parallel)

> **Progress: Stage 0 done.** `SHOFactory`/`SHOCampaign`, `SSOFactory`/`SSOCampaign`, and
> `Registry` are written, covered by 33 passing tests against a local simulated chain, and
> deployed to Robinhood Chain Testnet (chainId 46630 — see
> `../contracts/deployments/46630.json`). The exit criteria's manual walkthrough
> (`../contracts/scripts/test/*.js`) has been run for real: a SHO campaign was created,
> its milestone root posted, the 24h challenge window elapsed, and the reward claimed —
> confirmed on-chain, zero contract changes needed. The Registration Service
> (`../registration-service/`) is built — X OAuth 2.0 (PKCE) plus attestation signing, the
> attestation logic unit-tested against the exact digest already proven correct by
> `Registry`'s own test suite. **Deliberately paused here:** verifying the OAuth round-trip
> against X's live API needs a callback URL X will actually accept (it rejects plain
> `http://localhost`, confirmed in practice against a real X Developer App — HTTPS only,
> no bare-localhost exception observed), which means either an HTTPS tunnel (ngrok et al.)
> just for this dev loop, or the real domain Stage 2's frontend integration will already
> need. Decided to wait for the latter rather than fight tunnel setup now — the code and its
> unit tests aren't blocked either way, only the live end-to-end check is. Revisit this
> alongside Stage 2's frontend integration work.

**Contracts workstream:**
- `SHOFactory.sol` / `SHOCampaign.sol` per PRD §4.1–§4.3: `createCampaign`, `postMilestoneRoot`,
  `claim`, the four events, the EIP-1167 clone pattern.
- `SSOFactory.sol` / `SSOCampaign.sol` per PRD §12.4, sharing the Merkle-claim and
  fee-treasury library code with SHO (PRD §12.3 is explicit that this should be shared, not
  duplicated).
- Full unit + fork test suite: milestone/epoch state transitions, the 24h challenge window,
  bps-sums-to-10000 validation, the "no withdraw/sweep for unreached milestones" invariant
  (PRD §4.2 — this is a security-critical *absence* of a function, worth an explicit test
  that no code path allows creator recovery of an unreached milestone's share).
- Deploy to a public testnet. This is the first frontend-visible checkpoint: real contract
  addresses, even with a stubbed keeper.

**Registration workstream (independent, can run alongside):**
- `registerHandle(xHandle, oauthProof)` (PRD §12.4) plus the off-chain OAuth flow and the
  `(x_handle, wallet)` table.

**Exit criteria:** contracts deployed and tested on testnet; a campaign can be created and
manually walked through milestone-reached / claim by hand (no automated keeper yet).

### Stage 1 — Keeper service

> **Design:** see [`KEEPER_SERVICE_DESIGN.md`](./KEEPER_SERVICE_DESIGN.md) for the concrete
> module breakdown, data model, job/queue architecture, and open infra decisions (IPFS
> pinning provider, X API tier, archive node provider, on-call rotation) this stage needs
> before it can actually run.
>
> **Deliberate simplification in progress:** the Chain Indexer skips the Pons.family
> bonding-curve phase below entirely — Pons's contract ABI still isn't available, and rather
> than stay blocked on it, every token this keeper tracks is assumed to launch straight onto
> an AMM pool. On testnet that's a self-deployed Uniswap-V2-style pool
> (`contracts/src/mocks/UniswapV2Factory.sol`/`UniswapV2Pair.sol`) — Uniswap V4 confirmed
> *not* deployed on Robinhood Chain Testnet at all (mainnet only:
> `0x8366a39cc670b4001a1121b8f6a443a643e40951`), so the V4 adapter stays in the codebase
> unused for now, ready for whenever mainnet is in scope. See
> [`../keeper/README.md`](../keeper/README.md) for the full reasoning and how to register a
> token's real pool. Temporary, for testing/development — revisit Pons once its ABI is
> actually available.
>
> **Build-order step 1 validated end-to-end with real data:** a real test token, a real
> self-deployed Uniswap V2 pool, a real SHO campaign, and two real swaps (one sell, one buy)
> produced exactly the predicted net-buy figure after correctly excluding the net-sell trade
> — confirming campaign discovery, trade indexing, buy/sell classification, and volume
> aggregation all work correctly against actual on-chain transactions. See
> `../keeper/README.md`'s "What actually works right now" for the numbers.
>
> **Build-order step 2 validated end-to-end with real data.** The Price/TWAP Oracle (a genuine
> time-weighted average, not a naive mean, over a real 30-minute window) and the Milestone
> Engine's crossing detection (every unreached milestone checked every tick, per PRD §2.3's
> "tiers unlock independently") now run automatically — a crossing freezes a leaderboard
> snapshot, allocates the reward proportionally, and builds the Merkle tree. Root *posting*
> stays manual (this step's own scope, per the design doc's build order) via
> `keeper/scripts/post-milestone-root.js`. 27 unit tests total for the pure-logic pieces.
> Two integration bugs surfaced and were fixed once this ran live for the first time (an ABI
> mismatch against the mock pool's actual `getReserves()` signature, and a missing migration
> for the price-samples table — see `../keeper/README.md`'s git history for both). After a
> real 30-minute keeper runtime with a registered pool, the tracked test campaign's TWAP
> market cap (~$1.08M) crossed its $100K milestone, a leaderboard snapshot was computed and
> stored, and `post-milestone-root.js` posted the root on-chain successfully — the 24h
> challenge window is now running for that milestone. Confirms the full automatic-scoring
> half of this step against real on-chain data, not just the offline unit tests.
>
> **Build-order step 3 built:** the Snapshot Publisher (`snapshotPublisher.js`, pins a
> computed snapshot's full leaderboard to IPFS via Lighthouse.storage — this design doc's own
> resolved provider choice) and the On-chain Poster (`onchainPoster.js`, posts a published
> snapshot's root automatically, tracked in a new `root_submissions` table for the same
> crash-safe idempotency the rest of this pipeline already has) now close the loop — root
> posting is no longer a manual step for the normal path. The missed-root alert (`alerts.js`,
> §4.8's single most safety-critical check) logs loudly if a crossing goes unposted past a
> 1-hour SLA. **Deliberate simplification**: signs with a single `KEEPER_PRIVATE_KEY` EOA
> instead of the design doc's 3-of-5 Gnosis Safe multi-sig — a real Safe needs 5 real signer
> keys and its own deployment, out of scope for this solo dev/testnet validation pass; PRD
> §3.2 names that multi-sig as the MVP's single trusted component specifically because of the
> human-approval step this simplification skips, so this must be revisited before any
> campaign with real funds goes live. A real correctness issue was caught and fixed while
> building this: naively re-posting an already-`reached` milestone (e.g. one a human already
> posted by hand) hits the contract's *correction* path, not a no-op, and would silently reset
> an open challenge window — both the automatic poster and the manual script now check
> on-chain `reached` state first. 29 unit tests total.
>
> **The automatic-posting half is validated live; IPFS publishing is deliberately paused on a
> network issue, not a code bug.** A second real correctness issue surfaced the same way as the
> first: the "already reached, just backfill" check only ran on snapshots that already had an
> `ipfs_cid`, so a snapshot whose IPFS publish kept failing could never get backfilled even
> after a human posted it by hand — the missed-root alert fired forever on a milestone that was
> actually fine. Fixed by decoupling the two: on-chain `reached` state is checked independently
> of publish status now. With that fixed, restarting the keeper against the already-manually-
> posted milestone correctly logged `already reached on-chain -- backfilled bookkeeping, no
> transaction sent` with no false alert — confirming the automatic side of this step end to end.
> The IPFS upload itself has not succeeded even once: every attempt against
> `node.lighthouse.storage` fails with `UND_ERR_CONNECT_TIMEOUT` at the raw TCP level, confirmed
> with `curl` independent of this codebase entirely, while `https://lighthouse.storage` (the
> main site, presumably CDN-fronted with many IPs) opens normally from the same network — this
> points at a routing/ISP issue to that one API origin (an AWS `ap-south-1` address), not a
> code defect or a global outage. Left as an explicit, loud failure (logged, not silently
> swallowed) rather than guessed at further; retry from a different network once convenient.
>
> **Build-order step 4 built: Social Indexer + Epoch Engine (SSO).** `ssoCampaignIndexer.js`
> and `registrationIndexer.js` index `SSOFactory.CampaignCreated` and
> `Registry.HandleRegistered` the same way the SHO indexers already do; `socialIndexer.js`
> polls X for keyword-matching posts within each campaign's currently-open epoch, resolves
> wallets via the indexed registration table, and applies PRD §12.5's account-age/follower
> gates before a post ever counts. `socialScoreAggregator.js` produces the exact same
> `[{wallet, score}]` shape `volumeAggregator.js` already produces for SHO — enough that
> `rewardAllocator.js` and `merkleTree.js` needed zero changes to work for SSO, which is
> exactly what KEEPER_SERVICE_DESIGN.md §4.5 means by "genuinely shared code." `epochEngine.js`
> mirrors `milestoneEngine.js`, checking wall-clock time instead of a TWAP crossing (PRD §12.3:
> SSO doesn't depend on price at all). `onchainPoster.js` now dispatches by campaign factory to
> call `postMilestoneRoot` or `postEpochRoot` automatically — both campaign types share one
> On-chain Poster, Snapshot Publisher, and missed-root alert, unmodified. Along the way,
> `netBuyUsd` was renamed to `score` in `rewardAllocator.js`/`volumeAggregator.js` — a
> deliberate, low-risk rename to the design doc's own generic terminology, not a behavior
> change (all existing tests updated and still passing). 9 new unit tests (41 total across the
> whole keeper). **Not yet exercised against a live X account** — no `X_BEARER_TOKEN` was
> available while building this, the same paused-verification status as
> registration-service's own OAuth flow (neither has ever completed a real round-trip against
> X's API); `socialIndexer.js`'s own header comment also flags a real X API tier limit
> (recent-search only covers 7 days, short of a 30-day epoch) that's a plan/access decision,
> not a code defect. Revisit alongside that OAuth work once frontend integration gives both a
> reason to actually exercise X's live API.

- Chain indexer against the testnet deployment: subscribe to the campaigning token's Pons
  bonding-curve contract and (post-graduation) its Uniswap V4 pool (PRD §3.2).
- Volume aggregator (rolling net-buy volume per wallet, per window) and the 30-minute TWAP
  module for milestone detection.
- Social indexer against the Registration service's table, for SSO epoch scoring.
- Leaderboard & Milestone/Epoch Engine: detect crossings/epoch boundaries, snapshot, build
  the Merkle tree, publish full snapshot data (content-addressed, hash posted on-chain per
  PRD §3.2) so anyone can independently recompute it during the challenge window.
- The keeper multi-sig itself: stand up the 3-of-5 Gnosis Safe (PRD §3.2), wire up
  `postMilestoneRoot`/`postEpochRoot` submission, and — because this is the trust-critical
  path — build monitoring/alerting on it from day one (a missed or malformed root post is a
  production incident, not a bug to notice later).

**Exit criteria:** a testnet SHO and SSO campaign each go through a full real cycle — lock,
organic trading/posting activity, automatic milestone/epoch detection, root posted, challenge
window elapses, claim succeeds — with zero manual steps.

### Stage 2 — API layer + frontend integration

> **API layer built** (`../api/`, see its own README for the full breakdown). Every endpoint
> below is live against real data — the keeper's indexed Postgres state plus direct contract
> reads, never a second source of truth: `GET /sho/campaigns`(`/:address`, `/leaderboard`) and
> the SSO equivalents replace `SHO_CAMPAIGNS`/`SSO_CAMPAIGNS`/the mock `leaderboard()`
> generator; `GET /tokens/:address` replaces `TOKEN_REGISTRY`/`resolveToken` (though Pons.family
> integration itself is still blocked — see `../keeper/README.md` — so this reads the ERC20
> contract and the keeper's own TWAP samples directly instead, with `website`/`twitter`/
> `holders` honestly returned as `null` rather than invented, since neither the contracts nor
> the keeper index anything for them); `GET /wallets/:address/standings`, `/claims`, and
> `/created` replace `MY_SHO_POSITIONS`/`MY_SSO_POSITIONS`/`MY_CREATED_*`/`CLAIM_HISTORY`; and
> `GET /campaigns/:address/claim-proof` is the new endpoint an actual `claim()` transaction
> depends on — not something the mock ever needed since it never submitted real transactions.
> A real design split emerged while building this: leaderboard queries for a still-open
> milestone/epoch are plain SQL (display-only, safe to be a fresh reimplementation since
> nothing here gets posted on-chain), while the claim-proof endpoint's Merkle tree and the
> displayed TWAP mcap are direct ports of the keeper's own logic (`merkleTree.js`/
> `twapOracle.js`) — a claim proof has to byte-match what the keeper actually posted, or
> `claim()` reverts. Validated against a real seeded Postgres instance while building this: the
> SHO/SSO leaderboard SQL was checked against known net-buy/epoch-score arithmetic, and the
> claim-proof endpoint was confirmed to both succeed with a genuine root and correctly *refuse*
> one built against a deliberately wrong stored root, rather than silently handing back a proof
> that wouldn't verify on-chain. Also surfaces a real on-chain state the original frontend mock
> never modeled at all — a milestone/epoch that's reached/finalized but still inside its 24h
> challenge window (`status: "challenge_window"`) — since claiming during that window would
> revert.
>
> **Frontend integration done** (`public/index.html`) — every mock-data seam from the original
> prototype now has a real counterpart. `useWallet` replaces `useMockUser`: `connectWallet`
> goes through `window.ethereum` (EIP-1193 — MetaMask or any compatible injected wallet),
> prompting a network add/switch to Robinhood Chain Testnet if needed; `connectX` redirects to
> `registration-service`'s real `/auth/x/start` OAuth flow, which (with `FRONTEND_URL` set)
> hands the result back to a new `#/link-x` page that submits `Registry.registerHandle(...)`
> itself using the connected wallet — `xhandle` is then read live from `Registry.handleOf`,
> never cached, so it can't drift from what's actually on-chain. Discover/detail pages fetch
> from `../api/` and normalize its responses into the shapes the existing UI already rendered;
> the Create-campaign wizard resolves a token live against `GET /tokens/:address` (replacing
> `resolveToken`/`TOKEN_REGISTRY`) and submits a real `SHOFactory.createCampaign(...)` /
> `SSOFactory.createCampaign(...)` transaction (ERC20 `approve()` first when the reward token
> isn't native ETH), reading the new campaign's address out of the `CampaignCreated` log rather
> than a mock array push; claim buttons on both detail pages and the dashboard fetch a proof
> from `GET /campaigns/:address/claim-proof` and call the campaign's real `claim(...)`. Ethers
> and (for local dev) Babel are vendored into `public/vendor/` rather than pulled from a CDN, so
> wallet/contract calls don't depend on a third-party host being reachable. A couple of honest,
> narrow gaps surfaced doing this rather than being papered over: no USDC is deployed on this
> testnet yet, so the wizard's USDC reward option is disabled until `SCP_CONFIG.USDC_ADDRESS`
> is set; and a token's `website`/`twitter`/`holders`/ATH mcap still show `—` for the same
> reason `../api/` returns `null` for them (see its own README).
>
> **Update: the `registerHandle()` + X OAuth round-trip is now verified live**, from a
> machine with normal network access (not this sandbox) -- a real X login, a real attestation,
> and a real `registerHandle(...)` transaction mined against the live testnet Registry, with
> `Registry.handleOf` reading the handle straight back on the deployed frontend's Profile page
> afterward. `Registry.attestor()` needed rotating first, away from the deploy-time
> placeholder (see `../registration-service/README.md`'s "The attestor key"). Still not
> verified from this sandbox itself (no path to a real chain/OAuth provider here, same caveat
> as `../keeper/README.md`): an actual `createCampaign()`/`claim()` transaction signed and
> mined. Validated everything short of that: the full JSX compiles cleanly (`@babel/preset-react`,
> matching the exact `babel-standalone` version the page loads), and a headless-browser pass
> with a mocked wallet + mocked `../api/` responses exercised every route (Discover, campaign
> detail with live milestone/leaderboard/claim-status rendering, the full 5-step create wizard
> through to its review screen, the dashboard) with no console or render errors, plus a
> without-a-wallet pass confirming every page degrades to a clear loading/error/connect-prompt
> state instead of crashing when the API or a wallet isn't available.

- ~~Build the read/aggregation API~~ — done, see above.
- ~~Swap `useMockUser`'s fake `connectWallet`/`connectX` for a real wallet connector and a real
  OAuth redirect~~ — done, see above.
- ~~Wire the Create-campaign wizard to actually submit `createCampaign()` transactions~~ —
  done, see above.
- Every mock-data seam identified in the audit work on this prototype (`resolveToken`,
  `MY_CREATED_SHO.push`, etc.) has a real counterpart now — this stage's "delete the mock
  data" goal is met.

**Exit criteria:** the existing frontend, pointed at testnet, behaves identically to the old
mock-data build — same screens, same flows, real numbers, real wallet signatures. Met, pending
the live-chain/OAuth verification noted above (deferred the same way Stage 0/1's own live
round-trips were — see those stages' notes — rather than blocking further work on a sandbox
network limitation).

### Stage 3 — Security hardening (PRD §7 Phase 2, security-relevant subset)

- Resolve the open questions in PRD §13 that are blocking for mainnet, at minimum: the
  unclaimed-reward deadline question (SHO and SSO both raise it) and the stablecoin-allowlist
  governance process.
- Third-party smart contract audit (PRD §7 Phase 2, §13 "shared" — vendor/budget still
  undetermined; this stage is where that gets picked).
- Load-test and chaos-test the keeper pipeline specifically: indexer downtime, a delayed or
  contested root, RPC provider failure — the multi-sig is the trust bottleneck, so its
  failure modes need to be exercised before mainnet, not discovered after.
- Legal/regulatory review (PRD §7 Phase 2).

**Exit criteria:** audit findings closed or explicitly accepted; keeper failure modes have a
documented, tested response.

### Stage 4 — Mainnet launch

- Deploy to Robinhood Chain mainnet with the audited contracts.
- Launch with the same MVP constraints the PRD already scopes (PRD §7 Phase 1): no per-wallet
  cap, no sybil clustering yet, USDC as the only stablecoin option, keeper-only root
  correction (not yet permissionless).
- Everything past this point is PRD §7's own Phase 2 (permissionless dispute model, multiple
  independent indexers, per-wallet caps, stablecoin allowlist expansion) and Phase 3
  (additional venues/chains, treasury governance) — this roadmap doesn't restate those since
  the PRD already sequences them; this document exists to get to the point where that
  sequencing is the team's next problem, not smart-contract plumbing.

## Open decisions this roadmap surfaces (not resolves)

Carried over from PRD §13 because they gate specific stages above rather than being abstract:

- Unclaimed-reward deadline and destination — blocks Stage 3 sign-off.
- Stablecoin allowlist governance process — blocks Stage 3 sign-off.
- Audit vendor and budget — blocks the start of Stage 3.
- Claim UX for a milestone/epoch reached but never claimed by its winners — same deadline
  question, needs an answer before Stage 2's claim-proof API is considered final.
