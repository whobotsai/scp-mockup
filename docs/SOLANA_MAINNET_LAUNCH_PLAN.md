# Solana Mainnet Launch Plan — target: this week

Scope: **Solana only**. EVM/Robinhood Chain is explicitly deferred to a later phase per
direct instruction — nothing below touches `contracts/`, `keeper`'s EVM paths, or the EVM
half of the frontend; they keep working as-is and just aren't the launch gate.

## Read this first: the honest starting position

Every piece of Solana code in this repo (`contracts-solana/`'s three Anchor programs,
`keeper/src/solana*.js`, `api/src/solana*.js`, `registration-service`'s Solana path,
`public/index.html`'s Solana UI) has been built carefully and cross-checked against the
Rust source line by line — but **none of it has ever touched a real Solana toolchain**. No
`anchor build`, no `anchor test`, no devnet deploy, no live wallet, no live RPC, no live
Birdeye/DexScreener/X API call. That's not a style choice — the sandbox this was built in
has no `solana`/`anchor` CLI and blocks the download. Everything below is sequenced assuming
real bugs surface the moment real toolchain touches this code, because that is the normal,
expected outcome for code at this validation level — not a sign something went wrong.

Two items on this list have a clock outside engineering's control entirely — **start them
today, in parallel with everything else**: legal/compliance review, and X Developer App
OAuth approval (if not already an approved app). Both can take days to weeks and nothing
below can compress them.

A one-week target for a never-deployed contract system that will hold real funds carries
real risk. This list is sequenced to make the launch/cut decisions explicit rather than
hidden — read the "Decide now" calls under P1 before committing to a date.

---

## P0 — Hard blockers. Nothing else matters until these pass, in this order.

- [ ] **Get a real `solana` + `anchor` CLI (0.30.1, matching `Cargo.toml`'s pin) on a
      machine with real network access.** This sandbox cannot do this step — it has to
      happen somewhere else, today.
- [ ] `anchor build` all three programs (`sho_solana`, `sso_solana`, `registry_solana`).
      Expect BPF-specific compile errors `cargo check` couldn't catch (account-size
      miscalculations especially — `sso_solana`'s `Campaign.epochs: Vec<Epoch>` worst case,
      `MAX_EPOCHS=90`, has never actually been allocated against real rent rules).
- [ ] `anchor keys list`; replace every placeholder `declare_id!()` (`Fg6PaFp...` for SHO,
      `9xQeWvG8...` for SSO, `E6pYGM6c...` for Registry) and `Anchor.toml`'s
      `[programs.localnet]` entries with the real generated ids.
- [ ] Write `tests/sho.ts`, `tests/sso.ts`, `tests/registry.ts` — happy-path SOL/SPL
      campaigns, fee split, milestone/epoch reach + challenge-window correction + elapsed-
      window rejection, valid/invalid/double claim, non-keeper rejection, SSO's
      epoch-not-yet-ended check, Registry's co-signer registration + duplicate-handle
      rejection. This is the first real correctness check this code has ever had — budget
      real time to fix what it finds, not just to write it.
- [ ] `anchor test` against a local validator. **Fix everything it surfaces before moving
      on** — nothing past this point is trustworthy until this is green.
- [ ] Deploy all three programs to **devnet**. `initialize_config` for each.
- [ ] Point every `.env`/`SCP_CONFIG` at the real devnet program ids + a devnet RPC URL.
      Run the **entire flow live, once, end to end**, with devnet SOL/SPL tokens: create a
      SHO campaign → price samples land → leaderboard populates → a milestone crosses →
      snapshot computes → root posts → claim succeeds. Separately: link an X account on
      Solana → create an SSO campaign → a qualifying post gets indexed → an epoch closes →
      root posts. Every one of these steps is unverified until this runs for real.

## P1 — Must-have before real funds are at risk. Decide-now items marked explicitly.

- [ ] **Decide now: keeper signer model for mainnet.** Code currently uses a single Solana
      keypair (`SOLANA_KEEPER_PRIVATE_KEY`), the same deliberate simplification the EVM side
      already accepted for testnet — but testnet funds and mainnet funds are not the same
      risk. A compromised single key can move every locked reward. Real options, pick one:
      (a) accept the single-key risk explicitly for launch, with a written rotation/incident
      plan and tightly capped total funds at risk until a multisig (e.g. Squads) replaces
      it; (b) stand up Squads before launch — real setup time, likely doesn't fit a one-week
      target alongside everything else here. **This decision gates how much real money can
      safely be locked at launch — make it explicitly, don't let it default silently.**
- [ ] **Decide now: reward-mint allowlist.** `reward_mint`/`reward_token` currently accepts
      *any* SPL mint, no whitelist — a campaign creator could set the reward to a worthless
      or malicious token and the UI would display it at face value. Either ship an
      allowlist (stablecoins + the protocol's own token + SOL) before launch, or explicitly
      accept this as a known v1 gap with a plan to add it fast.
- [ ] Production infrastructure, each a real external dependency to actually provision
      (none of this exists yet, all currently point at placeholders/localhost):
  - A real Postgres instance the keeper and API both point at.
  - A real Solana **mainnet-beta** RPC provider (Helius/QuickNode/Triton/etc.) — the
    public RPC endpoint is rate-limited and not viable for a live keeper polling every
    15s. Separate URL from devnet.
  - A real `BIRDEYE_API_KEY` (paid plan — confirm it covers mainnet-beta `x-chain: solana`
    at the call volume the keeper's polling interval implies).
  - Confirm `public-api.birdeye.so` and `api.dexscreener.com` are actually reachable and
    return the documented response shape from wherever the keeper actually runs — neither
    has ever been called successfully from any environment this project has had access to
    yet. **This is a real unknown, not just an untested path — verify it before relying on
    it for mainnet milestone detection.**
  - A real X Developer App with OAuth 2.0 PKCE enabled and (if needed) elevated/paid API
    access for the search-recent endpoint's actual rate limits under live traffic — see
    "start today" above.
  - A real `SOLANA_ATTESTOR_PRIVATE_KEY` (Ed25519) and `ATTESTOR_PRIVATE_KEY` (EVM, if the
    EVM registry stays live in parallel), generated fresh, never the placeholder.
- [ ] **Resolve or explicitly accept the `bigint-buffer` advisory** (`@solana/web3.js@1.95.3`
      pulls in a high-severity buffer-overflow-vulnerable transitive dep; the fix is the
      breaking v2/v3 API, which touches keeper + API + the vendored frontend bundle and
      almost certainly doesn't fit this week). Document the accepted-risk reasoning
      (already partly done in `keeper/README.md`/`api/README.md`) and put the real
      migration on the post-launch backlog, not "never."
- [ ] Wire the missed-root SLA alert (`keeper/src/alerts.js`) to an actual pager/Slack/
      email destination someone is watching. An alert nobody sees isn't a safety net.
- [ ] **Legal/regulatory review — start today, separately from all engineering work above.**
      A mechanism that pays out based on trading activity and social engagement needs
      jurisdiction-aware sign-off before real funds move. This has no engineering shortcut.

## P2 — Scope decision: what actually launches day one

- [ ] **Recommend: launch SHO-only first, SSO shortly after.** SHO has a complete,
      cross-checked pipeline (create → price → leaderboard → milestone → claim) and a
      working claim UI. SSO's pipeline is equally complete on the keeper/program side, but
      **its claim UI does not exist yet** (`claim_sol`/`claim_spl` are never called for SSO,
      on either network) — building it is a real task (mirrors SHO's `submitShoClaimSolana`
      + `claimRoutes.js` branch, a day of focused work, not a week), and SSO additionally
      depends on the X Developer App approval and a live Registry flow nobody has tested
      yet. Launching SHO alone first materially shrinks the untested surface going live
      with real money, and SSO follows once P0's live smoke test has actually exercised it.
      If SSO must launch day one regardless, budget explicit time for its claim UI and
      treat its larger untested surface as a known, accepted risk.
- [ ] Frontend: point every `SCP_CONFIG` Solana value at mainnet-beta (cluster, RPC URL,
      explorer URL, the three real program ids from P0). Confirm the Firebase Hosting
      deploy actually picks up these values (check which `.env`/build-time config the
      static `public/index.html` deploy currently bakes in — it's a static file, not
      server-rendered, so "point at mainnet" means rebuilding/redeploying with the new
      `SCP_CONFIG`, not just an env var flip somewhere).
  - Per "leaving Robinhood for later phase": decide whether the EVM network-picker
    options stay visible (clearly marked testnet-only) or get hidden entirely for this
    launch — a product call, not an engineering one, but needs an explicit answer so the
    UI doesn't silently offer a half-supported path.

## P3 — Explicitly deferred, not a launch blocker

- Everything EVM/Robinhood Chain — per direct instruction, next phase.
- A real third-party security audit. **Cannot genuinely fit a one-week timeline.** The
  honest move: schedule it to start immediately (in parallel with or right after launch),
  and keep total funds at risk capped until it completes and any findings are resolved —
  not "launch now, audit never."
- Standing up a real multisig, if P1's signer-model decision chose "accept single-key risk
  for now" — revisit within weeks of launch, not an open-ended deferral.
- The unclaimed-reward policy (deadline/sweep for funds nobody ever claims) — currently
  locks forever by design on both chains; fine to ship as-is, but worth a product decision
  soon rather than by default.
- CI running the test suites on every PR, full load/chaos testing under realistic volume —
  valuable, not launch-blocking for a first real cohort of campaigns.

---

## Suggested day-by-day, if today is day 1

Kick off **today**, regardless of engineering sequencing: legal review, X Developer App
approval chase, provisioning real RPC/Postgres/Birdeye accounts (these are forms and
waiting, not code — don't let them start on day 4).

- **Day 1-2**: Toolchain, `anchor build`, fix BPF-specific compile surprises, write the TS
  test suite.
- **Day 2-3**: `anchor test` — fix everything it finds. Expect this to take longer than it
  looks; this is genuinely the first time any of this logic has run.
- **Day 3-4**: Devnet deploy, the full live end-to-end smoke test (P0's last item). Fix
  whatever that reveals too — a passing local-validator test suite doesn't guarantee a
  clean live run against real network latency/confirmation timing.
- **Day 4-5**: Production infra wiring, signer-model decision executed, reward-mint
  allowlist decision executed.
- **Day 5-6**: Mainnet deploy. Tiny real-fund smoke test before any public announcement.
  Frontend cutover to mainnet config.
- **Day 6-7**: Buffer — for the inevitable slip, for legal/X-approval if still pending
  (don't launch publicly before these land, even if code is ready), for monitoring
  validation.

If legal or X API approval hasn't landed by the time engineering is ready, **that's the
actual gate**, not a reason to skip it — a technically-ready, legally-unreviewed launch is
not a smaller risk, just a differently-shaped one.
