# contracts-solana — SHO and SSO, ported to Solana

Status: **unaudited, unbuilt, undeployed.** This is the first pass at adding Solana as a
second supported network, alongside the existing EVM contracts in `../contracts`. Both
campaign types mirror their Solidity counterparts as closely as Solana's account model
allows, as two separate Anchor programs sharing one common crate — the same shape as the
EVM side's two separate factories sharing `contracts/src/libraries/*.sol` and
`FactoryBase.sol`.

## Layout

- `programs/common` (`sho_sso_common`) — shared, not itself a deployable program: the
  `Types` enums (`LeaderboardWindow`, `EpochLength`, `MilestoneTier`, `CampaignStatus`,
  mirroring `contracts/src/libraries/Types.sol`), Keccak merkle verification (mirroring
  `ClaimVerifier.sol`), and the fee/challenge-window/duration/leaderboard-size constants
  (mirroring `FactoryBase.sol`). Both programs below depend on it as a path dependency —
  Cargo compiles it into each program's own binary separately, the same way an inlined
  Solidity `library` ends up in each contract's bytecode rather than linked externally.
- `programs/sho_solana` — Strong Hold Offering. Mirrors
  `contracts/src/sho/{SHOFactory,SHOCampaign}.sol`.
- `programs/sso_solana` — Strong Shill Offering. Mirrors
  `contracts/src/sso/{SSOFactory,SSOCampaign}.sol`. Kept as a fully separate program
  (own program id, own `Config` singleton) rather than folded into `sho_solana`, for the
  same reason `SSOCampaign.sol` is a sibling contract rather than merged into
  `SHOCampaign.sol`: per PRD §12.3, milestones (one-way, market-cap-gated) and epochs
  (recurring, scheduled) are different enough state machines that merging them would make
  both harder to audit.

Each program implements: `initialize_config`, `set_treasury`, `set_keeper`,
`create_campaign_sol` / `create_campaign_spl`, the keeper-only root-posting instruction
(`post_milestone_root` for SHO, `post_epoch_root` for SSO), and `claim_sol` / `claim_spl`.

Validated with `cargo check --workspace` against a native target (dependency resolution +
full type/borrow-check pass across all three crates) — see "What `cargo check` passed does
and doesn't prove" below for what that does and doesn't cover.

## Deliberate differences from the Solidity versions (and why)

| Solidity (EVM) | Solana (Anchor) | Why |
|---|---|---|
| `mapping(uint256 => mapping(address => bool)) claimed` | One `ClaimReceipt` PDA per (campaign, milestone/epoch index, claimant) | Solana account data can't hold an unbounded map; a receipt PDA's mere existence is the "claimed" flag, and `init` already fails if it exists — same semantics, different storage shape. |
| Single `createCampaign`, branches on `rewardToken == address(0)` | `create_campaign_sol` / `create_campaign_spl` | Anchor needs concrete account types (System vs. SPL Token) declared up front, not chosen by a runtime branch inside the handler. |
| Single `claim`, branches on `rewardToken` | `claim_sol` / `claim_spl` | Same reason. |
| EIP-1167 clone deploy per campaign | One long-lived program, one PDA per campaign | Solana programs are singletons; "a new contract per campaign" has no Solana equivalent — a PDA keyed by `(config, campaign_id)` plays that role instead. |
| `status()` view function | Not implemented on-chain | There's no gas-free "view call" distinct from fetching account data on Solana; clients compute Active/Completed/Expired from `Campaign`'s fields directly, same inputs as the Solidity version used. |
| Merkle leaf = `keccak256(keccak256(abi.encode(address, uint256)))` | `keccak256(keccak256(pubkey(32) \|\| amount_be(32)))` | A `Pubkey` is already 32 bytes; no left-padding needed. Still keccak-based (not Solana's cheaper native sha256) specifically so the *algorithm shape* (double-hash, sorted-pair internal nodes) stays recognizable across both chains, even though the byte encoding necessarily differs. |
| SSO's `epochRewardBpsList` has **no length cap at all** | Capped at `MAX_EPOCHS = 90` (`sso_solana/src/constants.rs`) | Solana account space must be fixed at creation. 90 covers the worst realistic case (a 90-day campaign, the longest allowed `duration`, with 24h epochs). **Side finding, not fixed by this port:** `SSOCampaign.sol::initialize`'s unbounded `.push()` loop over `epochRewardBpsList` is arguably its own latent gas-griefing risk on the EVM side — worth raising with whoever audits the EVM contracts. |
| SSO's `keyword` (`string`) has no length cap | Capped at `MAX_KEYWORD_LEN = 64` bytes | Same reason — Solana account space is fixed up front. 64 bytes comfortably covers any real X hashtag/cashtag. |

## What's NOT done yet

- **No keeper-side Solana support**: no Solana trade indexer, no Solana TWAP oracle, no
  Solana merkle-tree builder matching `common/src/merkle.rs`'s leaf encoding, no Solana
  transaction submission in `keeper/src/onchainPoster.js`. The keeper today only knows how
  to talk to the EVM contracts — for either campaign type.
- **No API-side Solana support**: `api/src/*Routes.js` only reads from the EVM-facing
  Postgres tables the keeper populates.
- **Frontend campaign *creation* now supports Solana** (`public/index.html`'s
  `CreateWizard`): a network picker, a `window.solana` (Phantom-compatible) wallet connect
  flow alongside the existing EVM one, and hand-built Anchor instructions (no Anchor TS
  client — see the "Raw instruction-building" comment above the Solana helpers in
  `index.html`) for `create_campaign_sol`/`create_campaign_spl` on both programs.
  `@solana/web3.js` is vendored the same way as `ethers.umd.min.js`, at
  `public/vendor/solanaWeb3.min.js`. **Discover and claim still have no Solana path at
  all** — a Solana campaign created through the wizard routes back to the (EVM-only)
  Discover list rather than a working detail page, because that depends on the keeper/API
  Solana support above, which doesn't exist yet.
- **No TS test suite yet** for either program (the equivalent of
  `contracts/test/{sho,sso}.test.js` / `test/helpers/{deploy,merkle,harness}.js`, run with
  `anchor test` against a local validator).
- **Never built to BPF/SBF, never deployed anywhere, not even localnet.**

## What `cargo check` passed does and doesn't prove

It proves: every crate's types, Anchor account constraints, and macro-generated
`Accounts`/`Bumps` impls all compile — i.e. there's no "this literally doesn't typecheck"
class of bug left in either program. It does **not** prove: the programs build to valid
BPF/SBF binaries (`cargo check` targets the host architecture, not Solana's), that any
instruction actually behaves correctly end-to-end (no unit/integration test has run), or
that account sizes / rent calculations are right once real runtime behavior is involved —
especially `sso_solana`'s `Campaign.epochs: Vec<Epoch>`, whose worst-case size
(`MAX_EPOCHS = 90`) has never actually been allocated and measured against Solana's real
account-size/rent rules. Those all require a real `solana` + `anchor` CLI, which this
sandbox doesn't have (`release.solana.com` and
`cdn.jsdelivr.net`/`unpkg.com`/`cdnjs.cloudflare.com` are all blocked by this environment's
egress policy — only `crates.io`'s actual package hosts, `index.crates.io` /
`static.crates.io`, were reachable, which is why `cargo check` alone was possible).

## Next steps, in order

1. **On a machine with the real toolchain**: install `solana-cli` + `anchor-cli` (0.30.1,
   matching the `Cargo.toml` pins), run `anchor build`, then `anchor keys list` and paste
   each program's real generated id into its own `declare_id!(...)` and `Anchor.toml`'s
   `[programs.localnet]` entry. The placeholders currently in place (`Fg6PaFp...` for
   `sho_solana`, `9xQeWvG8...` for `sso_solana`) are **not** keys anyone controls, and must
   not be used past localnet testing.
2. Write `tests/sho.ts` and `tests/sso.ts` mirroring `contracts/test/{sho,sso}.test.js`'s
   scenarios (happy-path SOL/SPL campaigns, fee split, milestone/epoch reach + challenge-
   window correction + elapsed-window rejection, valid/invalid/double claim, non-keeper
   rejection, and — SSO-specific — the epoch-not-yet-ended rejection) and run them against
   `anchor test`'s local validator.
3. Decide the keeper/API/frontend work needed to make either campaign type actually usable
   end-to-end on Solana (a deployed program nobody can create a real campaign against yet
   isn't itself a shippable milestone) — likely shared infrastructure (a Solana RPC client,
   a Solana trade/price indexer) rather than fully separate SHO/SSO tracks.
4. Once something is deployed to Solana devnet, the same Stage 3 security-hardening items
   already blocking EVM mainnet (third-party audit, keeper multi-sig instead of a single
   signer, on-chain stablecoin allowlist, load-testing) apply here too, separately — an
   audit of the EVM contracts does not cover these programs.
