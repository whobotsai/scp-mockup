// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ClaimVerifier} from "../libraries/ClaimVerifier.sol";
import {Types} from "../libraries/Types.sol";

interface IKeeperSource {
    function keeper() external view returns (address);
}

/// @title SHOCampaign
/// @notice Per-campaign escrow for a Strong Hold Offering. Deployed as an EIP-1167 minimal
/// proxy clone by SHOFactory (PRD.md §3.1, §4). One clone per campaign — this contract's own
/// address IS the campaign's identity, so unlike the PRD's illustrative function table this
/// implementation's claim()/postMilestoneRoot() don't take a redundant campaignId parameter;
/// the off-chain API layer tracks which clone address corresponds to which campaign id.
contract SHOCampaign {
    using SafeERC20 for IERC20;

    uint256 public constant CHALLENGE_WINDOW = 24 hours; // PRD §5
    uint16 public constant MAX_MILESTONES = 4; // exactly the four tiers in PRD §4.1/§5

    /// @dev Set once, in the implementation contract's own constructor. Every clone shares
    /// this same value because a clone executes the implementation's runtime bytecode via
    /// delegatecall — this is the standard "immutable shared by all clones" pattern.
    address public immutable factory;

    struct Milestone {
        Types.MilestoneTier tier;
        uint16 rewardBps;
        bool reached; // one-way: never flips back once true (PRD §4.1)
        bytes32 merkleRoot;
        bytes32 snapshotHash;
        uint256 reachedAt;
        uint256 challengeWindowEnds;
        uint256 totalClaimed;
    }

    bool public initialized;
    uint256 public id;
    address public token; // the campaigning token the keeper's TWAP oracle tracks off-chain
    address public creator;
    address public rewardToken; // address(0) = native ETH
    uint256 public totalLocked; // net of the protocol fee (PRD §4.1)
    Types.LeaderboardWindow public window;
    uint16 public leaderboardSize;
    uint256 public duration;
    uint256 public createdAt;

    Milestone[] private _milestones;
    mapping(uint256 => mapping(address => bool)) public claimed; // milestoneIndex => account => claimed

    event MilestoneReached(uint256 indexed milestoneIndex, uint256 reachedAt);
    event RootPosted(
        uint256 indexed milestoneIndex, bytes32 merkleRoot, bytes32 snapshotHash, uint256 challengeWindowEnds
    );
    event RootCorrected(
        uint256 indexed milestoneIndex, bytes32 merkleRoot, bytes32 snapshotHash, uint256 challengeWindowEnds
    );
    event RewardClaimed(uint256 indexed milestoneIndex, address indexed account, uint256 amount);

    modifier onlyFactory() {
        require(msg.sender == factory, "not factory");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == IKeeperSource(factory).keeper(), "not keeper");
        _;
    }

    constructor() {
        // Deployed by SHOFactory's own constructor, so msg.sender here is the factory
        // itself — see SHOFactory.sol.
        factory = msg.sender;
    }

    /// @notice Called once by the factory immediately after cloning and funding this
    /// contract. `totalLocked_` must already sit in this contract's balance (native ETH)
    /// or token balance (ERC20) by the time this runs — the factory moves funds first.
    function initialize(
        uint256 id_,
        address token_,
        address creator_,
        address rewardToken_,
        uint256 totalLocked_,
        Types.LeaderboardWindow window_,
        uint16 leaderboardSize_,
        uint256 duration_,
        Types.MilestoneTier[] calldata tiers,
        uint16[] calldata rewardBpsList
    ) external onlyFactory {
        require(!initialized, "already initialized");
        require(tiers.length > 0 && tiers.length <= MAX_MILESTONES, "bad milestone count");
        require(tiers.length == rewardBpsList.length, "length mismatch");

        uint256 sum;
        for (uint256 i = 0; i < tiers.length; i++) {
            // Tiers must be submitted in strictly increasing order — not explicit in the
            // PRD's illustrative struct, but it rules out a duplicate or out-of-order tier
            // list, which the product itself never intends to allow.
            if (i > 0) {
                require(uint8(tiers[i]) > uint8(tiers[i - 1]), "tiers must strictly increase");
            }
            sum += rewardBpsList[i];
            _milestones.push(
                Milestone({
                    tier: tiers[i],
                    rewardBps: rewardBpsList[i],
                    reached: false,
                    merkleRoot: bytes32(0),
                    snapshotHash: bytes32(0),
                    reachedAt: 0,
                    challengeWindowEnds: 0,
                    totalClaimed: 0
                })
            );
        }
        require(sum == 10_000, "bps must sum to 10000");

        initialized = true;
        id = id_;
        token = token_;
        creator = creator_;
        rewardToken = rewardToken_;
        totalLocked = totalLocked_;
        window = window_;
        leaderboardSize = leaderboardSize_;
        duration = duration_;
        createdAt = block.timestamp;
    }

    function milestoneCount() external view returns (uint256) {
        return _milestones.length;
    }

    function getMilestone(uint256 index) external view returns (Milestone memory) {
        return _milestones[index];
    }

    /// @notice Live-computed status — never depends on anyone remembering to call anything.
    function status() public view returns (Types.CampaignStatus) {
        bool allReached = true;
        for (uint256 i = 0; i < _milestones.length; i++) {
            if (!_milestones[i].reached) {
                allReached = false;
                break;
            }
        }
        if (allReached) return Types.CampaignStatus.Completed;
        if (block.timestamp > createdAt + duration) return Types.CampaignStatus.Expired;
        return Types.CampaignStatus.Active;
    }

    /// @notice Posts (or, within the still-open challenge window, corrects) the leaderboard
    /// snapshot for a milestone. Keeper-only (PRD §4.2). Resets the 24h challenge window on
    /// every call, and reverts if this milestone's window has already elapsed once reached
    /// — matching PRD §4.2's "Reverts if called after the window has already elapsed."
    function postMilestoneRoot(uint256 milestoneIndex, bytes32 merkleRoot, bytes32 snapshotHash)
        external
        onlyKeeper
    {
        Milestone storage m = _milestones[milestoneIndex];
        bool firstTime = !m.reached;
        require(firstTime || block.timestamp < m.challengeWindowEnds, "challenge window elapsed");

        m.merkleRoot = merkleRoot;
        m.snapshotHash = snapshotHash;
        m.challengeWindowEnds = block.timestamp + CHALLENGE_WINDOW;

        if (firstTime) {
            m.reached = true;
            m.reachedAt = block.timestamp;
            emit MilestoneReached(milestoneIndex, block.timestamp);
            emit RootPosted(milestoneIndex, merkleRoot, snapshotHash, m.challengeWindowEnds);
        } else {
            emit RootCorrected(milestoneIndex, merkleRoot, snapshotHash, m.challengeWindowEnds);
        }
    }

    /// @notice Claims `amount` of the reward token for `msg.sender` against milestone
    /// `milestoneIndex`'s finalized Merkle root. No withdraw/sweep path exists anywhere in
    /// this contract for a milestone that's never reached (PRD §2.4, §4.2, §6) — that
    /// portion of the pool simply stays locked here forever, by design.
    function claim(uint256 milestoneIndex, uint256 amount, bytes32[] calldata proof) external {
        Milestone storage m = _milestones[milestoneIndex];
        require(m.reached, "milestone not reached");
        require(block.timestamp >= m.challengeWindowEnds, "challenge window open");
        require(!claimed[milestoneIndex][msg.sender], "already claimed");
        require(ClaimVerifier.verify(proof, m.merkleRoot, msg.sender, amount), "bad proof");

        claimed[milestoneIndex][msg.sender] = true;
        m.totalClaimed += amount;

        _payout(msg.sender, amount);
        emit RewardClaimed(milestoneIndex, msg.sender, amount);
    }

    function _payout(address to, uint256 amount) private {
        if (rewardToken == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(rewardToken).safeTransfer(to, amount);
        }
    }

    receive() external payable {}
}
