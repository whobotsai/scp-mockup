// Minimal hand-picked ABIs — just the pieces the Campaign Indexer / Milestone Engine (and
// scripts/post-milestone-root.js, scripts/claim-milestone.js) need, not the full contract
// interface. Kept here instead of importing ../../contracts/build/*.json so this package has
// no dependency on the contracts package's local (gitignored) build output.
"use strict";

const SHO_FACTORY_ABI = [
  "event CampaignCreated(uint256 indexed id, address indexed campaign, address indexed creator, address token, address rewardToken, uint256 totalLocked)",
];

const SHO_CAMPAIGN_ABI = [
  "function window() view returns (uint8)",
  "function duration() view returns (uint256)",
  "function leaderboardSize() view returns (uint16)",
  "function createdAt() view returns (uint256)",
  "function totalLocked() view returns (uint256)",
  "function milestoneCount() view returns (uint256)",
  "function getMilestone(uint256 index) view returns (tuple(uint8 tier, uint16 rewardBps, bool reached, bytes32 merkleRoot, bytes32 snapshotHash, uint256 reachedAt, uint256 challengeWindowEnds, uint256 totalClaimed))",
  "function postMilestoneRoot(uint256 milestoneIndex, bytes32 merkleRoot, bytes32 snapshotHash) external",
  // Confirmed live: scripts/claim-milestone.js reused this ABI to call campaign.claim(...) and
  // hit "campaign.claim is not a function" -- this fragment was simply never added, since
  // nothing in the keeper's own polling loop calls claim (only a claimant's own wallet does,
  // via this script). Signature matches SHOCampaign.sol's claim(uint256,uint256,bytes32[]).
  "function claim(uint256 milestoneIndex, uint256 amount, bytes32[] calldata proof) external",
];

// Mirrors contracts/src/libraries/Types.sol's LeaderboardWindow enum ordering.
const WINDOW_SECONDS = [24 * 60 * 60, 7 * 24 * 60 * 60, 30 * 24 * 60 * 60];

// Mirrors contracts/src/libraries/Types.sol's MilestoneTier enum ordering (PRD §5: "exactly
// these four fixed tiers ... not free-form").
const MILESTONE_USD_THRESHOLDS = [100_000, 250_000, 1_000_000, 5_000_000];

module.exports = { SHO_FACTORY_ABI, SHO_CAMPAIGN_ABI, WINDOW_SECONDS, MILESTONE_USD_THRESHOLDS };
