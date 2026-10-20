# contracts-solana — SHO, ported to Solana

Status: **unaudited, unbuilt, undeployed.** This is the first pass at adding Solana as a
second supported network, alongside the existing EVM contracts in `../contracts`. It
mirrors `contracts/src/sho/{SHOFactory,SHOCampaign}.sol` and
`contracts/src/base/FactoryBase.sol` as closely as Solana's account model allows.

## What exists

- `programs/sho_solana/src/lib.rs` — the Anchor program: `initialize_config`,
  `set_treasury`, `set_keeper`, `create_campaign_sol`, `create_campaign_spl`,
  `post_milestone_root`, `claim_sol`, `claim_spl`.
- `programs/sho_solana/src/state.rs` — `Config` (the Solana counterpart of
  `FactoryBase`'s admin state + `SHOFactory`'s `nextId`), `Campaign` (one PDA per
  campaign — there's no "clone" step on Solana, the account itself is the campaign's
  storage), `Milestone`, `ClaimReceipt`.
- `programs/sho_solana/src/merkle.rs` — Keccak-based merkle verification, same
  double-hashed-leaf / sorted-pair convention as `contracts/src/libraries/ClaimVerifier.sol`
  and `keeper/src/merkleTree.js`, re-encoded for a 32-byte `Pubkey` instead of a
  20-byte-left-padded Ethereum address (see the doc comment at the top of `merkle.rs` for
  the exact leaf encoding — a Solana-side tree builder in the keeper will need to match it
  bit-for-bit, which doesn't exist yet; see "Not done yet" below).
- `programs/sho_solana/src/constants.rs`, `src/errors.rs` — same constants (0.5% protocol
  fee, 24h challenge window, the four fixed milestone tiers, the three allowed leaderboard
  sizes/durations) and an explicit error per Solidity `require(...)` message.

Validated with `cargo check -p sho_solana` against a native target (dependency
resolution + full type/borrow-check pass) — see "What's NOT verified" below for what that
does and doesn't prove.

## Deliberate differences from the Solidity version (and why)

| Solidity (EVM) | Solana (Anchor) | Why |
|---|---|---|
| `mapping(uint256 => mapping(address => bool)) claimed` | One `ClaimReceipt` PDA per (campaign, milestone, claimant) | Solana account data can't hold an unbounded map; a receipt PDA's mere existence is the "claimed" flag, and `init` already fails if it exists — same semantics, different storage shape. |
| Single `createCampaign`, branches on `rewardToken == address(0)` | `create_campaign_sol` / `create_campaign_spl` | Anchor needs concrete account types (System vs. SPL Token) declared up front, not chosen by a runtime branch inside the handler. |
| Single `claim`, branches on `rewardToken` | `claim_sol` / `claim_spl` | Same reason. |
| EIP-1167 clone deploy per campaign | One long-lived program, one PDA per campaign | Solana programs are singletons; "a new contract per campaign" has no Solana equivalent — a PDA keyed by `(config, campaign_id)` plays that role instead. |
| `status()` view function | Not implemented on-chain | There's no gas-free "view call" distinct from fetching account data on Solana; clients compute Active/Completed/Expired from `Campaign`'s fields directly, same inputs as the Solidity version used. |
| Merkle leaf = `keccak256(keccak256(abi.encode(address, uint256)))` | `keccak256(keccak256(pubkey(32) \|\| amount_be(32)))` | A `Pubkey` is already 32 bytes; no left-padding needed. Still keccak-based (not Solana's cheaper native sha256) specifically so the *algorithm shape* (double-hash, sorted-pair internal nodes) stays recognizable across both chains, even though the byte encoding necessarily differs. |

## What's NOT done yet

- **SSO (`contracts/src/sso/*`) has no Solana port at all.** This first pass is SHO-only.
- **No keeper-side Solana support**: no Solana trade indexer, no Solana TWAP oracle, no
  Solana merkle-tree builder matching `merkle.rs`'s leaf encoding, no Solana transaction
  submission in `keeper/src/onchainPoster.js`. The keeper today only knows how to talk to
  the EVM contracts.
- **No API-side Solana support**: `api/src/*Routes.js` only reads from the EVM-facing
  Postgres tables the keeper populates.
- **No frontend Solana wallet support**: the app (`public/index.html`) only has an
  EVM/ethers.js wallet connect flow.
- **No TS test suite yet** (the equivalent of `contracts/test/sho.test.js` /
  `test/helpers/{deploy,merkle,harness}.js`, run with `anchor test` against a local
  validator).
- **Never built to BPF/SBF, never deployed anywhere, not even localnet.**

## What "cargo check passed" does and doesn't prove

It proves: the program's types, Anchor account constraints, and macro-generated
`Accounts`/`Bumps` impls all compile — i.e. there's no "this literally doesn't typecheck"
class of bug left. It does **not** prove: the program builds to a valid BPF/SBF binary
(`cargo check` targets the host architecture, not Solana's), that any instruction actually
behaves correctly end-to-end (no unit/integration test has run), or that account sizes /
rent calculations are right once real runtime behavior is involved. Those all require a
real `solana` + `anchor` CLI, which this sandbox doesn't have (`release.solana.com` and
`cdn.jsdelivr.net`/`unpkg.com`/`cdnjs.cloudflare.com` are all blocked by this environment's
egress policy — only `crates.io`'s actual package hosts, `index.crates.io` /
`static.crates.io`, were reachable, which is why `cargo check` alone was possible).

## Next steps, in order

1. **On a machine with the real toolchain**: install `solana-cli` + `anchor-cli` (0.30.1,
   matching the `Cargo.toml` pin), run `anchor build`, then `anchor keys list` and paste the
   real generated program id into both `declare_id!(...)` in `lib.rs` and
   `Anchor.toml`'s `[programs.localnet]` entry (the placeholder `Fg6PaFp...` in both files
   right now is the standard Anchor template default — it is **not** a key anyone
   controls, and must not be used past localnet testing).
2. Write the `tests/sho.ts` suite mirroring `contracts/test/sho.test.js`'s scenarios
   (happy-path SOL campaign, happy-path SPL campaign, fee split, milestone reach +
   challenge-window correction + elapsed-window rejection, valid/invalid/double claim,
   non-keeper rejection) and run it against `anchor test`'s local validator.
3. Decide whether SSO gets the same port before or after the keeper/API/frontend work
   needed to make SHO-on-Solana actually usable end-to-end (a deployed program nobody can
   create a real campaign against yet isn't itself a shippable milestone).
4. Once there's something deployed to Solana devnet, the same Stage 3 security-hardening
   items already blocking EVM mainnet (third-party audit, keeper multi-sig instead of a
   single signer, on-chain stablecoin allowlist, load-testing) apply here too, separately —
   an audit of the EVM contracts does not cover this program.
