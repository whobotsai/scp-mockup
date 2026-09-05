// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Shared factory-level admin state for both SHOFactory and SSOFactory: the
/// protocol fee split (PRD §5 — 0.5% of the locked pool, taken at campaign creation) and
/// the keeper multi-sig address that every deployed campaign clone defers to for
/// postMilestoneRoot/postEpochRoot (PRD §3.2 — the keeper is explicitly the MVP's one
/// trusted component). Centralizing the keeper address here means rotating it updates
/// every existing campaign at once; nothing needs to be touched per-campaign.
abstract contract FactoryBase is Ownable {
    uint16 public constant PROTOCOL_FEE_BPS = 50; // 0.5%, PRD §5
    uint16 public constant BPS_DENOMINATOR = 10_000;

    address public treasury;
    address public keeper;

    event TreasuryUpdated(address indexed treasury);
    event KeeperUpdated(address indexed keeper);

    constructor(address initialOwner, address initialTreasury, address initialKeeper)
        Ownable(initialOwner)
    {
        require(initialTreasury != address(0), "treasury=0");
        require(initialKeeper != address(0), "keeper=0");
        treasury = initialTreasury;
        keeper = initialKeeper;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury=0");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setKeeper(address newKeeper) external onlyOwner {
        require(newKeeper != address(0), "keeper=0");
        keeper = newKeeper;
        emit KeeperUpdated(newKeeper);
    }

    /// @return fee The protocol's cut. @return net What actually gets escrowed in the campaign.
    function _splitFee(uint256 amount) internal pure returns (uint256 fee, uint256 net) {
        fee = (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        net = amount - fee;
    }
}
