// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {FactoryBase} from "../base/FactoryBase.sol";
import {Types} from "../libraries/Types.sol";
import {SHOCampaign} from "./SHOCampaign.sol";

/// @title SHOFactory
/// @notice Deploys Strong Hold Offering campaigns as EIP-1167 minimal proxy clones of a
/// single SHOCampaign implementation (PRD.md §3.1). Handles fund custody and the protocol
/// fee split at creation time, before the new clone is ever initialized.
contract SHOFactory is FactoryBase {
    using SafeERC20 for IERC20;

    address public immutable implementation;

    uint256 public nextId;
    address[] public campaigns;

    event CampaignCreated(
        uint256 indexed id,
        address indexed campaign,
        address indexed creator,
        address token,
        address rewardToken,
        uint256 totalLocked
    );

    constructor(address initialOwner, address initialTreasury, address initialKeeper)
        FactoryBase(initialOwner, initialTreasury, initialKeeper)
    {
        // Deployed from within this constructor so SHOCampaign's own constructor sees
        // msg.sender == this factory's address (see SHOCampaign.sol).
        implementation = address(new SHOCampaign());
    }

    function campaignsCount() external view returns (uint256) {
        return campaigns.length;
    }

    /// @param token The campaigning token the keeper's price/TWAP oracle tracks off-chain.
    /// @param rewardToken address(0) for native ETH, the campaign token itself, or an
    /// allowlisted stablecoin (PRD §5 — the allowlist is an off-chain/governance policy,
    /// not enforced by this contract; see PRD §13).
    /// @param amount Gross amount to lock, before the 0.5% protocol fee.
    function createCampaign(
        address token,
        address rewardToken,
        uint256 amount,
        Types.LeaderboardWindow window,
        uint16 leaderboardSize,
        uint256 duration,
        Types.MilestoneTier[] calldata tiers,
        uint16[] calldata rewardBpsList
    ) external payable returns (address campaign) {
        require(amount > 0, "amount=0");
        require(leaderboardSize == 50 || leaderboardSize == 100 || leaderboardSize == 500, "bad leaderboard size");
        require(duration == 7 days || duration == 30 days || duration == 90 days, "bad duration");

        (uint256 fee, uint256 net) = _splitFee(amount);

        campaign = Clones.clone(implementation);

        if (rewardToken == address(0)) {
            require(msg.value == amount, "bad msg.value");
            _sendETH(treasury, fee);
            _sendETH(campaign, net);
        } else {
            require(msg.value == 0, "unexpected msg.value");
            IERC20(rewardToken).safeTransferFrom(msg.sender, treasury, fee);
            IERC20(rewardToken).safeTransferFrom(msg.sender, campaign, net);
        }

        uint256 campaignId = nextId++;
        SHOCampaign(payable(campaign)).initialize(
            campaignId, token, msg.sender, rewardToken, net, window, leaderboardSize, duration, tiers, rewardBpsList
        );
        campaigns.push(campaign);

        emit CampaignCreated(campaignId, campaign, msg.sender, token, rewardToken, net);
    }

    function _sendETH(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }
}
