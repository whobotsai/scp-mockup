# Contracts — Stage 0

Smart contracts for Strong Commitment Protocol, per the "Contracts" workstream in
[`../docs/BACKEND_ROADMAP.md`](../docs/BACKEND_ROADMAP.md) (Stage 0). Implements the
architecture already specified in [`../docs/PRD.md`](../docs/PRD.md) §3–§4, §10, §12:

```
src/
  libraries/
    Types.sol           Shared enums (LeaderboardWindow, EpochLength, CampaignStatus, MilestoneTier)
    ClaimVerifier.sol    Shared Merkle-claim verification (PRD §12.3)
  base/
    FactoryBase.sol      Shared factory admin: protocol fee split, keeper address (PRD §3.2, §5)
  sho/
    SHOCampaign.sol       Per-campaign escrow, EIP-1167 clone target (PRD §3.1, §4)
    SHOFactory.sol        Deploys SHOCampaign clones, handles fund custody + fee split
  sso/
    SSOCampaign.sol       Per-campaign escrow with epochs instead of milestones (PRD §12.3-12.4)
    SSOFactory.sol        Deploys SSOCampaign clones
  registry/
    Registry.sol          Wallet <-> X handle linking (PRD §12.3-12.4)
  mocks/
    MockERC20.sol         Test-only stand-in for a reward token; never deployed for real
```

**Status:** unaudited, not deployed anywhere. This is Stage 0 of the backend roadmap —
contracts written and tested against a local simulated chain, nothing more yet. Stage 3 of
the roadmap is where a real audit happens, before any of this touches mainnet.

## Why the build setup looks unusual

This was written in a sandboxed environment whose network policy blocks the hosts both
Foundry (`foundry.paradigm.xyz`) and Hardhat's own `compile` task
(`binaries.soliditylang.org`) need to download a native `solc` binary. Neither tool would
compile anything here out of the box.

The workaround: `scripts/compile.js` drives the pure JS/WASM `solc` npm package directly
(installed like any other dependency, no separate runtime download) with a small Node-based
import resolver standing in for the one Hardhat normally provides, and writes ABI+bytecode
JSON to `build/`. Tests (`test/*.test.js`) are plain Node scripts — not run through
`npx hardhat test`, which would trigger the same blocked download — that load those
manually-compiled artifacts and deploy them with `ethers` against Hardhat's in-process
simulated network (`require("hardhat")` boots that network without needing solc at all).

**On a machine with normal network access, none of this workaround is necessary.** Swap in
standard `npx hardhat compile` / `npx hardhat test`, or migrate to Foundry, whichever the
team prefers going forward — the contracts themselves don't depend on this build setup.

## Running it

```bash
npm install
npm test        # compiles, then runs every test/*.test.js file
```

Or separately: `npm run compile` (writes `build/*.json`), then
`node test/sho.test.js` / `node test/sso.test.js` / `node test/registry.test.js`.

## Deploying to a real network

This build environment's network policy blocks the RPC endpoint too, so this has to run
from a machine with normal network access.

1. **Get testnet ETH.** Robinhood Chain Testnet (chain ID `46630`) —
   [faucet](https://faucet.testnet.chain.robinhood.com/add-chain) for a wallet you control.
   RPC: `https://rpc.testnet.chain.robinhood.com/rpc`. Explorer:
   [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com/).
2. `cp .env.example .env` and fill in `RPC_URL` and `DEPLOYER_PRIVATE_KEY` (the funded
   wallet's private key — never commit this file; it's gitignored).
3. `npm run compile` (if you haven't already).
4. `npm run deploy`

This deploys `SHOFactory`, `SSOFactory`, and `Registry`, and writes their addresses to
`deployments/<chainId>.json` (safe to commit — it's just addresses, not secrets). On a first
testnet deploy there's no real keeper multi-sig, treasury, or Registration Service yet, so
`owner`/`treasury`/`keeper`/`attestor` all default to the deployer's own address; rotate each
one (`setOwner`/`setTreasury`/`setKeeper`/`setAttestor`) once those actually exist, and well
before any mainnet deploy.

To deploy the same thing to a different network later (including mainnet, chain ID `4663`,
PRD.md's header), just point `.env` at that network's RPC and a funded key — nothing else
about `scripts/deploy.js` changes.

## Manual end-to-end test on testnet

Stage 0's exit criteria (`../docs/BACKEND_ROADMAP.md`) is a campaign walked through
milestone-reached / claim by hand, with no automated keeper yet. `scripts/test/` does exactly
that against the live testnet deployment, using the deployer wallet as both creator and
keeper (both default to it, per the deploy step above).

1. `npm run test:campaign:create` — creates a real SHO campaign funded with a small amount
   of native ETH (0.002 ETH gross), one milestone, 100% of the pool to that milestone. Saves
   the new campaign's clone address to `deployments/test-campaign.json`.
2. `npm run test:campaign:post-root` — posts a Merkle root as keeper, for a tree with a
   single leaf: the deployer claiming the whole pool. Opens the real 24h challenge window.
3. Wait — this is a real chain, so that means **actually waiting 24 hours**, not a simulated
   `evm_increaseTime` like the local test suite uses.
4. `npm run test:campaign:claim` — claims the reward once the challenge window has actually
   elapsed (the script checks and refuses to run early).

If this all succeeds, the full SHO lifecycle (create → milestone root → challenge window →
claim) works end-to-end on a real network with zero contract changes needed — Stage 0 is
done, and Stage 1 (the actual keeper service) is what replaces step 2's manual call with a
real indexer.

## Engineering notes / deliberate deviations from the PRD's illustrative signatures

- **`OpenZeppelin Contracts` is pinned to `5.0.2`, and compilation targets `evmVersion:
  "paris"`.** Newer OpenZeppelin releases (5.1+) use the `MCOPY` opcode (EIP-5656, the
  Cancun hardfork) unconditionally in a low-level utility that several imports pull in.
  Robinhood Chain is an Arbitrum Orbit L2, and Arbitrum's Cancun-equivalence rollout isn't
  something this sandbox could verify against a live RPC. Pinning to a pre-MCOPY OZ release
  and an older `evmVersion` avoids shipping bytecode that might not run on the actual target
  chain. **Before Stage 4 (mainnet), confirm Robinhood Chain's actual supported opcode set
  and revisit this pin** — if Cancun is fully supported by then, there's no reason to stay
  on an older OpenZeppelin release.
- **`claim()` and `postMilestoneRoot()`/`postEpochRoot()` don't take a `campaignId`
  parameter**, unlike the PRD's illustrative function table. Each campaign is its own
  EIP-1167 clone — the contract's address *is* the campaign's identity — so a redundant id
  parameter isn't needed at the contract layer. The off-chain API layer (Stage 2 of the
  roadmap) is what maps a campaign id to its clone address for the frontend.
- **`status()` is computed on every call, not stored.** This avoids the whole question of
  who's responsible for flipping a stored status flag to `Expired`/`Completed` — it's always
  correct, for free, with no write cost.
- **The Merkle tree's leaf tiers are validated as strictly increasing** on `initialize()`.
  Not explicit in the PRD, but it rules out a duplicate or out-of-order tier list that the
  product itself never intends to allow.
- **`Registry.registerHandle`'s "oauthProof" is implemented as an ECDSA attestation** signed
  by the Registration Service's key over `(wallet, xHandle)`. A smart contract can't verify
  an OAuth flow directly; the Registration Service (Stage 0/1 of the roadmap, not yet built)
  performs that off-chain and signs the attestation this contract actually checks.

## Open items this doesn't resolve

Carried over from `PRD.md` §13 and `BACKEND_ROADMAP.md`'s "Open decisions" section — these
are product/governance decisions, not implementation gaps:

- What happens to a reward nobody ever claims after a milestone/epoch finalizes. There's
  currently no deadline or sweep path at all (by design, per PRD §2.4/§6) — funds simply sit
  claimable forever. Whether that's the final answer or a deadline gets added later is an
  open product question, not something to decide inside this stage.
- The stablecoin allowlist for `rewardToken` isn't enforced on-chain at all yet — any ERC20
  address is currently accepted. Enforcing an actual allowlist (and who governs it) is
  explicitly deferred to Stage 3 per the roadmap.
