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

    /// Reverse index enforcing "one wallet per X handle at a time" -- keyed by a
    /// case-normalized hash of the handle (X handles aren't case-sensitive) rather than the
    /// handle string itself. Without this, nothing stopped the same X account from completing
    /// OAuth again from a second wallet and getting a second valid attestation for it (X's own
    /// login flow has no problem being repeated, and the old registerHandle had no check at
    /// all) -- both wallets would then show that handle as "linked" and the keeper's
    /// handle->wallet resolution (keeper/src/db.js resolveWalletForHandle) had no principled
    /// way to pick between them, silently crediting SSO post/epoch scoring to whichever row
    /// Postgres happened to return first. This mapping makes that impossible on-chain: a
    /// handle already linked to a *different* wallet must be released (by that wallet
    /// registering a different handle, or a future admin-recovery path) before it can be
    /// linked again elsewhere.
    mapping(bytes32 => address) public walletOfHandle;

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

        bytes32 key = _normalizedKey(xHandle);
        address currentHolder = walletOfHandle[key];
        require(currentHolder == address(0) || currentHolder == msg.sender, "handle already linked to another wallet");

        // registerHandle can already be called again by the same wallet to switch to a
        // *different* handle (the "one current handle per wallet" semantics the old code
        // already had) -- when that happens, release the wallet's previous handle so it isn't
        // left permanently squatted and unregistrable by anyone else.
        string memory previous = handleOf[msg.sender];
        if (bytes(previous).length != 0) {
            delete walletOfHandle[_normalizedKey(previous)];
        }

        handleOf[msg.sender] = xHandle;
        walletOfHandle[key] = msg.sender;
        emit HandleRegistered(msg.sender, xHandle);
    }

    // ASCII-lowercases `s` and hashes the result, so two differently-cased handles (X isn't
    // case-sensitive about the letters after the leading @) collide into the same
    // walletOfHandle slot -- matching keeper/src/db.js's own `lower(x_handle)` lookup. X
    // handles are ASCII (letters/digits/underscore, optionally a leading "@"), so a full
    // Unicode case-fold isn't needed here.
    function _normalizedKey(string memory s) private pure returns (bytes32) {
        bytes memory original = bytes(s);
        bytes memory lower = new bytes(original.length);
        for (uint256 i = 0; i < original.length; i++) {
            uint8 c = uint8(original[i]);
            if (c >= 0x41 && c <= 0x5A) c += 32; // 'A'-'Z' -> 'a'-'z'
            lower[i] = bytes1(c);
        }
        return keccak256(lower);
    }
}
