# Mainnet Launch Checklist

Tracks everything still open before Diamond Hand (SHO + SSO) can launch on mainnet, across
both supported networks (EVM and Solana). Pulled together from `docs/BACKEND_ROADMAP.md`'s
existing Stage 3/4 gate, `contracts/README.md`'s own "Open items", and everything built
this session for Solana support (`contracts-solana/`, `keeper/src/solanaCampaignIndexer.js`,
`api/src/solanaAbis.js`, the `CreateWizard` network picker).

Nothing here is checked off speculatively — a box is only ticked if it was actually
verified (built, tested, or deployed), not just written.

## Phase 0 — Already done

- [x] SHO/SSO contracts written and unit-tested on EVM (`contracts/`, 33 tests)
- [x] Deployed to Robinhood Chain **Testnet** (chain id 46630) — not mainnet
- [x] Keeper Stage 1 (steps 1-4): trade indexing, TWAP oracle, milestone/epoch engine,
      snapshot publisher, on-chain poster — validated live against testnet
- [x] API Stage 2 read layer, frontend app + landing pages, deployed to Firebase Hosting
- [x] SHO + SSO ported to Solana (`contracts-solana/`), `cargo check` passing — not built to
      BPF/SBF, not deployed anywhere
- [x] Frontend: network picker (EVM/Solana) + dual wallet connect in `CreateWizard`, with
      real Solana campaign-creation transactions wired (untested against a live wallet)
- [x] Keeper: Solana campaign discovery (`solanaCampaignIndexer.js`)
- [x] API: Solana read path for `/sho/campaigns`, `/sso/campaigns` (`solanaAbis.js`)

## Phase 1 — Solana: get to a working devnet deployment

- [ ] Install `solana-cli` + `anchor-cli` (0.30.1) on a machine with real network access
- [ ] `anchor build` both programs; fix anything `cargo check` couldn't catch (BPF-specific
      compile errors, account-size miscalculations)
- [ ] `anchor keys list`; replace the placeholder `declare_id!()` values in
      `contracts-solana/programs/{sho_solana,sso_solana}/src/lib.rs` and `Anchor.toml`
- [ ] Write `tests/sho.ts` / `tests/sso.ts` (happy-path SOL/SPL campaigns, fee split,
      milestone/epoch reach + challenge-window correction + elapsed-window rejection,
      valid/invalid/double claim, non-keeper rejection, SSO's epoch-not-yet-ended check)
- [ ] `anchor test` against a local validator — first real end-to-end verification this
      code has ever had
- [ ] Deploy to devnet; call `initialize_config` for both programs
- [ ] Update `SCP_CONFIG.SHO_SOLANA_PROGRAM_ID`/`SSO_SOLANA_PROGRAM_ID` (frontend),
      `SOLANA_RPC_URL` + program ids (keeper, API) to point at the real devnet deployment
- [ ] Create a real campaign through the `CreateWizard` against devnet; confirm it shows up
      via the keeper indexer and the API's `/sho/campaigns`
- [ ] Resolve the `bigint-buffer` advisory: upgrade to `@solana/web3.js` v2/v3 (breaking API
      change, touches frontend + keeper + API) or formally accept the risk for launch

## Phase 2 — Solana: backend parity with the EVM side

- [x] Wire Discover/campaign-detail pages to actually render Solana campaigns — `c.network`
      is threaded through the frontend now; explorer links, the claim button, and a "Solana"
      badge all branch on it correctly
- [x] SPL token metadata lookup (name/symbol) — `api/src/solanaAbis.js::fetchSplTokenInfo`
      reads a tracked mint's Metaplex metadata account when it has one, `null` (not invented)
      when it doesn't
- [x] *(found along the way, not originally listed)* Reward-amount decimals were hardcoded
      to 18 everywhere — would have badly misrepresented native SOL (9 decimals). Both APIs
      now return a real `rewardDecimals`, threaded through every frontend display call site
- [x] Choose a Solana mcap/price source — **DexScreener** (public, unauthenticated
      `/latest/dex/tokens/:mint`), picked over indexing a specific AMM's reserves directly
      since Solana has no single dominant venue the way EVM settled on Uniswap
- [x] Solana price/TWAP sampling — `keeper/src/solanaPriceSampler.js`, wired into `tick()`
      for discovered Solana SHO campaigns, reusing `twapOracle.js` as-is (chain-agnostic).
      Auto-registers the pool into `token_pools` on first sample (no manual step, unlike
      EVM's `register-token-pool.js`). Unit-tested only (mocked fetch) — this sandbox's
      egress policy blocks `api.dexscreener.com`, never called against the real API
- [x] Solana trade-attribution source for the SHO net-buy-volume leaderboard — **Birdeye's
      Token - Top Traders API** (`keeper/src/solanaTraderIndexer.js`), not Helius as originally
      planned: Helius only answers "what did wallet X do," not "which wallets traded token Y,"
      so it would've needed its own wallet-discovery step first. Birdeye's endpoint returns
      per-wallet `volumeBuyUSD`/`volumeSellUSD` directly — no raw-transaction indexing needed
      at all for Solana. Unit-tested only (mocked fetch) — this sandbox's egress policy
      blocks `public-api.birdeye.so`, never called against the real API
- [x] Build a Solana on-chain poster (`post_milestone_root` automation, SHO) — signer model:
      a single keypair (`SOLANA_KEEPER_PRIVATE_KEY`), the same deliberate EOA-not-multisig
      simplification `onchainPoster.js` already uses for EVM (see Phase 3 for the eventual
      multisig upgrade on both chains). `keeper/src/solanaMilestoneEngine.js` +
      `solanaMerkleTree.js` (new — Solana's 32-byte-Pubkey leaf encoding differs from
      `merkleTree.js`'s EVM one) + `solanaOnchainPoster.js` give Solana SHO the full
      milestone→snapshot→on-chain-root pipeline; `snapshotPublisher.js`/`alerts.js` needed no
      changes (already chain-agnostic). `post_epoch_root` (SSO) is blocked on a separate gap,
      see below — not on signer model or poster plumbing, which is already shared/ready for it.
      Pure encoding pieces unit-tested; orchestration not (matches
      `milestoneEngine.js`/`onchainPoster.js`'s own untested-orchestration precedent). Never
      run against a live program (`contracts-solana/` still undeployed anywhere)
- [x] **Solana Registry program** (`contracts-solana/programs/registry_solana`, new) — ports
      `Registry.sol`'s wallet↔X-handle linking. Biggest design difference: Solana has no cheap
      on-chain secp256k1 recovery, so instead of verifying a detached ECDSA attestation inside
      the instruction, `register_handle` requires the attestor to **co-sign the same
      transaction** as a second `Signer` — simpler and equally secure, avoids hand-rolling
      Ed25519-sysvar-instruction-introspection byte parsing that `cargo check` can't catch
      mistakes in. **v1 simplification**: a wallet can link a handle exactly once (no
      "switch to a different handle" path like `Registry.sol` has — see `HandleLink`'s own doc
      comment in `state.rs` for why and when to revisit). `cargo check --workspace` passes.
      - `keeper/src/registrySolanaIndexer.js` (new) discovers registrations the same
        `Config.next_id`-counter way campaigns are discovered, writing into the *same*
        `handle_registrations` table EVM already uses — `resolveWalletForHandle` needs zero
        changes to work for a Solana wallet. **This is what actually unblocks a Solana SSO
        epoch engine** — the data gap is closed, independent of the engine itself existing yet.
      - `registration-service/src/solanaAttestation.js` + `server.js` additions (new
        `SOLANA_ATTESTOR_PRIVATE_KEY`, `/auth/x/start?network=solana`, `GET
        /solana-attestor`, `POST /attest/solana`) give the service a working Solana signing
        path — smoke-tested locally (wallet validation, the 503/403 gates), but never run
        through a real X OAuth round-trip or against a deployed program.
      - **Still missing**: a Solana epoch engine (`solanaEpochEngine.js`), a Solana-aware
        `socialIndexer.js`, SSO's half of `solanaOnchainPoster.js`, and the frontend's "link X
        on Solana" UI (no `connectX`-for-Solana, no `register_handle` instruction builder, no
        `LinkXCallback`-for-Solana) — see `registration-service/README.md`'s own Solana
        section and `contracts-solana/README.md`'s "What's NOT done yet" for the complete list.
- [x] Build the `claim_sol`/`claim_spl` claim UI (SHO) — `api/src/claimRoutes.js`'s
      `/campaigns/:address/claim-proof` now dispatches by the campaign row's `network`,
      rebuilding the proof with `api/src/solanaMerkleTree.js` (new, same direct-port
      convention as `shared.js`'s EVM tree) for a Solana row; wallet matching is exact
      (case-sensitive) string equality for base58, not `toLowerCase()` (unlike EVM, base58
      case is significant — a lower-cased comparison would silently never match). Frontend:
      `submitShoClaimSolana()` in `public/index.html` builds and signs the `claim_sol`/
      `claim_spl` instruction (account order/writability mirrors
      `contracts-solana/programs/sho_solana/src/lib.rs`'s `ClaimSol`/`ClaimSpl` structs
      exactly); `SHODetail`'s claim button now calls it for a Solana campaign instead of
      showing "not available yet". No local eligibility pre-check exists for a Solana wallet
      (no standings/claims aggregation endpoint for Solana yet, unlike EVM) — the claim-proof
      API call itself is the real check, its 404 surfaced via the existing notify() path.
      Verified: full Babel syntax check of the frontend script, plus a standalone sanity
      script exercising the actual instruction-building logic against the pinned
      `@solana/web3.js@1.95.3` (byte lengths, account counts, and the Anchor discriminator
      cross-checked against the keeper's own Node-crypto implementation all matched). Never
      run against a live wallet or deployed program.
- [x] *(found along the way, now fixed)* The API's own Solana SHO summary
      (`api/src/shoRoutes.js`) now surfaces real `mcap` (`solanaTokenTwapMcap()`, same
      chain-agnostic TWAP math as EVM, reading the same `sho_price_samples` table
      `solanaPriceSampler.js` already writes into) and a real leaderboard
      (`solanaLeaderboard()`, via new `api/src/solanaTraderIndexer.js` — a direct port of the
      keeper's module, Birdeye-based) in both `GET /sho/campaigns/:address` and
      `.../leaderboard`, instead of a hardcoded `null`/`db.shoLeaderboard` falling through to
      an always-empty EVM-only table. Added `api/src/solanaAbis.js::decodeMint` (supply, not
      just decimals) to support it. Needs `BIRDEYE_API_KEY`/`SOLANA_RPC_URL` configured on
      the API instance — stays `null`/empty without them, same optional posture as elsewhere.

## Phase 3 — Security hardening (both networks) — Stage 3, currently NOT STARTED

- [ ] **Third-party smart-contract audit — EVM.** Vendor/budget still undetermined
      (`contracts/README.md`)
- [ ] **Third-party audit — Solana.** A separate audit: different language, VM, and bug
      classes (PDA validation, CPI signer checks, account reinitialization) than the EVM
      audit covers. Budget for two, not one.
- [ ] **Replace the single `KEEPER_PRIVATE_KEY` EOA** with the PRD's intended 3-of-5 Gnosis
      Safe (EVM) and an equivalent Solana multisig (e.g. Squads) before any campaign with
      real funds goes live on either chain
- [ ] **Enforce a stablecoin allowlist on-chain** — today `rewardToken`/`reward_mint`
      accepts any ERC20/SPL mint, no whitelist, on both chains
- [ ] **Decide the unclaimed-reward policy**: deadline, sweep destination, claim UX for
      funds nobody ever claims — currently locks forever by design, unresolved product
      question on both chains
- [ ] **Fix IPFS snapshot publishing** (`keeper/src/snapshotPublisher.js`) — has never
      succeeded once (`UND_ERR_CONNECT_TIMEOUT` against `node.lighthouse.storage`)
- [ ] Add CI that actually runs the test suites (`contracts/`, `contracts-solana/`,
      `keeper/`, `api/`) on every PR — none of them run in CI today, only the Firebase
      Hosting deploy does
- [ ] Load/chaos-test the keeper pipeline (both chains) under realistic trade volume
- [ ] Rotate every placeholder address (EVM `owner`/`treasury`/`keeper` are all still the
      deployer's own address) to real, access-controlled accounts
- [ ] Confirm OpenZeppelin 5.0.2 pin is still correct for the actual mainnet target chain's
      opcode support (pinned below 5.1+ to avoid `MCOPY`/Cancun — verify before Stage 4)
- [ ] Resolve Pons.family bonding-curve integration, or formally confirm "AMM from launch,
      no bonding-curve phase" is the accepted v1 scope for mainnet
- [ ] `cors()` is wide open in `api/` — fine for testnet, revisit before production

## Phase 4 — Legal / product sign-off

- [ ] Legal/regulatory review (jurisdiction-dependent — a reward-pool mechanism that pays
      out based on trading/social activity needs counsel's sign-off before real funds)
- [ ] Confirm `homepage-sho`/`commitment-protocol` marketing claims match what's actually
      live (no overselling features not yet shipped — e.g. Solana isn't discoverable yet,
      per Phase 2)
- [ ] Incident-response plan: who gets paged on `alerts.js`'s missed-root alert (EVM) and
      its still-nonexistent Solana equivalent (Phase 2)

## Phase 5 — Mainnet deploy

- [ ] EVM: deploy `SHOFactory`/`SSOFactory`/`Registry` to the real target mainnet
      (Robinhood Chain mainnet, chain id 4663 per PRD §7, or wherever final scope lands)
- [ ] Solana: deploy `sho_solana`/`sso_solana` to mainnet-beta
- [ ] Point every `SCP_CONFIG`/`.env` at mainnet addresses, program ids, and RPC endpoints
      (currently every config in this repo points at testnet/devnet/placeholders)
- [ ] Announce — only after every box above this line is checked, not before

---

**How to use this file**: update it in the same commit as the work it tracks, so the
checklist and the code never drift apart. A box gets checked only when its claim is true
right now, not "should be true soon."
