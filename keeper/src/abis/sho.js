// Minimal hand-picked ABIs — just the pieces the Campaign Indexer needs, not the full
// contract interface. Kept here instead of importing ../../contracts/build/*.json so this
// package has no dependency on the contracts package's local (gitignored) build output.
"use strict";

const SHO_FACTORY_ABI = [
  "event CampaignCreated(uint256 indexed id, address indexed campaign, address indexed creator, address token, address rewardToken, uint256 totalLocked)",
];

const SHO_CAMPAIGN_ABI = [
  "function window() view returns (uint8)",
  "function duration() view returns (uint256)",
  "function leaderboardSize() view returns (uint16)",
  "function createdAt() view returns (uint256)",
];

// Mirrors contracts/src/libraries/Types.sol's LeaderboardWindow enum ordering.
const WINDOW_SECONDS = [24 * 60 * 60, 7 * 24 * 60 * 60, 30 * 24 * 60 * 60];

module.exports = { SHO_FACTORY_ABI, SHO_CAMPAIGN_ABI, WINDOW_SECONDS };
