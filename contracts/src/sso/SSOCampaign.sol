// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ClaimVerifier} from "../libraries/ClaimVerifier.sol";
import {Types} from "../libraries/Types.sol";

interface IKeeperSource {
    function keeper() external view returns (address);
}

/// @title SSOCampaign
/// @notice Per-campaign escrow for a Strong Shill Offering. Deployed as an EIP-1167 minimal
/// proxy clone by SSOFactory (PRD.md §12.3-§12.4). Mirrors SHOCampaign's structure with
/// epochs (recurring, scheduled) in place of milestones (one-way, market-cap-gated) — kept
/// as a separate sibling contract rather than folded into SHOCampaign, per PRD §12.3's
/// rationale that the two state machines are different enough to make both harder to audit
/// if merged.
contract SSOCampaign {
    using SafeERC20 for IERC20;

    uint256 public constant CHALLENGE_WINDOW = 24 hours; // PRD §5, mirrored in §12.5

    address public immutable factory;

    struct Epoch {
        uint256 epochIndex;
        uint16 rewardBps;
        bool finalized; // one-way: never flips back once true
        bytes32 merkleRoot;
        bytes32 snapshotHash;
        uint256 endsAt; // scheduled epoch window close, fixed at initialize()
        uint256 challengeWindowEnds;
        uint256 totalClaimed;
    }

    bool public initialized;
    uint256 public id;
    address public token;
    address public creator;
    address public rewardToken; // address(0) = native ETH
    uint256 public totalLocked; // net of the protocol fee
    string public keyword; // tracked keyword/hashtag/cashtag, immutable after creation (PRD §12.4)
    Types.EpochLength public epochLength;
    uint16 public leaderboardSize;
    uint256 public duration;
    uint256 public createdAt;

    Epoch[] private _epochs;
    mapping(uint256 => mapping(address => bool)) public claimed; // epochIndex => account => claimed

    event EpochFinalized(uint256 indexed epochIndex, uint256 endsAt);
    event RootPosted(uint256 indexed epochIndex, bytes32 merkleRoot, bytes32 snapshotHash, uint256 challengeWindowEnds);
    event RootCorrected(
        uint256 indexed epochIndex, bytes32 merkleRoot, bytes32 snapshotHash, uint256 challengeWindowEnds
    );
    event RewardClaimed(uint256 indexed epochIndex, address indexed account, uint256 amount);

    modifier onlyFactory() {
        require(msg.sender == factory, "not factory");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == IKeeperSource(factory).keeper(), "not keeper");
        _;
    }

    constructor() {
        factory = msg.sender;
    }

    function initialize(
        uint256 id_,
        address token_,
        address creator_,
        address rewardToken_,
        uint256 totalLocked_,
        string calldata keyword_,
        Types.EpochLength epochLength_,
        uint16 leaderboardSize_,
        uint256 duration_,
        uint16[] calldata epochRewardBpsList
    ) external onlyFactory {
        require(!initialized, "already initialized");
        require(epochRewardBpsList.length > 0, "no epochs");
        require(bytes(keyword_).length > 0, "keyword required");

        uint256 epochSeconds = _epochSeconds(epochLength_);
        uint256 createdAt_ = block.timestamp;

        uint256 sum;
        for (uint256 i = 0; i < epochRewardBpsList.length; i++) {
            sum += epochRewardBpsList[i];
            _epochs.push(
                Epoch({
                    epochIndex: i,
                    rewardBps: epochRewardBpsList[i],
                    finalized: false,
                    merkleRoot: bytes32(0),
                    snapshotHash: bytes32(0),
                    endsAt: createdAt_ + epochSeconds * (i + 1),
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
        keyword = keyword_;
        epochLength = epochLength_;
        leaderboardSize = leaderboardSize_;
        duration = duration_;
        createdAt = createdAt_;
    }

    function epochCount() external view returns (uint256) {
        return _epochs.length;
    }

    function getEpoch(uint256 index) external view returns (Epoch memory) {
        return _epochs[index];
    }

    /// @notice Live-computed status — never depends on anyone remembering to call anything.
    function status() public view returns (Types.CampaignStatus) {
        bool allFinalized = true;
        for (uint256 i = 0; i < _epochs.length; i++) {
            if (!_epochs[i].finalized) {
                allFinalized = false;
                break;
            }
        }
        if (allFinalized) return Types.CampaignStatus.Completed;
        if (block.timestamp > createdAt + duration) return Types.CampaignStatus.Expired;
        return Types.CampaignStatus.Active;
    }

    /// @notice Posts (or, within the still-open challenge window, corrects) the leaderboard
    /// snapshot for an epoch. Keeper-only, identical challenge-window semantics to
    /// SHOCampaign.postMilestoneRoot (PRD §12.4). Can only be called once the epoch's
    /// scheduled window has actually closed.
    function postEpochRoot(uint256 epochIndex, bytes32 merkleRoot, bytes32 snapshotHash) external onlyKeeper {
        Epoch storage e = _epochs[epochIndex];
        require(block.timestamp >= e.endsAt, "epoch not yet ended");
        bool firstTime = !e.finalized;
        require(firstTime || block.timestamp < e.challengeWindowEnds, "challenge window elapsed");

        e.merkleRoot = merkleRoot;
        e.snapshotHash = snapshotHash;
        e.challengeWindowEnds = block.timestamp + CHALLENGE_WINDOW;

        if (firstTime) {
            e.finalized = true;
            emit EpochFinalized(epochIndex, e.endsAt);
            emit RootPosted(epochIndex, merkleRoot, snapshotHash, e.challengeWindowEnds);
        } else {
            emit RootCorrected(epochIndex, merkleRoot, snapshotHash, e.challengeWindowEnds);
        }
    }

    /// @notice Identical semantics to SHOCampaign.claim (PRD §12.4). No withdraw/sweep path
    /// exists for an epoch nobody qualified for — that share stays locked here forever.
    function claim(uint256 epochIndex, uint256 amount, bytes32[] calldata proof) external {
        Epoch storage e = _epochs[epochIndex];
        require(e.finalized, "epoch not finalized");
        require(block.timestamp >= e.challengeWindowEnds, "challenge window open");
        require(!claimed[epochIndex][msg.sender], "already claimed");
        require(ClaimVerifier.verify(proof, e.merkleRoot, msg.sender, amount), "bad proof");

        claimed[epochIndex][msg.sender] = true;
        e.totalClaimed += amount;

        _payout(msg.sender, amount);
        emit RewardClaimed(epochIndex, msg.sender, amount);
    }

    function _payout(address to, uint256 amount) private {
        if (rewardToken == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(rewardToken).safeTransfer(to, amount);
        }
    }

    function _epochSeconds(Types.EpochLength el) private pure returns (uint256) {
        if (el == Types.EpochLength.H24) return 1 days;
        if (el == Types.EpochLength.D7) return 7 days;
        return 30 days;
    }

    receive() external payable {}
}
