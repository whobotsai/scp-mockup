// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UniswapV2Pair} from "./UniswapV2Pair.sol";

/// @notice Minimal Uniswap-V2-style factory — see UniswapV2Pair.sol's header for the same
/// caveat (reimplemented from this codebase's understanding of V2's public design, not
/// fetched from the live repo). Deploys a fresh UniswapV2Pair per token pair and initializes
/// it, same as V2's own factory. Test-only, never part of the real protocol.
///
/// Deliberately simpler than the real factory: plain `new UniswapV2Pair()` rather than
/// CREATE2 with a deterministic address. This project's own scripts always read the pair
/// address back from `getPair`/the `PairCreated` event rather than computing it off-chain
/// from an init-code hash, so CREATE2's main practical benefit (predicting a pair's address
/// before it exists) isn't needed here.
contract UniswapV2Factory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairIndex);

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "identical tokens");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "zero address");
        require(getPair[token0][token1] == address(0), "pair exists");

        UniswapV2Pair newPair = new UniswapV2Pair();
        newPair.initialize(token0, token1);
        pair = address(newPair);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length - 1);
    }
}
