// Minimal hand-picked ABI fragments this read-only API needs for live contract reads.
// Deliberately duplicated from keeper/src/abis/sho.js and sso.js rather than imported across
// packages -- same "each package is independently deployable, duplicate the small stuff"
// precedent this project already uses for its test harness (see keeper/test/helpers/harness.js
// and registration-service/test/helpers/harness.js). Keep in lockstep with those two files if
// either contract's interface changes.
"use strict";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

const SHO_CAMPAIGN_ABI = [
  "function token() view returns (address)",
  "function creator() view returns (address)",
  "function rewardToken() view returns (address)",
  "function duration() view returns (uint256)",
  "function leaderboardSize() view returns (uint16)",
  "function createdAt() view returns (uint256)",
  "function totalLocked() view returns (uint256)",
  "function milestoneCount() view returns (uint256)",
  "function getMilestone(uint256 index) view returns (tuple(uint8 tier, uint16 rewardBps, bool reached, bytes32 merkleRoot, bytes32 snapshotHash, uint256 reachedAt, uint256 challengeWindowEnds, uint256 totalClaimed))",
  "function claimed(uint256 milestoneIndex, address account) view returns (bool)",
  "event RewardClaimed(uint256 indexed milestoneIndex, address indexed account, uint256 amount)",
];

const SSO_CAMPAIGN_ABI = [
  "function token() view returns (address)",
  "function creator() view returns (address)",
  "function rewardToken() view returns (address)",
  "function keyword() view returns (string)",
  "function duration() view returns (uint256)",
  "function leaderboardSize() view returns (uint16)",
  "function createdAt() view returns (uint256)",
  "function totalLocked() view returns (uint256)",
  "function epochCount() view returns (uint256)",
  "function getEpoch(uint256 index) view returns (tuple(uint256 epochIndex, uint16 rewardBps, bool finalized, bytes32 merkleRoot, bytes32 snapshotHash, uint256 endsAt, uint256 challengeWindowEnds, uint256 totalClaimed))",
  "function claimed(uint256 epochIndex, address account) view returns (bool)",
  "event RewardClaimed(uint256 indexed epochIndex, address indexed account, uint256 amount)",
];

// Mirrors contracts/src/libraries/Types.sol's MilestoneTier enum ordering.
const MILESTONE_USD_THRESHOLDS = [100_000, 250_000, 1_000_000, 5_000_000];

module.exports = { ERC20_ABI, SHO_CAMPAIGN_ABI, SSO_CAMPAIGN_ABI, MILESTONE_USD_THRESHOLDS };
