# Strong Commitment Protocol — Product & Technical Specification

**Status:** Draft v4 — full documentation (spec + guides + contract reference + FAQ) for both campaign types
**Audience:** Engineering team, investors/partners, token creators, traders, and social supporters
**Chain target:** Robinhood Chain (Arbitrum Orbit, chain ID 4663, EVM-equivalent) — integrates with the Pons.family launchpad (bonding-curve tokens that graduate to Uniswap V4) and, for Part B, the X/Twitter API

**Strong Commitment Protocol** turns a cost every token creator already pays, burning or locking part of their bag, into a performance-based growth budget instead. Tokens go into a reward pool that only pays out for behavior that actually grows the token: no growth, no payout, and the pool stays locked forever, exactly as if it had been burned in the first place. It ships with two campaign types: **Strong Hold Offering (SHO)** pays active traders, and **Strong Shill Offering (SSO)** pays active social supporters. Neither issues a new token or dilutes existing holders: the reward pool is money creators were already writing off, simply redirected toward the outcome they wanted all along.

**The business case**

Every token launched on Pons.family (currently driving roughly 80% of launchpad volume and over half of all transactions on Robinhood Chain) tends to follow the same arc: the dev burns or locks part of their bag, makes one announcement, and momentum fades within days. That capital evaporates with nothing to show for it: nobody buys it back in the form of real growth.

- **For creators and holders.** Opening a campaign is not an extra expense. The bag they were going to burn or lock carries the exact same downside as before. The difference is that if the token succeeds, that same bag automatically becomes a growth engine: traders get paid to keep buying, shillers get paid to keep promoting. No upfront cost, no dilution, just a reallocation of something they were already writing off.

- **For the platform's revenue model.** Every campaign pays a flat 0.5% fee upfront, straight to the treasury. Since both devs and regular holders can open a campaign, and a single popular token can run several campaigns in parallel, each one paying its own fee, the busier the launchpad gets, the more fee volume the platform captures, all without a native token, without emissions, and without a tokenomics story to sell.

- **The flywheel.** A shiller or trader registers once (linking wallet to X for SSO), then stays automatically eligible for every campaign after that. The more campaigns run, the larger the ready-to-participate base becomes, and the stickier the platform gets, rather than being a one-and-done tool per token.

- **The moat.** No comparable primitive exists yet in the Pons.family/Robinhood Chain ecosystem. Where staking or liquidity-mining programs have to fund rewards from new emissions (dilutive, and requiring their own tokenomics), Strong Commitment Protocol pays out of something that was already going to be sacrificed, which makes it cheaper for a creator to run, easier to sell to a community ("this isn't an empty promise, it's a burn that can turn into a reward if we succeed"), and legally simpler, since the platform itself never issues a token.

In short: it converts a defensive cost almost every token already pays into the one growth budget whose downside is guaranteed to be no worse than doing nothing at all.

**Contents**

*Part A — Strong Hold Offering (SHO)*
1. [Overview & Problem Statement](#1-overview--problem-statement)
2. [Mechanism / How It Works](#2-mechanism--how-it-works)
3. [Technical Architecture](#3-technical-architecture)
4. [Data Model & Contract Interfaces](#4-data-model--contract-interfaces)
5. [Economics & Parameters](#5-economics--parameters)
6. [Risks & Mitigations](#6-risks--mitigations)
7. [Roadmap](#7-roadmap)
8. [Creator Guide](#8-creator-guide) — how to launch a campaign, step by step
9. [Trader Guide](#9-trader-guide) — how to earn and claim rewards, step by step
10. [Smart Contract API Reference](#10-smart-contract-api-reference) — full function/event/error detail
11. [FAQ & Glossary](#11-faq--glossary)

*Part B — Strong Shill Offering (SSO)*
12. [Strong Shill Offering (SSO)](#12-strong-shill-offering-sso) — mechanism, architecture, data model, economics, risks, guide, FAQ

*Shared*
13. [Open Questions / Out of Scope](#13-open-questions--out-of-scope)

**Terms used throughout this doc:**
- **Robinhood Chain** — Robinhood's own Arbitrum Orbit L2 (EVM-equivalent, 100ms blocks, settles to Ethereum).
- **Pons.family** — the dominant token launchpad on Robinhood Chain. Anyone can launch a token with no code; it trades on a bonding curve (price rises algorithmically with buys) until it hits a liquidity threshold, at which point it **"graduates"** — its liquidity migrates to a standard Uniswap V4 pool and it trades like any other AMM-listed token from then on.
- **TWAP** — time-weighted average price, used here to smooth out short-term price spikes when checking if a market-cap milestone has genuinely been crossed.
- **Gnosis Safe ("Safe")** — the standard multi-signature wallet contract used to require multiple approvers before an on-chain action executes; referenced here as the keeper's signing mechanism.

---

# Part A — Strong Hold Offering (SHO)

## 1. Overview & Problem Statement

### 1.1 The problem: burn and lock are both dead ends

On launchpads like Pons.family, a creator or large holder who wants to signal commitment has exactly two moves, and both stop working the moment they're used.

**Burn destroys supply but buys nothing.** It's a one-time announcement that fades from a community's memory within days, and it does nothing for the thing that actually keeps a token alive: people showing up to trade it. Supply scarcity without demand is not a growth strategy.

**Lock is worse than neutral — it schedules its own failure.** A vesting lock doesn't prevent a dump, it *calendars* one: the unlock block is public, traders position around it in advance, and the token reliably craters right when the lock expires. The market has seen this pattern enough times that "tokens are locked" barely registers as reassurance anymore — everyone knows what happens next. Lock mechanisms optimize for a promise the team ends up breaking by design, not for the token's actual health.

Neither mechanism rewards the one behavior that determines whether a token survives its first weeks: **sustained, active trading from real participants.** Both are supply-side gestures in a game that's actually won or lost on demand.

### 1.2 What SHO does differently

**Strong Hold Offering (SHO) is the first Pons.family/Robinhood Chain primitive that makes a locked position pay for demand instead of just removing supply.**

A creator or holder deposits tokens into an SHO campaign instead of burning or locking them. That pool only pays out to the token's most active net-buyers, and only as the token's market cap actually climbs past milestones the creator set in advance. If it never gets there, the tokens lock forever — the exact same permanent-loss outcome as a burn. There is no scenario where SHO is riskier than burning; there is only a scenario where, if the token succeeds, the people who drove that success get paid from a pool the team was going to give up anyway.

This is structurally different from a staking or rewards program: it isn't funded by new token emissions or external treasury spend, so it doesn't dilute anyone. It's the same bag a burn or lock would have consumed, just redirected toward the one outcome (real trading activity, real price growth) that a burn or lock can never produce on its own.

### 1.3 Why now

Pons.family already drives roughly 80% of Robinhood Chain's launchpad volume and over half its total transactions, with the chain posting record DEX volume as the meme-coin cycle on Robinhood Chain accelerates. That velocity cuts both ways: launch volume is high, but so is the rate at which tokens are abandoned within days once the initial hype fades and no mechanism gives traders a reason to keep showing up. A commitment signal that's actually tied to sustained activity — rather than one more burn announcement or lock countdown the market has learned to discount — is a differentiator precisely because the ecosystem is this crowded and this fast-moving right now.

**Who can create a campaign:** the token deployer ("dev"), or any large individual holder — anyone who wants to commit their bag toward growing the token instead of burning or passively locking it.

**Who benefits:**

- **Traders — trade with a bounty on it.** Buying and holding conviction isn't just a bet on price anymore; it's a bet with a payout attached. Rank in the leaderboard when a milestone hits and you get paid straight from the pool, in USDC, ETH, or the token itself — real, quantifiable upside for being early and active, not just goodwill toward a project.

- **The token/community — a growth story that pays for itself.** Instead of a static "X tokens burned" headline that means nothing a week later, the token gets a live, public number the community can rally around ("9.95M locked, first unlock at $250K mcap") that only grows more compelling as trading activity does. And if it fails, the community hasn't lost anything a burn wouldn't have already cost them.

- **The creator/holder — all the credibility of a burn, none of the wasted upside.** Same permanent-loss downside as torching your bag for a headline, but if the token actually takes off, that same commitment turns into a marketing engine and a direct reward to the people who made it happen — instead of just ash.

---

## 2. Mechanism / How It Works

### 2.1 Creating a campaign

A creator locks a chosen amount of tokens into a new SHO campaign and configures:

| Parameter | Options |
|---|---|
| **Reward denomination** | The campaign token itself, ETH, or an allowlisted stablecoin (MVP: USDC only — see §5) |
| **Leaderboard window** | 24H, 7D, or 30D — a *rolling* lookback used to rank trader activity at any point in time |
| **Leaderboard size** | Top 50, Top 100, or Top 500 traders |
| **Campaign duration** | 7D, 30D, or 90D — the overall deadline by which milestones must be hit |
| **Milestones** | One or more of exactly four preset mcap thresholds — 100K / 250K / 1M / 5M — each assigned a % of the total pool (must sum to 100%) |

**Leaderboard window vs. campaign duration — these are two different clocks.** The window is how far back the keeper looks when ranking traders *at the moment a milestone fires* (e.g., "who bought the most, net, in the last 7 days"). The duration is the overall lifespan of the campaign — how long the token has to hit its milestones at all before the unreached portion locks forever. A campaign can run 90 days while still ranking traders on a 7-day rolling window each time a milestone triggers within it (see the worked example in §5).

**Milestone thresholds are a fixed enum, not free-form input** — both the contract and the creation UI only accept the four presets above. This keeps campaigns comparable across tokens and avoids validating arbitrary creator-supplied numbers.

**Circulating supply**, for mcap purposes, is read as the token's total supply as reported on-chain, with no netting-out of SHO-locked tokens, vesting, or other locks. This is the simpler of two options; it means mcap is somewhat overstated relative to true freely-tradable supply, which creators should account for when picking a milestone.

A **0.5% protocol fee** is deducted from the locked pool at creation time and sent to the protocol treasury. The remainder is escrowed in the campaign contract for the life of the campaign. This treasury also funds the keeper's gas costs for posting leaderboard roots (§3.2) — creators and traders never pay keeper gas directly.

A token can have **multiple concurrent SHO campaigns** running from different creators/holders — each is an independent escrow with its own leaderboard and milestones, computed independently by the keeper. This is intentional: campaigns don't share state, so the same trader can legitimately earn from more than one campaign on the same token at once, and two campaigns can target the same milestone value without conflict.

### 2.2 Tracking trader activity

Throughout the campaign, an off-chain keeper service indexes every trade against the token — from the **Pons.family bonding curve** while the token is pre-graduation, and from its **Uniswap V4 pool** after graduation — and computes each wallet's **net-buy volume**: total USD-equivalent bought minus total USD-equivalent sold, each leg valued at that trade's own execution price, within the campaign's configured leaderboard window. Wallets with net-negative volume (net sellers over the window) are **excluded entirely from the leaderboard** — they are not ranked, not just floored to zero.

Net-buy volume is used specifically so that a single wallet's round-trip wash trading contributes nothing to its ranking. This does **not** fully close the wash-trading problem — a wallet could still route the sell side of a wash trade through a *different* address it controls, keeping the buy-side wallet's net-buy volume intact. Combined with the absence of a per-wallet cap (§5), this is a known, accepted MVP limitation — see §6.

### 2.3 Milestones and payout

The token's **circulating market cap** (price × circulating supply) is tracked via a **30-minute TWAP**, combining bonding-curve and Uniswap V4 price data, to prevent a single flash pump from falsely triggering a milestone.

When a milestone's mcap threshold is confirmed crossed (sustained for the full 30-minute TWAP window):
1. That milestone is marked **reached, permanently** — this is a one-way flag. If mcap later dips back below the threshold, the milestone stays reached; there is no un-reaching it.
2. The keeper freezes a leaderboard snapshot (net-buy volume per wallet, over the trailing window, as of that moment) and computes each eligible trader's proportional share of that tier's reward.
3. The keeper publishes a **provisional** Merkle root on-chain via `postMilestoneRoot()`, alongside the full underlying snapshot data (published off-chain, e.g. to IPFS, with the hash referenced on-chain) so anyone can independently recompute and verify it.
4. A **24-hour challenge window** follows. During this window `claim()` is not yet open. If an error is found (e.g. an indexer bug), the keeper can overwrite the root with a corrected one via another `postMilestoneRoot()` call — each overwrite restarts the 24-hour window.
5. Once the window elapses without a correction, the root **finalizes** and can no longer be changed. `claim()` opens, and eligible traders claim their share using a Merkle proof against the finalized root.

This challenge window is a **procedural, not cryptographic** safeguard — a Merkle proof only proves a claim was included in the posted root, it says nothing about whether the root itself was computed correctly from real trade data. The published snapshot data is what lets anyone (not just the keeper) catch a bad root before it finalizes; see §6 for the residual trust this still places in the keeper.

Milestones unlock **independently and cumulatively** — reaching 250K doesn't require 100K's reward to have been claimed first, but each tier's payout is only computed and claimable once that tier's threshold is actually crossed and its challenge window has elapsed.

### 2.4 Campaign failure

If the campaign's duration expires **before** a given milestone is reached, that milestone's portion of the pool is **never unlocked** and remains permanently locked in the contract — unclaimable by anyone, including the creator. In effect, an unreached milestone behaves exactly like a burn. There is no reclaim/refund path in this version of the spec (see §6 for the trade-offs of that choice).

---

## 3. Technical Architecture

```
                     ┌─────────────────────────┐
   creator ─lock────▶│      SHOFactory.sol       │──deploys (EIP-1167 clone)──▶  SHOCampaign.sol (per campaign)
                     └─────────────────────────┘                                        │
                                                                                          │ escrow + claim logic
                                                                                          ▼
                                                                                   trader.claim(proof)
                                                                                          ▲
                                                                          postMilestoneRoot(root)
                                                                                          │
                                                            ┌─────────────────────────────┴───────────────┐
                                                            │              Keeper Service (off-chain)        │
                                                            │  ┌───────────────┐  ┌───────────────────────┐  │
                                                            │  │ Chain Indexer │  │ Price/TWAP Oracle       │  │
                                                            │  │ (Pons bonding │  │ (bonding curve +        │  │
                                                            │  │ curve + Uni V4│  │ Uniswap V4, 30-min TWAP)│  │
                                                            │  └──────┬────────┘  └───────────┬─────────────┘  │
                                                            │         ▼                        ▼               │
                                                            │  ┌────────────────────────────────────────────┐ │
                                                            │  │ Leaderboard & Milestone Engine               │ │
                                                            │  │ (net-buy volume, snapshot, Merkle tree build)│ │
                                                            │  └───────────────────┬────────────────────────┘ │
                                                            │                       ▼                          │
                                                            │              multi-sig signer(s)                 │
                                                            └───────────────────────────────────────────────┘
```

### 3.1 On-chain components

- **`SHOFactory.sol`** — creates new campaigns as gas-efficient EIP-1167 minimal proxy clones of a `SHOCampaign` implementation contract; maintains a registry of all campaigns (by token, by creator).
- **`SHOCampaign.sol`** — per-campaign escrow. Holds locked tokens, stores milestone configuration and state, accepts Merkle roots from the authorized keeper multi-sig, and exposes `claim()` for traders.

### 3.2 Off-chain keeper service

- **Chain Indexer** — subscribes to swap/transfer events from the token's Pons bonding curve contract and, post-graduation, its Uniswap V4 pool.
- **Volume Aggregator** — computes rolling net-buy volume per wallet for each campaign's configured window.
- **Price/TWAP Oracle module** — computes the 30-minute circulating-mcap TWAP used for milestone detection.
- **Leaderboard & Milestone Engine** — detects milestone crossings, freezes leaderboard snapshots, builds the Merkle tree of reward allocations, and publishes the full snapshot (wallet → net-buy volume → allocated reward) to public off-chain storage (e.g. IPFS) so it can be independently recomputed and checked during the challenge window.
- **On-chain poster** — a multi-sig (target: 3-of-5 Gnosis Safe) submits `postMilestoneRoot()` transactions, funded from the protocol treasury (the 0.5% campaign creation fee). This multi-sig is the MVP's single trusted component — the 24-hour challenge window (§2.3) lets anyone catch and force correction of a bad root before it finalizes, but does not remove the underlying trust requirement (see §6).

### 3.3 Frontend dApp

- **Create Campaign** — wizard for lock amount, denomination, window, leaderboard size, duration, and milestone tiers.
- **Discover** — browse active/past SHO campaigns across tokens.
- **Campaign detail** — live leaderboard, milestone progress bar (current mcap vs. thresholds), pool status.
- **Claim** — wallet connect, shows claimable amount per milestone with live Merkle proof generation, submits `claim()`.

---

## 4. Data Model & Contract Interfaces

### 4.1 Campaign struct (illustrative)

```solidity
enum MilestoneTier { M100K, M250K, M1M, M5M }   // the only four allowed thresholds

struct Milestone {
    MilestoneTier tier;
    uint16  rewardBps;        // share of total pool allocated to this tier, in basis points
    bool    reached;          // one-way: true forever once TWAP confirms the cross
    bytes32 merkleRoot;       // provisional until challengeWindowEnds, then final
    bytes32 snapshotHash;     // hash of the published off-chain snapshot data, for verification
    uint256 reachedAt;        // timestamp the milestone was confirmed reached
    uint256 challengeWindowEnds; // reachedAt (or last root correction) + 24h
    uint256 totalClaimed;
}

struct Campaign {
    uint256 id;
    address token;             // the campaigning token
    address creator;
    address rewardToken;       // token itself, address(0) for ETH, or an allowlisted stablecoin (§5)
    uint256 totalLocked;       // net of the 0.5% protocol fee
    LeaderboardWindow window;  // 24H | 7D | 30D
    uint16  leaderboardSize;   // 50 | 100 | 500
    uint256 duration;          // 7D | 30D | 90D, from createdAt
    uint256 createdAt;
    Milestone[] milestones;    // rewardBps across all milestones must sum to exactly 10,000 (100%); enforced in createCampaign
    CampaignStatus status;     // Active | Completed | Expired
}
```

### 4.2 Key functions

| Function | Caller | Purpose |
|---|---|---|
| `createCampaign(token, rewardToken, amount, window, leaderboardSize, duration, milestones[])` | Creator | Deploys/initializes a campaign, transfers `amount`, deducts 0.5% fee. Reverts unless `rewardToken` is `address(0)`, the campaign token, or an allowlisted stablecoin, and unless `milestones[].rewardBps` sums to exactly 10,000. |
| `postMilestoneRoot(campaignId, milestoneIndex, merkleRoot, snapshotHash)` | Keeper multi-sig only | Posts (or, within the still-open challenge window, overwrites) the leaderboard snapshot for a reached milestone; resets `challengeWindowEnds` to `now + 24h` on every call. Reverts if called after the window has already elapsed. |
| `claim(campaignId, milestoneIndex, amount, proof[])` | Any trader | Reverts if `block.timestamp < challengeWindowEnds`. Otherwise verifies proof against the finalized root, transfers reward, marks leaf claimed. |

There is intentionally **no `withdraw`/`sweep` function** for unreached milestones or expired campaigns in this version — see §2.4 and §6.

### 4.3 Events

`CampaignCreated`, `MilestoneReached`, `RootPosted`, `RootCorrected`, `RewardClaimed`, `CampaignExpired`

### 4.4 Off-chain leaderboard leaf format

Each Merkle leaf encodes: `(campaignId, milestoneIndex, trader address, netBuyVolumeUSD, allocatedRewardAmount)`. `netBuyVolumeUSD` is the USD-equivalent net-buy figure described in §2.2, valued leg-by-leg at each trade's execution price; wallets with a negative value are omitted from the tree entirely.

---

## 5. Economics & Parameters

| Parameter | Value(s) |
|---|---|
| Leaderboard window | 24H / 7D / 30D |
| Leaderboard size | Top 50 / Top 100 / Top 500 |
| Campaign duration | 7D / 30D / 90D |
| Milestone tiers | One or more of exactly 100K / 250K / 1M / 5M circulating mcap (fixed enum, not free-form), creator-assigned % split summing to 100% |
| Reward denomination | Campaign token, ETH, or USDC (MVP stablecoin allowlist — extending the allowlist is a governance action, not a per-campaign creator choice) |
| Ranking weighting | Net-buy volume (USD-equivalent, priced at each trade's execution price) within window; net sellers excluded from the leaderboard entirely |
| Per-wallet cap | None — a single wallet can win an unbounded share of a tier (see §6) |
| Protocol fee | 0.5% of locked pool, taken at campaign creation; also funds keeper gas costs |
| Mcap definition | Circulating market cap = price × total token supply as reported on-chain (no netting-out of locked/vesting supply), 30-minute TWAP |
| Root challenge window | 24 hours between a milestone's root being posted and `claim()` opening for it |

### Worked example

A creator locks 10,000,000 tokens. 0.5% (50,000) goes to the protocol treasury; 9,950,000 are escrowed. They configure two milestones: 250K mcap → 40% of pool, 1M mcap → 60% of pool, leaderboard = Top 100 traders by 7D net-buy volume, duration = 30D.

If the token's 30-min TWAP mcap crosses 250K on day 6, the keeper snapshots the top 100 wallets by trailing-7D net-buy volume (in USD-equivalent, net sellers excluded) and posts a provisional root allocating 3,980,000 tokens across them, proportional to volume. Barring a correction, that root finalizes 24 hours later and those wallets can claim. If the token's mcap never sustains 1M before day 30, the remaining 5,970,000 tokens stay locked in the contract permanently — even though this same token could simultaneously have a second, independent SHO campaign from a different holder targeting different milestones.

---

## 6. Risks & Mitigations

| Risk | Description | Mitigation (MVP) | Future work |
|---|---|---|---|
| **Wash trading / whale dominance** | Net-buy volume weighting defeats simple round-trip wash trading on one wallet, but does **not** catch a wallet splitting the trade across two addresses it controls (buy on wallet A, sell on wallet B) — and since there is **no per-wallet cap**, a single well-funded actor can still legitimately dominate a leaderboard. This is an accepted MVP trade-off, not an oversight. | None beyond net-buy weighting — documented as a known limitation | Optional creator-toggleable soft cap per wallet; wallet-clustering heuristics for multi-address sybil detection |
| **Keeper/oracle centralization** | Leaderboard computation and mcap milestone confirmation depend on a trusted multi-sig, not a fully trustless on-chain process. A Merkle proof only proves a claim was included in the posted root — it proves nothing about whether the root was computed correctly from real trade data in the first place. | 3-of-5 Gnosis Safe; full snapshot data published off-chain and hash-referenced on-chain; 24-hour challenge window before any root finalizes, during which the keeper can be caught and forced to re-post a corrected root (§2.3, §4.2) | Migrate to a permissionless dispute model where anyone (not just the keeper itself) can post a bonded challenge against a bad root, not just the keeper self-correcting |
| **TWAP manipulation around milestones** | A malicious actor could attempt a flash pump right at a milestone boundary. | 30-minute TWAP smooths short-term price spikes; once a milestone is confirmed reached it cannot be un-reached by a later price drop (§2.3) | Extend TWAP window or require sustained mcap over multiple checkpoints before confirming a milestone |
| **Cross-venue volume double-counting** | Migration from Pons bonding curve to Uniswap V4 could double-count volume if not handled carefully during the graduation transition. | Indexer treats bonding-curve and Uniswap V4 as distinct venues with a clean cutover at the graduation block | Formal reconciliation tooling / audit of indexer output |
| **Reward token price risk** | If a campaign pays rewards in the project's own token, a price crash reduces real payout value despite nominal allocation being correct. | Creator can choose USDC/ETH denomination instead | N/A — creator's choice |
| **No refund path for creators** | Because unreached milestones lock permanently with no reclaim, a creator who sets an unrealistic milestone loses that portion of their bag entirely. | This mirrors burn behavior by design — it's meant to keep the commitment credible | Could reconsider for v2 if user feedback shows this is a major adoption blocker |
| **Regulatory framing** | Rewards distributed based on ranking + a speculative price threshold resemble a game-of-chance / prediction mechanism in some jurisdictions. | Unmitigated in this spec — explicitly flagged, not solved | Legal review required before broader launch; may constrain which jurisdictions/venues can offer SHO |
| **Smart contract risk** | Escrowed funds and Merkle-based claims are a direct attack target. | Standard patterns (OpenZeppelin Merkle libs, minimal proxy clones), thorough test coverage | Third-party audit required before mainnet launch with real funds |

---

## 7. Roadmap

**Phase 1 — MVP**
- `SHOFactory.sol` / `SHOCampaign.sol` with the mechanism as specified above
- Trusted 3-of-5 Gnosis Safe keeper, single indexer implementation, published snapshot data + 24h self-correction challenge window (keeper-only correction — not yet permissionless)
- Frontend: create campaign, discover, campaign detail, claim
- Reward denominations: campaign token, ETH, USDC
- No per-wallet cap, no multi-wallet sybil detection beyond net-buy-volume weighting

**Phase 2 — Hardening & decentralization**
- Migrate from keeper-only root correction to a **permissionless** dispute model — anyone can post a bonded challenge against a bad root, not just the keeper self-correcting
- Multiple independent indexers cross-checking leaderboard computation, rather than one keeper's pipeline
- Optional creator-configurable soft cap per wallet; wallet-clustering heuristics for multi-address wash trading
- Expand the reward-token stablecoin allowlist beyond USDC
- Third-party smart contract audit
- Legal/regulatory review

**Phase 3 — Expansion**
- Support additional DEX venues and chains beyond Pons.family/Uniswap V4/Robinhood Chain
- Protocol fee / treasury governance (potentially DAO-controlled)

---

## 8. Creator Guide

This section walks a token deployer or large holder through launching an SHO campaign end to end.

### 8.1 Before you start

- A wallet holding the tokens you intend to lock, connected to Robinhood Chain.
- The token must be tradable on Pons.family (bonding curve or already graduated to its Uniswap V4 pool) — the keeper only indexes volume from these two venues (§2.2).
- Enough ETH in your wallet for gas on two transactions: an ERC-20 `approve` and the `createCampaign` call.
- A clear idea of your milestones and timeline — see §8.4 before locking anything, since **campaign parameters cannot be changed after creation** and unreached milestones lock permanently (§2.4).

### 8.2 Step-by-step

1. **Connect your wallet** on the SHO dApp's Create Campaign page.
2. **Select the token** you want to run a campaign for. The dApp checks it's indexed from Pons.family and shows its current price/mcap.
3. **Enter the amount to lock.** The dApp shows the 0.5% fee deduction and the net amount that will actually be escrowed (§2.1).
4. **Choose reward denomination** — the campaign token itself, ETH, or USDC (§5). Paying in USDC/ETH means your reward payout value doesn't depend on your own token's price; paying in the campaign token costs you nothing extra up front but the reward's real value moves with the token.
5. **Set the leaderboard window** (24H / 7D / 30D) and **leaderboard size** (Top 50 / 100 / 500) — this defines who counts as an "active trader" when a milestone fires (§2.2).
6. **Set the campaign duration** (7D / 30D / 90D) — the deadline for milestones to be hit at all.
7. **Configure milestones.** Pick one or more of the four preset mcap thresholds (100K / 250K / 1M / 5M) and assign each a percentage of the pool. The percentages must sum to 100% — the dApp blocks submission otherwise.
8. **Review the summary screen** — final locked amount, fee, and a plain-language restatement of what happens if each milestone is or isn't reached.
9. **Approve token spend** — sign the ERC-20 `approve` transaction for the campaign contract.
10. **Confirm campaign creation** — sign the `createCampaign` transaction. Once it's mined, the campaign is live and immutable.
11. **Share and monitor** — your campaign gets a public page with a live leaderboard preview and a milestone progress bar you can link from your own channels.

### 8.3 What you can't do after creation

Once `createCampaign` is confirmed: you cannot change any parameter (window, leaderboard size, duration, milestones, denomination), cannot cancel the campaign, and cannot withdraw locked tokens for a milestone that goes unreached — that portion is locked permanently, identical to a burn (§2.4, §4.2). Treat campaign creation as final before you sign.

### 8.4 Choosing realistic milestones

The risk table in §6 is explicit: an unrealistic milestone just burns that portion of your bag with no upside for anyone. Before setting thresholds, look at the token's current mcap and realistic growth trajectory rather than picking round numbers aspirationally — a 100K→250K first tier is a very different commitment for a token currently at 20K mcap than for one already at 90K.

### 8.5 Common creation errors

| Error | Cause | Fix |
|---|---|---|
| `BpsMismatch` revert | Milestone `rewardBps` values don't sum to exactly 10,000 | Adjust percentages so they total 100% |
| `InvalidRewardToken` revert | `rewardToken` isn't the campaign token, `address(0)` (ETH), or an allowlisted stablecoin | Use USDC, ETH, or the campaign token itself (§5) |
| `InvalidMilestoneTier` revert | A milestone threshold isn't one of the four presets | Pick only from 100K / 250K / 1M / 5M |
| `approve` transaction succeeds but `createCampaign` reverts on transfer | Allowance set lower than the lock amount, or insufficient balance | Re-check the approved amount matches the amount you're locking |

---

## 9. Trader Guide

This section explains how to earn and claim SHO rewards as a trader.

### 9.1 How you earn

You don't need to opt in to anything. If you buy a token that has an active SHO campaign, the keeper is already tracking your **net-buy volume** (USD-equivalent bought minus sold, within that campaign's leaderboard window — §2.2) for you automatically. If, at the moment a milestone fires, you're a net buyer and rank in the campaign's configured leaderboard size (Top 50/100/500), you're owed a share of that tier's reward — proportional to your net-buy volume relative to others in the snapshot.

### 9.2 Finding campaigns

The dApp's **Discover** page lists active campaigns per token — locked amount, denomination, current mcap vs. milestone thresholds, leaderboard window/size, and time remaining in the campaign duration.

### 9.3 Checking your standing

On a campaign's detail page, connect your wallet to see a **"your position"** panel: your current net-buy volume in the configured window, your live rank if you're inside the leaderboard size, and how far the token's mcap is from the next milestone. This is an estimate — the leaderboard isn't final until a milestone actually fires and the keeper freezes a snapshot (§2.3).

### 9.4 When a milestone fires

1. The token's mcap sustains a 30-minute TWAP above a threshold — the milestone is confirmed reached.
2. The keeper freezes the leaderboard and posts a **provisional** reward allocation on-chain.
3. **Nothing is claimable yet.** A 24-hour challenge window follows, during which the keeper can correct the root if an error is found (§2.3).
4. Once the window elapses, the allocation **finalizes** and the dApp's Claim button activates for eligible wallets.

### 9.5 Claiming

Go to the campaign's page, connect your wallet, and if you're eligible for a finalized milestone the dApp shows your exact reward amount and a **Claim** button. Behind the scenes it fetches your Merkle proof from the published snapshot data and submits it to `claim()` (§10). You pay gas for this transaction — reward transfers are not gasless.

### 9.6 Things that can affect your eligibility

- **Selling drags down your net-buy volume** — a large sell late in the window can push you to net-negative, which removes you from the leaderboard entirely for that snapshot (§2.2), not just lower your rank.
- **Trading outside the leaderboard window doesn't count** — only activity within the campaign's configured rolling window (24H/7D/30D), as measured at the moment the milestone fires, is counted.
- **Volume off Pons.family/Uniswap V4 isn't tracked** — trades on other venues for the same token (if any exist) aren't indexed.
- **There's no cap protecting your share** — a single large trader can legitimately take most of a tier's pool; this is a known, unaddressed design trade-off (§6), not a bug.
- **A missed milestone claim doesn't roll over** — each milestone's allocation is specific to that snapshot; there's currently no mechanism to "catch up" for a milestone you weren't ranked in when it fired.

---

## 10. Smart Contract API Reference

This expands the interface summary in §4.2 into full implementation-level detail. All functions live on `SHOCampaign.sol` unless noted.

### 10.1 `SHOFactory.sol`

**`createCampaign(address token, address rewardToken, uint256 amount, LeaderboardWindow window, uint16 leaderboardSize, uint256 duration, Milestone[] calldata milestones) → address campaign`**
Caller: any address (the creator).
Deploys an EIP-1167 minimal proxy clone of the `SHOCampaign` implementation, initializes it, and pulls `amount` of `token` from the caller via `transferFrom` (requires prior `approve`).

Reverts:
| Custom error | Condition |
|---|---|
| `InvalidRewardToken()` | `rewardToken` is not `address(0)`, `token`, or on the stablecoin allowlist |
| `InvalidMilestoneTier()` | Any `milestones[i].tier` is outside the 4-value `MilestoneTier` enum |
| `BpsMismatch()` | `sum(milestones[i].rewardBps) != 10_000` |
| `InvalidWindow()` / `InvalidDuration()` / `InvalidLeaderboardSize()` | Value outside the allowed enum/set for that parameter |
| `InsufficientAllowance()` | `token.allowance(caller, factory) < amount` |

Emits: `CampaignCreated(campaignId, campaign, token, creator, rewardToken, netLocked)`

**`getCampaign(uint256 campaignId) → Campaign` (view)**
Returns the full `Campaign` struct (§4.1).

**`campaignsByToken(address token) → uint256[]` (view)** / **`campaignsByCreator(address creator) → uint256[]` (view)**
Registry lookups used by the Discover page.

### 10.2 `SHOCampaign.sol`

**`postMilestoneRoot(uint256 milestoneIndex, bytes32 merkleRoot, bytes32 snapshotHash) → void`**
Caller: keeper multi-sig only (`onlyKeeper` modifier — reverts with `Unauthorized()` otherwise).
Sets `milestones[milestoneIndex].merkleRoot`, `snapshotHash`, and `challengeWindowEnds = block.timestamp + 24 hours`. Can be called more than once per milestone — each call overwrites the previous root and restarts the window, **as long as the previous window hasn't already elapsed**.

Reverts:
| Custom error | Condition |
|---|---|
| `Unauthorized()` | Caller isn't the keeper multi-sig |
| `MilestoneNotReached()` | The milestone's TWAP threshold hasn't been confirmed crossed |
| `ChallengeWindowElapsed()` | A previous root for this milestone already finalized (window closed) — roots are only correctable, never reopenable after finalization |

Emits: `RootPosted(campaignId, milestoneIndex, merkleRoot, snapshotHash)` on first post, `RootCorrected(campaignId, milestoneIndex, oldRoot, newRoot)` on any subsequent overwrite.

**`claim(uint256 milestoneIndex, uint256 amount, bytes32[] calldata proof) → void`**
Caller: any address claiming on its own behalf.
Verifies `block.timestamp >= milestones[milestoneIndex].challengeWindowEnds`, then verifies `MerkleProof.verify(proof, milestones[milestoneIndex].merkleRoot, keccak256(abi.encode(campaignId, milestoneIndex, msg.sender, netBuyVolumeUSD, amount)))`, then checks the leaf hasn't already been claimed, transfers `amount` of `rewardToken` to `msg.sender`, and marks it claimed.

Reverts:
| Custom error | Condition |
|---|---|
| `ChallengeWindowActive()` | Called before `challengeWindowEnds` |
| `InvalidProof()` | Merkle proof doesn't verify against the finalized root |
| `AlreadyClaimed()` | This leaf was already claimed |

Emits: `RewardClaimed(campaignId, milestoneIndex, claimant, amount)`

**`getMilestone(uint256 milestoneIndex) → Milestone` (view)** / **`isClaimed(uint256 milestoneIndex, address wallet) → bool` (view)**
Read helpers used by the dApp's claim UI.

### 10.3 Access control summary

| Action | Who |
|---|---|
| `createCampaign` | Anyone with sufficient token balance/allowance |
| `postMilestoneRoot` | Keeper multi-sig only |
| `claim` | Anyone, on their own behalf only (`msg.sender` is the claimant) |
| Parameter changes after creation | **Nobody** — campaigns are immutable once created (§8.3) |
| Withdraw an unreached milestone's tokens | **Nobody** — no such function exists (§2.4, §4.2) |

### 10.4 Gas notes

Campaigns deploy as EIP-1167 minimal proxy clones (§3.1), keeping `createCampaign` gas close to a single `CREATE` plus initialization storage writes rather than a full contract deployment. Keeper gas for `postMilestoneRoot` calls is funded from the protocol treasury (§2.1), not charged to creators or traders.

---

## 11. FAQ & Glossary

### 11.1 FAQ

**What happens if my campaign's milestone is never reached?**
That portion of the locked pool stays in the contract permanently — unclaimable by anyone, including you. It behaves exactly like a burn (§2.4).

**Can I cancel a campaign or get my tokens back if I change my mind?**
No. Campaigns are immutable and irreversible once created (§8.3).

**What's the difference between the leaderboard window and the campaign duration?**
The window (24H/7D/30D) is how far back trading activity is measured when ranking traders at the moment a milestone fires. The duration (7D/30D/90D) is the overall deadline for the campaign to hit its milestones at all. See the worked example in §5.

**Why was my wallet excluded from the leaderboard even though I traded a lot?**
Ranking is based on *net-buy* volume, not gross activity — if you sold more (in USD-equivalent) than you bought within the window, you're excluded from that snapshot entirely, not just ranked low (§2.2).

**Can one wallet win an entire milestone's reward pool?**
Yes, if it legitimately has the largest net-buy volume — there's no per-wallet cap in this version (§5, §6).

**What if the keeper posts a wrong leaderboard?**
There's a 24-hour challenge window before any root finalizes and `claim()` opens. During that window the keeper can correct it. Full snapshot data is published off-chain so anyone can verify it themselves (§2.3). This is a procedural safeguard, not a cryptographic guarantee — it still depends on the keeper multi-sig.

**Is SHO available on chains other than Robinhood Chain?**
Not in this version — the MVP is built specifically around Robinhood Chain and the Pons.family/Uniswap V4 venues (§7 Phase 3 covers future expansion).

**Do I pay gas to claim my reward?**
Yes — `claim()` is a transaction you sign and pay gas for, same as any on-chain action.

**What tokens can rewards be paid in?**
The campaign token itself, ETH, or USDC (the MVP's only allowlisted stablecoin) — set once by the creator at campaign creation (§5).

### 11.2 Glossary

| Term | Meaning |
|---|---|
| **Bonding curve** | A pricing mechanism where a token's price rises algorithmically as more of it is bought directly from the contract, before any external liquidity pool exists. |
| **Graduation** | The point at which a Pons.family bonding-curve token's liquidity migrates to a standard Uniswap V4 pool. |
| **TWAP** | Time-weighted average price — smooths short-term price spikes over a window (30 minutes here) so a single flash pump can't falsely trigger a milestone. |
| **Circulating market cap (mcap)** | Price × total token supply as reported on-chain, per §2.1 — used here without netting out locked/vesting supply. |
| **Net-buy volume** | Total USD-equivalent bought minus sold by a wallet within a window, each leg priced at its own execution price (§2.2). |
| **Merkle root / proof** | A cryptographic summary of a large dataset (here, a reward allocation list) that lets any single entry be verified on-chain cheaply, without storing the whole list on-chain. |
| **Basis points (bps)** | 1/100th of a percent; 10,000 bps = 100%. Used for `rewardBps` splits across milestones. |
| **Gnosis Safe ("Safe")** | The standard multi-signature wallet contract requiring multiple approvers before an action executes — used here as the keeper's signing mechanism. |
| **EIP-1167 minimal proxy clone** | A gas-cheap way to deploy many copies of the same contract logic (each campaign) that delegate their code to one shared implementation contract. |
| **Keeper** | The off-chain service (indexer + oracle + multi-sig signer) that computes leaderboards, tracks mcap, and posts results on-chain (§3.2). |
| **Challenge window** | The 24-hour period after a root is posted, before it finalizes, during which the keeper can correct it (§2.3). |

---

# Part B — Strong Shill Offering (SSO)

## 12. Strong Shill Offering (SSO)

### 12.1 Overview

Strong Hold Offering rewards buying. **Strong Shill Offering rewards talking about it well.** Same platform, same core promise (pay out on success, lock forever on failure), different growth lever: instead of ranking net-buy volume, SSO ranks social amplification — posts on X/Twitter that use a keyword, hashtag, or cashtag the campaign creator defines, scored by real engagement. A creator or holder locks a pool; the platform's most effective shillers earn from it, on a recurring schedule, for as long as the campaign runs.

### 12.2 Mechanism / How It Works

**Creating a campaign.** A creator locks tokens and configures:

| Parameter | Options |
|---|---|
| Tracked keyword | One string — a hashtag, cashtag, or phrase — set at creation and immutable after |
| Reward denomination | Campaign token, ETH, or USDC (same allowlist as SHO) |
| Epoch length | 24H / 7D / 30D — how often the pool pays out |
| Leaderboard size | Top 50 / 100 / 500 accounts per epoch |
| Campaign duration | 7D / 30D / 90D — determines how many epochs run |

Unlike SHO's milestone tiers, SSO doesn't wait on price — **the pool pays out on a fixed schedule.** The locked pool is split across every epoch in the campaign (evenly by default; creators can weight epochs unevenly, same mechanic as SHO's per-milestone `rewardBps`). The same 0.5% protocol fee is deducted at creation.

**Registering as a shiller.** Before any post counts, an account connects its X account (OAuth) to a wallet once, via the dApp. This is how the platform knows where to send a reward, and it's the base gate against anonymous bot accounts. One registration covers every SSO campaign that wallet ever participates in.

**What counts as a qualifying post.** A post counts toward an epoch only if it's from a registered account, contains the campaign's exact tracked keyword, was posted inside that epoch's window, and the account clears the platform's minimum bar: **account age ≥ 30 days, followers ≥ 25** (MVP protocol-wide defaults — see §12.5). To blunt spam-flooding, only an account's best 5 qualifying posts count per epoch.

**Scoring.** Each qualifying post gets an engagement score: `2×(retweets + quote tweets) + 1×replies + 0.5×likes` (an MVP default weighting — heavier on retweets/quotes since they're harder to fake cheaply than a like, lighter on likes; not yet creator-configurable). An account's epoch score is the sum of its counted posts' scores.

**Payout.** At the end of each epoch, the keeper freezes the top-N accounts by score, allocates that epoch's share of the pool proportionally, and posts a Merkle root — following **the exact same provisional-root → 24-hour challenge window → finalize → claim pattern as SHO** (§2.3), reused without modification.

**Failure.** If an epoch closes with zero qualifying posts, that epoch's share is never allocated and locks permanently — the same no-refund philosophy as an unreached SHO milestone (§2.4).

### 12.3 Technical Architecture

SSO reuses SHO's architecture (§3) with the components that depend on price/trading swapped for social-data equivalents:

- **Social Indexer** (replaces the Chain Indexer) — polls the X API for posts matching a campaign's tracked keyword, resolves each poster's wallet via the registration table, and pulls engagement metrics per post.
- **No Price/TWAP Oracle** — SSO doesn't depend on token price or mcap at all, only on epoch boundaries (the calendar).
- **Registration Service** (new) — handles X OAuth and stores `(x_handle, wallet_address)` links; the Social Indexer checks this before counting any post.
- Everything downstream — Leaderboard & Epoch Engine, published snapshot data, multi-sig on-chain poster, challenge window — is structurally identical to SHO's keeper (§3.2).

Contracts ship as a **separate sibling pair, `SSOFactory.sol` / `SSOCampaign.sol`**, rather than overloading `SHOCampaign.sol`: milestones (one-way, permanent) and epochs (recurring, scheduled) are different enough state machines that forcing them into one contract would make both harder to reason about and audit. Both factories share the same underlying Merkle-claim and fee-treasury library code so that logic is audited once, not twice.

### 12.4 Data Model & Contract Interfaces (delta from SHO)

```solidity
struct Epoch {
    uint256 epochIndex;
    uint16  rewardBps;
    bool    finalized;
    bytes32 merkleRoot;         // provisional until challengeWindowEnds, then final
    bytes32 snapshotHash;
    uint256 endsAt;              // epoch window close
    uint256 challengeWindowEnds; // endsAt (or last correction) + 24h
    uint256 totalClaimed;
}

struct ShillCampaign {
    uint256 id;
    address token;
    address creator;
    address rewardToken;         // token itself, address(0) for ETH, or an allowlisted stablecoin
    uint256 totalLocked;         // net of the 0.5% protocol fee
    string  keyword;              // tracked keyword/hashtag/cashtag, immutable after creation
    EpochLength epochLength;      // 24H | 7D | 30D
    uint16  leaderboardSize;      // 50 | 100 | 500
    uint256 duration;             // 7D | 30D | 90D
    uint256 createdAt;
    Epoch[] epochs;               // rewardBps across all epochs must sum to 10,000
    CampaignStatus status;
}
```

Functions mirror §10 directly: `createCampaign(token, rewardToken, amount, keyword, epochLength, leaderboardSize, duration, epochs[])`, `postEpochRoot(campaignId, epochIndex, merkleRoot, snapshotHash)` (keeper-only, identical challenge-window semantics to `postMilestoneRoot`), `claim(campaignId, epochIndex, amount, proof[])` (identical semantics to SHO's `claim`). Registration is a standalone call, not per-campaign: `registerHandle(xHandle, oauthProof)` links a wallet once and is reusable everywhere.

### 12.5 Economics & Parameters

| Parameter | Value(s) |
|---|---|
| Tracked keyword | One per campaign, creator-defined, immutable after creation |
| Epoch length | 24H / 7D / 30D |
| Leaderboard size | Top 50 / Top 100 / Top 500 |
| Campaign duration | 7D / 30D / 90D |
| Reward denomination | Campaign token, ETH, or USDC |
| Minimum account age | 30 days (MVP protocol-wide default) |
| Minimum followers | 25 (MVP protocol-wide default) |
| Max counted posts / account / epoch | 5 |
| Engagement score formula | `2×(retweets+quotes) + 1×replies + 0.5×likes` (MVP protocol-wide default, not yet per-campaign configurable) |
| Protocol fee | 0.5% of locked pool, taken at creation |
| Root challenge window | 24 hours, identical mechanism to SHO |

### 12.6 Risks & Mitigations (delta from §6)

| Risk | Description | Mitigation (MVP) | Future work |
|---|---|---|---|
| **Bot / fake-engagement farms** | A moderately resourced bot farm can still clear a 30-day/25-follower bar — the minimums are a floor, not a wall. | Minimum account age + followers; engagement weighted toward retweets/quotes over likes | Posting-cadence anomaly detection; incorporate platform-level bot signals if the X API exposes them |
| **Keyword squatting / collision** | An overly generic tracked keyword pulls in unrelated posts, diluting or gaming the leaderboard. | dApp warns the creator at campaign creation if the keyword matches an unusually high rate of unrelated existing posts | Keyword moderation/review tooling |
| **Registration spoofing** | A flawed OAuth/wallet-linking flow could misattribute a shiller's rewards. | Standard OAuth for the X side, on-chain signature confirmation for the wallet side | N/A — considered adequately mitigated for MVP |
| **Deleted/edited posts after scoring** | Not yet designed — see §13. | None | To be resolved before launch |
| **Keeper centralization, no-refund design** | Identical trade-offs to SHO (§6) | Same mitigations (published snapshot, challenge window) | Same roadmap (§7 Phase 2) |

### 12.7 Guide: Running & Participating in an SSO Campaign

**For creators:** pick a keyword specific enough to be attributable to your campaign but natural enough that people would actually use it unprompted — an overly obscure tag nobody adopts organically wastes the pool the same way an unrealistic SHO milestone does. Campaigns are immutable once created, same as SHO (§8.3).

**For shillers:** connect your X account and wallet once via the dApp — this covers every SSO campaign you ever participate in, not just one. Post using the campaign's exact keyword while it's active; check your live epoch score and rank on the campaign page. After each epoch closes and its 24-hour challenge window elapses, claim exactly as you would an SHO reward (§9.5) — connect wallet, dApp fetches your Merkle proof, submit `claim()`.

### 12.8 FAQ additions

**Do I need to re-link my X account for every campaign?**
No — one registration covers every SSO campaign your wallet participates in.

**What if I posted the keyword before the campaign existed?**
It doesn't count. Only posts inside an active epoch's window are scored.

**Can a campaign track more than one keyword?**
No, one keyword per campaign in this version — run multiple campaigns if you want to track variants.

---

# Shared

## 13. Open Questions / Out of Scope

**SHO**
- Should there be a claim deadline after a milestone's challenge window ends, and what happens to rewards nobody claims (revert to creator? stay locked forever, like an unreached milestone)?
- Who governs the stablecoin allowlist (currently USDC-only) and the process for adding to it?
- Exact visual UI/UX mockups for campaign creation and claiming — the guides in §8–§9 describe the flow, not the pixel-level design.
- Whether the protocol fee (0.5%) should be adjustable per-campaign or governance-controlled over time.
- Multi-wallet (sybil) wash trading is explicitly unmitigated in the MVP (§6) — what threshold of abuse would justify prioritizing Phase 2's clustering heuristics sooner?

**SSO**
- What happens if a qualifying post is deleted, edited, or made private after the epoch snapshot is taken but before the challenge window closes? (§12.6)
- Should the engagement scoring formula, or the minimum account age/follower thresholds, become creator-configurable rather than protocol-wide?
- Multi-platform expansion (Telegram, Discord, etc.) beyond X/Twitter — deferred, not designed.
- Same claim-deadline question as SHO applies to unclaimed epoch rewards.

**Shared across both**
- Smart contract audit vendor and budget — not yet determined for either `SHOCampaign.sol`/`SHOFactory.sol` or `SSOCampaign.sol`/`SSOFactory.sol`.
- Legal/regulatory classification of the reward mechanism — not yet reviewed, and SSO's "reward for promotion" framing may raise different (securities/advertising-disclosure-adjacent) questions than SHO's trading-based framing.
