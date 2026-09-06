// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal reimplementation of Uniswap V2's constant-product pair, written from this
/// codebase's understanding of V2's well-documented public design (not fetched/copied from
/// the live repo — no network access to do that from here). The mechanics — x*y=k, a 0.3% fee
/// taken via the 997/1000 factor, MINIMUM_LIQUIDITY burned to address(0) on first mint, the
/// exact `Swap`/`Sync`/`Mint`/`Burn` event shapes — are Uniswap V2's stable, long-unchanged
/// design, which this project already depends on being able to reproduce correctly for
/// keeper/src/tradeSources/uniswapV2.js to have something real to index. Test-only, never
/// part of the real protocol — see ../README.md's file tree note on mocks/.
///
/// Deliberately missing (out of scope for a testnet indexing fixture): flash-swap callback
/// data handling, price-cumulative oracle accumulators, and permit(). None of those affect
/// what the keeper needs: a real Swap event with real reserve changes.
contract UniswapV2Pair {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    address public factory;
    address public token0;
    address public token1;

    uint112 private reserve0;
    uint112 private reserve1;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    bool private initialized;
    bool private locked;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    modifier lock() {
        require(!locked, "locked");
        locked = true;
        _;
        locked = false;
    }

    constructor() {
        factory = msg.sender;
    }

    /// @dev Called once by the factory immediately after cloning/deploying this pair.
    function initialize(address token0_, address token1_) external {
        require(msg.sender == factory, "not factory");
        require(!initialized, "already initialized");
        initialized = true;
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() public view returns (uint112, uint112) {
        return (reserve0, reserve1);
    }

    function _update(uint256 balance0, uint256 balance1) private {
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        emit Sync(reserve0, reserve1);
    }

    /// @notice Mints LP tokens for whatever token0/token1 balance this contract holds beyond
    /// its last-recorded reserves — the caller is expected to have already transferred the
    /// tokens in (the same "optimistic transfer, then call" pattern V2 itself uses).
    function mint(address to) external lock returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1) = getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        if (totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mintLP(address(0), MINIMUM_LIQUIDITY);
        } else {
            liquidity = _min((amount0 * totalSupply) / _reserve0, (amount1 * totalSupply) / _reserve1);
        }
        require(liquidity > 0, "insufficient liquidity minted");
        _mintLP(to, liquidity);

        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Burns the LP tokens this contract holds (caller sends them in first) and
    /// returns the underlying pair of tokens proportionally.
    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        uint256 liquidity = balanceOf[address(this)];
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        amount0 = (liquidity * balance0) / totalSupply;
        amount1 = (liquidity * balance1) / totalSupply;
        require(amount0 > 0 && amount1 > 0, "insufficient liquidity burned");

        _burnLP(address(this), liquidity);
        IERC20(token0).transfer(to, amount0);
        IERC20(token1).transfer(to, amount1);

        balance0 = IERC20(token0).balanceOf(address(this));
        balance1 = IERC20(token1).balanceOf(address(this));
        _update(balance0, balance1);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice The core swap. Same optimistic pattern as real V2: caller transfers the input
    /// token in first, then calls this with the desired output amount(s); this checks the
    /// constant-product invariant (net of the 0.3% fee) holds before releasing output tokens.
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external lock {
        require(amount0Out > 0 || amount1Out > 0, "insufficient output amount");
        (uint112 _reserve0, uint112 _reserve1) = getReserves();
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "insufficient liquidity");

        if (amount0Out > 0) IERC20(token0).transfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).transfer(to, amount1Out);

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "insufficient input amount");

        // 0.3% fee: scale balances up by 1000 and compare against reserves scaled by 1000,
        // net of a 3/1000 deduction on whichever side received input — the standard V2 check.
        uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
        uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;
        require(
            balance0Adjusted * balance1Adjusted >= uint256(_reserve0) * uint256(_reserve1) * 1000 * 1000,
            "k invariant"
        );

        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function _mintLP(address to, uint256 amount) private {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function _burnLP(address from, uint256 amount) private {
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /// @notice Lets an LP token holder transfer LP tokens to this pair itself before calling
    /// burn() — the same "send tokens to the contract, then call" pattern as everything else
    /// here. Minimal on purpose: no allowance/transferFrom, this is a test fixture.
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
