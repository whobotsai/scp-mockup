// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared enums used by both the SHO and SSO contract families
/// (see PRD.md §4.1, §5, §12.4).
library Types {
    /// @dev SHO leaderboard trailing window and SSO epoch length share the same three
    /// choices (PRD §5, §12.5) but are kept as distinct enums so a campaign's config can't
    /// be accidentally passed to the wrong factory.
    enum LeaderboardWindow {
        H24,
        D7,
        D30
    }

    enum EpochLength {
        H24,
        D7,
        D30
    }

    enum CampaignStatus {
        Active,
        Completed,
        Expired
    }

    /// @dev Exactly these four fixed tiers, per PRD §4.1 and §5 — not free-form.
    enum MilestoneTier {
        M100K,
        M250K,
        M1M,
        M5M
    }
}
