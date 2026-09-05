# Strong Commitment Protocol

### A Growth-Aligned Alternative to Token Burning and Locking on Bonding-Curve Launchpads

**Whitepaper — Draft v1**
**Network:** Robinhood Chain (Arbitrum Orbit, chain ID 4663)
**Reference launchpad integration:** Pons.family

---

## Abstract

Token launchpads built on bonding curves have converged on two supply-commitment primitives available to a token's deployer or large holders: burning (permanent, unconditional destruction of tokens) and vesting locks (temporary, unconditional withholding of tokens). We argue both are costly signals in the sense of Spence [1] — they are credible precisely because faking them is expensive — but neither is a *productive* signal: neither one is contingent on, or rewards, the behavior that actually determines whether a token survives past its launch window. We introduce the **Strong Commitment Protocol**, which preserves the costly-signal property of burning (an unsuccessful commitment is destroyed exactly as if it had been burned) while making a successful commitment pay out to the participants who produced the outcome. The protocol ships two campaign primitives: **Strong Hold Offering (SHO)**, which conditions payout on a token's market capitalization and rewards net-buying activity, and **Strong Shill Offering (SSO)**, which conditions payout on a fixed schedule and rewards measured social amplification. We give a formal specification of both mechanisms, describe the trust-minimized architecture used to compute off-chain data (trading activity, social engagement) and post it on-chain, analyze the incentive properties and residual attack surface of each mechanism, and disclose the trade-offs accepted in this version of the design.

---

## 1. Introduction

### 1.1 Background

A bonding-curve launchpad — the reference implementation being Pons.family on Robinhood Chain — allows any party to deploy a token with no code, priced algorithmically against a curve until it accumulates enough liquidity to migrate ("graduate") to a conventional AMM pool (Uniswap V4). This launch model produces very high token creation velocity and correspondingly high attrition: the majority of listed tokens receive concentrated initial attention and then are abandoned within days once no mechanism continues to incentivize participation.

### 1.2 The commitment-signal problem

Against this attrition, a creator or large holder has historically had two available moves to signal commitment to a token's success:

- **Burn.** An amount of the token is sent to an unspendable address. This is *unconditional and irreversible*: it happens once, at a moment chosen by the actor, and is disconnected from anything that happens to the token afterward.
- **Vesting lock.** An amount of the token is held by a contract that releases it back to the actor after a fixed schedule. This is *unconditional and reversible on a public timer*: the release block is known in advance, market participants position around it, and the token predictably depreciates as the unlock approaches — the lock does not prevent the eventual sale, it schedules it publicly.

Both are what Spence [1] terms costly signals: they are credible specifically because they cost the signaler something they cannot recover by cheating. Burning is the cleaner signal of the two (its cost is permanent and can't be gamed), which is precisely why it also carries **no productive value** — the cost is paid, but nothing is bought with it. Locking is a weaker signal (the cost is only temporary, and the market prices in its eventual reversal) while being no more productive than burning.

Neither primitive is *contingent*: neither one's cost is a function of whether the token actually achieves the growth the signal was ostensibly meant to support, and neither rewards the specific participant behavior — sustained buying, sustained public amplification — that would make growth more likely.

### 1.3 Design goal

The Strong Commitment Protocol is designed to satisfy three properties simultaneously:

1. **Signal credibility no worse than burning.** In the failure case, the outcome for the committing party must be identical to a burn: total, permanent, irrecoverable loss of the committed tokens. This preserves the costly-signal property — nothing about this mechanism can be gamed to make failure cheaper than a real burn would have been.
2. **Contingent productivity.** In the success case, the committed tokens must be transferred to participants whose measurable behavior plausibly caused or accompanied that success, rather than reverting to the committing party or disappearing.
3. **No dilution.** The reward pool must be a redirection of tokens the committing party already controlled and was willing to give up (as they would have to a burn), never a newly minted or emitted supply. The protocol introduces no inflation.

---

## 2. Related Mechanisms

| Mechanism | Cost is permanent? | Contingent on outcome? | Rewards specific behavior? | Dilutive? |
|---|---|---|---|---|
| Burn | Yes | No | No | No |
| Vesting lock | No (temporary) | No | No | No |
| Liquidity mining / staking rewards | N/A (paid by emissions) | Sometimes (APY-linked) | Yes (liquidity provision or staking) | **Yes** — funded by new emissions |
| **Strong Hold Offering** | Yes, on failure | **Yes** — mcap milestones | **Yes** — net-buy volume | No |
| **Strong Shill Offering** | Yes, on failure (per epoch) | Partially — scheduled, not outcome-gated | **Yes** — measured social engagement | No |

Liquidity mining and staking-rewards programs are the closest prior art to SHO/SSO in that they pay participants for specific behavior, but they are typically funded by new token emissions, which dilutes existing holders — a cost SHO and SSO do not impose, since their reward pools are drawn from a fixed prior commitment rather than ongoing issuance.

---

## 3. The Strong Commitment Protocol: Formal Mechanism

### 3.1 Notation

| Symbol | Meaning |
|---|---|
| $P(t)$ | Token price at time $t$ |
| $S$ | Total token supply, as reported on-chain (circulating supply is not netted of locked/vesting amounts in this version) |
| $M(t) = P(t) \cdot S$ | Market capitalization at time $t$ |
| $\mathrm{TWAP}_{30}(t) = \frac{1}{30}\int_{t-30}^{t} P(\tau)\, d\tau$ | 30-minute time-weighted average price ending at $t$ (discretized over on-chain trade events in the implementation) |
| $B_i(w,t)$, $Q_i(w,t)$ | Total USD-equivalent bought / sold by wallet $i$ in window $w$ ending at $t$, each leg valued at its own execution price |
| $\mathrm{NBV}_i(w,t) = B_i(w,t) - Q_i(w,t)$ | Net-buy volume of wallet $i$ |
| $L_k$ | The set of eligible participants for tier/epoch $k$ (i.e., the top-$N$ ranked, non-negative-score participants) |
| $R_k$ | Total reward allocated to tier/epoch $k$ (a fraction of the campaign's locked pool $\Pi$, $R_k = \mathrm{bps}_k \cdot \Pi / 10{,}000$) |

### 3.2 Strong Hold Offering (SHO)

**Campaign parameterization.** A campaign is a tuple $C = (\Pi, \tau, w, N, D, \{(\mu_k, \mathrm{bps}_k)\}_{k=1}^{K})$: locked pool $\Pi$ (net of protocol fee), reward token $\tau$, leaderboard window $w \in \{24H, 7D, 30D\}$, leaderboard size $N \in \{50, 100, 500\}$, campaign duration $D \in \{7D, 30D, 90D\}$, and a set of milestones, each a market-cap threshold $\mu_k$ from the fixed set $\{100K, 250K, 1M, 5M\}$ paired with a basis-point allocation $\mathrm{bps}_k$, subject to $\sum_k \mathrm{bps}_k = 10{,}000$.

**Milestone confirmation.** Milestone $k$ is confirmed reached at the first time $t^*_k$ such that $\mathrm{TWAP}_{30}(t) \geq \mu_k$ holds continuously over $[t^*_k - 30\text{min}, t^*_k]$. Confirmation is a one-way predicate: once reached, milestone $k$ remains reached for the life of the campaign regardless of subsequent price movement — the protocol does not define an "un-reaching" transition.

**Reward allocation.** At $t^*_k$, the eligible set is
$$L_k = \text{top-}N \text{ wallets by } \mathrm{NBV}_i(w, t^*_k) \text{ among wallets with } \mathrm{NBV}_i(w,t^*_k) \geq 0$$
and each eligible wallet's reward is
$$r_i = R_k \cdot \frac{\mathrm{NBV}_i(w,t^*_k)}{\sum_{j \in L_k} \mathrm{NBV}_j(w,t^*_k)}$$
Wallets with $\mathrm{NBV}_i < 0$ (net sellers over the window) are excluded from $L_k$ entirely, not assigned zero.

**Terminal condition.** If, at $t_0 + D$ (campaign creation time plus duration), some milestone $k$ has never satisfied its confirmation predicate, $R_k$ is never computed or made claimable, and the corresponding fraction of $\Pi$ remains locked in the campaign contract permanently. No function exists in the protocol to reclaim it.

### 3.3 Strong Shill Offering (SSO)

**Campaign parameterization.** A campaign is a tuple $C' = (\Pi, \tau, \kappa, e, N, D, \{(\mathrm{bps}_1, ..., \mathrm{bps}_{\lfloor D/e \rfloor})\})$: locked pool $\Pi$, reward token $\tau$, a single tracked keyword $\kappa$, epoch length $e \in \{24H, 7D, 30D\}$, leaderboard size $N \in \{50, 100, 500\}$, and campaign duration $D$, which determines the number of epochs $\lfloor D/e \rfloor$.

**Eligibility.** An account $a$ must be registered — i.e., have a verified bijective mapping to a wallet address via OAuth — and must satisfy $\mathrm{age}(a) \geq 30\text{ days}$ and $\mathrm{followers}(a) \geq 25$. A post $p$ by an eligible account qualifies for epoch $n$ if it contains $\kappa$ verbatim and its timestamp falls within epoch $n$'s window. At most 5 qualifying posts per account are counted per epoch (the top 5 by individual post score).

**Scoring.** For a qualifying post $p$ with retweet count $\mathrm{RT}(p)$, quote-tweet count $\mathrm{QT}(p)$, reply count $\mathrm{Re}(p)$, and like count $\mathrm{Li}(p)$:
$$\mathrm{score}(p) = 2\big(\mathrm{RT}(p) + \mathrm{QT}(p)\big) + \mathrm{Re}(p) + 0.5\,\mathrm{Li}(p)$$
An account's epoch score is $\mathrm{Score}_a(n) = \sum_{p \in \mathrm{top}_5(a,n)} \mathrm{score}(p)$. This weighting is a protocol-wide MVP default, not yet campaign-configurable; it weights retweets and quote-tweets most heavily on the premise that they are the costliest form of engagement to fabricate cheaply at scale, relative to likes.

**Payout.** At the end of epoch $n$, the eligible set $L_n$ is the top-$N$ accounts by $\mathrm{Score}_a(n)$ among accounts with $\mathrm{Score}_a(n) > 0$, and each account's reward is
$$r_a = R_n \cdot \frac{\mathrm{Score}_a(n)}{\sum_{b \in L_n} \mathrm{Score}_b(n)}$$

**Terminal condition.** If $L_n = \emptyset$ for some epoch $n$ (no qualifying posts that epoch), $R_n$ is never allocated and that fraction of $\Pi$ locks permanently — structurally identical to an SHO milestone that is never reached.

---

## 4. System Architecture

### 4.1 On-chain layer

Both mechanisms deploy campaigns as gas-efficient EIP-1167 minimal proxy clones from a factory contract (`SHOFactory.sol` / `SSOFactory.sol`), each clone (`SHOCampaign.sol` / `SSOCampaign.sol`) acting as an isolated escrow holding $\Pi$ and enforcing the terminal conditions above. Both contract families share common library code for Merkle-proof verification and protocol-fee handling, so that logic is audited once rather than twice.

### 4.2 Off-chain layer

Neither mechanism's ranking computation ($\mathrm{NBV}_i$ over on-chain trades; $\mathrm{Score}_a$ over off-chain social posts) is computable trustlessly on-chain at the gas costs required for a launchpad-scale product. Both therefore rely on an off-chain **keeper**: an indexer (of on-chain swap events for SHO, of the X API for SSO) that computes the eligible set and reward allocation, and a $k$-of-$n$ multi-signature wallet (reference implementation: 3-of-5 Gnosis Safe) that posts the result on-chain as a Merkle root.

### 4.3 Trust-minimization: the challenge window

A Merkle proof establishes that a specific leaf (wallet, reward amount) is a member of a posted root; it establishes nothing about whether that root was computed correctly from the true underlying activity data. To narrow this gap without requiring a fully trustless computation (out of scope for this version — see §7), the protocol adopts a **procedural verification window**: a posted root is *provisional* for 24 hours, during which the keeper also publishes the full snapshot data used to compute it (off-chain, content-addressed, with the hash referenced on-chain), so that any party can independently recompute the root and flag a discrepancy. If the keeper finds and corrects an error within the window, the correction restarts the window; `claim()` is gated on the window having elapsed without further correction. This is explicitly a **social/procedural** safeguard, not a cryptographic one — it reduces the probability that an erroneous or malicious root reaches finality undetected, but it does not remove the underlying trust placed in the keeper multi-sig (§5.3).

---

## 5. Security and Incentive Analysis

### 5.1 Why the terminal condition preserves costly-signal credibility

Consider a rational actor deciding between burning $\Pi$ tokens and opening a Strong Commitment Protocol campaign with the same $\Pi$. Let $\pi$ be the actor's honest subjective probability that the token reaches at least one configured milestone/epoch payout condition. Burning yields a certain, fixed cost of $\Pi$ with no state-contingent payoff. A Strong Commitment Protocol campaign yields the identical cost $\Pi$ in the failure branch (probability $1-\pi$) and, in the success branch (probability $\pi$), transfers value to third parties whose actions plausibly increased $\pi$ itself — a pool the actor was, by construction, already willing to lose entirely. For any $\pi > 0$, opening a campaign weakly dominates burning from the actor's perspective, and strictly dominates it whenever the actor believes the reward structure itself raises $\pi$ (which is the mechanism's entire premise). Critically, this dominance argument does not weaken the signal an external observer reads from the failure branch: since the failure-branch outcome is bit-for-bit identical to a burn (funds are provably inaccessible to any party, including the actor, forever), an external observer cannot distinguish "this actor burned tokens" from "this actor opened a campaign that failed" — the signal's credibility is preserved exactly, while its expected productive value is strictly higher.

### 5.2 Wash-trading and engagement-farming resistance

**SHO.** Net-buy-volume weighting is sufficient to defeat the simplest attack — a single wallet trading back and forth with itself contributes $\mathrm{NBV}_i \approx 0$ regardless of gross turnover. It is **not** sufficient to defeat a two-wallet split (buy on wallet $A$, offsetting sell on wallet $B$, both controlled by the same actor), since $\mathrm{NBV}_A$ remains fully intact under this construction. Combined with the absence of a per-wallet cap in this version, a well-resourced actor can legitimately dominate a leaderboard tier. This is an accepted, disclosed limitation of the MVP (§7), not an oversight.

**SSO.** The account-age and follower-count minimums raise the fixed cost of a Sybil attack (each qualifying identity requires an aged, moderately-followed account) but do not bound it — a sufficiently resourced actor can acquire or age enough qualifying accounts to dominate an epoch's leaderboard. The scoring formula's weighting toward retweets/quote-tweets over likes raises marginal cost further (these are individually harder to fabricate at scale than a like) without eliminating the attack.

### 5.3 Residual oracle trust

The keeper multi-sig remains a single point of trust for both mechanisms: it alone determines what counts as a qualifying trade or post, and while the challenge window (§4.3) allows third-party detection of an incorrect root, detection depends on someone actually performing the recomputation within the window, and correction depends on the keeper itself choosing to act on a flagged discrepancy — there is no protocol-level mechanism in this version by which a non-keeper party can force a correction. This is the protocol's most significant unresolved trust assumption, and Phase 2 of the roadmap (§8) targets it directly via a permissionless, bonded dispute mechanism.

### 5.4 TWAP manipulation

SHO's use of a 30-minute time-weighted average, rather than spot price, for milestone confirmation raises the capital and time cost of a flash-pump attack roughly in proportion to the window length, since an attacker must sustain an elevated price against organic sell pressure for the full window rather than a single block. It does not make manipulation impossible, only costly; a sufficiently capitalized actor with a sufficiently valuable milestone can still, in principle, sustain a 30-minute pump. The one-way nature of milestone confirmation (§3.2) means such an attack, if successful, permanently and irreversibly unlocks the associated reward tier — there is no subsequent correction mechanism for a milestone confirmed via manipulated price action, only for an incorrectly computed leaderboard root within an already-confirmed milestone.

---

## 6. Economic Model

The protocol takes a flat **0.5% fee** on $\Pi$ at campaign creation, denominated in whatever asset is locked, routed to a protocol treasury. This treasury funds the keeper's on-chain gas costs for posting roots, so that neither campaign creators nor claimants bear keeper operating costs directly. The protocol issues no native token in this version: there is no emission schedule, no governance token, and no mechanism by which protocol usage is diluted. Revenue accrues to the treasury exclusively through the creation fee.

---

## 7. Risk Disclosure

This section summarizes, at a formal level, the risks documented in full detail in the accompanying technical specification (`PRD.md`, §6 and §12.6):

1. **Keeper centralization.** Both mechanisms depend on a trusted multi-signature operator for off-chain computation. The challenge window is a mitigation, not a resolution, of this dependency.
2. **Multi-identity Sybil resistance is bounded, not absolute**, for both net-buy-volume weighting (SHO) and account-age/follower minimums (SSO), as analyzed in §5.2.
3. **No per-participant reward cap** exists in this version for either mechanism; a single well-resourced participant can legitimately capture a disproportionate share of any tier or epoch.
4. **Irrecoverable creator loss.** A campaign creator who configures an unreachable milestone or an epoch schedule with little organic participation loses the corresponding locked value permanently, with no recourse — this is the mechanism's core design property (§5.1), not a failure mode, but it should be understood as a real and irreversible financial risk by any party opening a campaign.
5. **Regulatory characterization is unresolved.** A mechanism that distributes value contingent on ranking against other participants and a market-linked or schedule-linked threshold may be characterized differently across jurisdictions; this whitepaper does not constitute legal advice and no jurisdiction-specific analysis has been performed as of this draft.
6. **Smart contract risk.** Neither contract family has undergone third-party audit as of this draft; both should be treated as unaudited pre-production code.

---

## 8. Roadmap

**Phase 1 (MVP).** The mechanisms as formally specified in §3, with a single trusted keeper multi-sig, protocol-wide (non-configurable) scoring parameters, and no per-participant caps.

**Phase 2 (Hardening).** A permissionless, bonded dispute mechanism replacing keeper-only root correction (addressing §5.3); optional creator-configurable per-wallet/per-account caps (addressing §5.2); expansion of the reward-token allowlist; third-party smart contract audit; formal legal/regulatory review (addressing §7.5).

**Phase 3 (Expansion).** Support for additional launchpads, DEX venues, chains, and — for SSO — additional social platforms beyond X/Twitter.

---

## 9. Conclusion

Burning and locking are the dominant costly signals available to token creators today, and both are, by construction, unproductive: their cost is paid regardless of outcome, and neither rewards the participant behavior that would make a favorable outcome more likely. The Strong Commitment Protocol shows that this need not be a trade-off — a mechanism can preserve a burn's exact failure-branch severity (and therefore its full signaling credibility) while converting the success branch from a wasted cost into a targeted, non-dilutive payment to the traders (SHO) or amplifiers (SSO) whose measurable behavior accompanied that success. The principal open engineering problem this version leaves unresolved is oracle trust: both mechanisms currently depend on a keeper multi-sig for off-chain computation, mitigated but not eliminated by a procedural challenge window. Closing that gap without sacrificing the mechanism's practicality is the primary objective of the protocol's next phase.

---

## References

[1] Spence, M. (1973). "Job Market Signaling." *The Quarterly Journal of Economics*, 87(3), 355–374. — foundational treatment of costly signaling, applied here by analogy to token-supply commitment rather than labor markets.

---

## Appendix: Relationship to the Technical Specification

This whitepaper presents the protocol's formal mechanism and economic reasoning. It intentionally omits implementation-level detail — contract function signatures, custom error conditions, event schemas, step-by-step creator/participant guides, and a full glossary — all of which are maintained in the companion document, `PRD.md`, in this same directory. Where the two documents could be read as describing different behavior, `PRD.md` is authoritative for implementation, and this document is authoritative for the protocol's intended economic and game-theoretic properties.

---

*This document is a technical and economic description of a protocol design. It is not investment advice, an offer to sell securities, or a solicitation in any jurisdiction. Parameters, formulas, and roadmap items described here are subject to change prior to any production deployment.*
