// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice Shared Merkle-claim verification used by both SHOCampaign and SSOCampaign, so
/// this logic is audited once instead of twice (PRD §12.3: "Both contract families share
/// the same underlying Merkle-claim ... library code").
library ClaimVerifier {
    /// @dev Double-hashed leaf — the standard mitigation against second-preimage attacks
    /// on the Merkle tree, matching OpenZeppelin's own Merkle-distributor examples.
    function leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function verify(bytes32[] calldata proof, bytes32 root, address account, uint256 amount)
        internal
        pure
        returns (bool)
    {
        return MerkleProof.verify(proof, root, leaf(account, amount));
    }
}
