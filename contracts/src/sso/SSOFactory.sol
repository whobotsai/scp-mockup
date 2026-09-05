// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {FactoryBase} from "../base/FactoryBase.sol";
import {Types} from "../libraries/Types.sol";
import {SSOCampaign} from "./SSOCampaign.sol";

/// @title SSOFactory
/// @notice Deploys Strong Shill Offering campaigns as EIP-1167 minimal proxy clones of a
/// single SSOCampaign implementation (PRD.md §12.3) — a separate sibling factory from SHO,
/// sharing only the library code (PRD §12.3's stated rationale).
contract SSOFactory is FactoryBase {
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
        uint256 totalLocked,
        string keyword
    );

    constructor(address initialOwner, address initialTreasury, address initialKeeper)
        FactoryBase(initialOwner, initialTreasury, initialKeeper)
    {
        implementation = address(new SSOCampaign());
    }

    function campaignsCount() external view returns (uint256) {
        return campaigns.length;
    }

    function createCampaign(
        address token,
        address rewardToken,
        uint256 amount,
        string calldata keyword,
        Types.EpochLength epochLength,
        uint16 leaderboardSize,
        uint256 duration,
        uint16[] calldata epochRewardBpsList
    ) external payable returns (address campaign) {
        require(amount > 0, "amount=0");
        require(bytes(keyword).length > 0, "keyword required");
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
        SSOCampaign(payable(campaign)).initialize(
            campaignId, token, msg.sender, rewardToken, net, keyword, epochLength, leaderboardSize, duration, epochRewardBpsList
        );
        campaigns.push(campaign);

        emit CampaignCreated(campaignId, campaign, msg.sender, token, rewardToken, net, keyword);
    }

    function _sendETH(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }
}
