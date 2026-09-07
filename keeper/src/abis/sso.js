// Minimal hand-picked ABIs for SSO -- same rationale as abis/sho.js: just the pieces the
// indexers/engine need, not the full contract interface, and no dependency on
// ../../contracts/build/*.json (gitignored local build output).
"use strict";

const SSO_FACTORY_ABI = [
  "event CampaignCreated(uint256 indexed id, address indexed campaign, address indexed creator, address token, address rewardToken, uint256 totalLocked, string keyword)",
];

const SSO_CAMPAIGN_ABI = [
  "function keyword() view returns (string)",
  "function epochLength() view returns (uint8)",
  "function duration() view returns (uint256)",
  "function leaderboardSize() view returns (uint16)",
  "function createdAt() view returns (uint256)",
  "function totalLocked() view returns (uint256)",
  "function epochCount() view returns (uint256)",
  "function getEpoch(uint256 index) view returns (tuple(uint256 epochIndex, uint16 rewardBps, bool finalized, bytes32 merkleRoot, bytes32 snapshotHash, uint256 endsAt, uint256 challengeWindowEnds, uint256 totalClaimed))",
  "function postEpochRoot(uint256 epochIndex, bytes32 merkleRoot, bytes32 snapshotHash) external",
];

const REGISTRY_ABI = [
  "event HandleRegistered(address indexed wallet, string xHandle)",
  "function handleOf(address wallet) view returns (string)",
];

// Mirrors contracts/src/libraries/Types.sol's EpochLength enum ordering.
const EPOCH_LENGTH_SECONDS = [24 * 60 * 60, 7 * 24 * 60 * 60, 30 * 24 * 60 * 60];

// PRD section 12.5's protocol-wide MVP defaults -- not yet per-campaign configurable.
const MIN_ACCOUNT_AGE_DAYS = 30;
const MIN_FOLLOWERS = 25;
const MAX_COUNTED_POSTS_PER_ACCOUNT_PER_EPOCH = 5;

module.exports = {
  SSO_FACTORY_ABI,
  SSO_CAMPAIGN_ABI,
  REGISTRY_ABI,
  EPOCH_LENGTH_SECONDS,
  MIN_ACCOUNT_AGE_DAYS,
  MIN_FOLLOWERS,
  MAX_COUNTED_POSTS_PER_ACCOUNT_PER_EPOCH,
};
