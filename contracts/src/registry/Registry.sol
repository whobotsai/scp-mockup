// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Registry
/// @notice Links an X account to a wallet, once, reusable across every SSO campaign
/// (PRD.md §12.3-§12.4: "Registration is a standalone call, not per-campaign"). A smart
/// contract can't verify an OAuth flow directly, so the off-chain Registration Service
/// performs that and signs an attestation; this contract verifies the *signature*, not the
/// OAuth flow itself — the PRD's "oauthProof" parameter is that attestation in practice.
contract Registry is Ownable {
    using MessageHashUtils for bytes32;

    address public attestor;

    mapping(address => string) public handleOf;

    event AttestorUpdated(address indexed attestor);
    event HandleRegistered(address indexed wallet, string xHandle);

    constructor(address initialOwner, address initialAttestor) Ownable(initialOwner) {
        require(initialAttestor != address(0), "attestor=0");
        attestor = initialAttestor;
    }

    function setAttestor(address newAttestor) external onlyOwner {
        require(newAttestor != address(0), "attestor=0");
        attestor = newAttestor;
        emit AttestorUpdated(newAttestor);
    }

    /// @param xHandle The X handle being linked to msg.sender.
    /// @param attestation An ECDSA signature from `attestor` over
    /// keccak256(abi.encodePacked(msg.sender, xHandle)), issued only after the Registration
    /// Service has verified msg.sender actually completed OAuth for that handle.
    function registerHandle(string calldata xHandle, bytes calldata attestation) external {
        bytes32 digest = keccak256(abi.encodePacked(msg.sender, xHandle)).toEthSignedMessageHash();
        require(ECDSA.recover(digest, attestation) == attestor, "bad attestation");
        handleOf[msg.sender] = xHandle;
        emit HandleRegistered(msg.sender, xHandle);
    }
}
