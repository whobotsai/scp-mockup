// Run with: node test/uniswapV2Mock.test.js
// Verifies the UniswapV2Factory/UniswapV2Pair mocks actually behave like a constant-product
// AMM before anyone deploys them to a real testnet -- this is the one piece of this pivot
// that's fully verifiable offline (no RPC needed), so it gets exercised thoroughly here.
"use strict";
const { ethers } = require("hardhat");
const { suite, test, assertReverts, summary } = require("./helpers/harness");
const { deploy, attach } = require("./helpers/deploy");

async function main() {
  const [deployer, lp, trader] = await ethers.getSigners();

  suite("UniswapV2Factory + UniswapV2Pair -- constant-product AMM mock");
  {
    const factory = await deploy("UniswapV2Factory", deployer);
    const tokenA = await deploy("MockERC20", deployer, "Token A", "TKA");
    const tokenB = await deploy("MockERC20", deployer, "Token B", "TKB");
    const [token0Addr, token1Addr] =
      (await tokenA.getAddress()) < (await tokenB.getAddress())
        ? [await tokenA.getAddress(), await tokenB.getAddress()]
        : [await tokenB.getAddress(), await tokenA.getAddress()];
    const token0 = token0Addr === (await tokenA.getAddress()) ? tokenA : tokenB;
    const token1 = token0Addr === (await tokenA.getAddress()) ? tokenB : tokenA;

    let pair;

    await test("createPair deploys a pair and orders token0/token1 by address", async () => {
      const tx = await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      const receipt = await tx.wait();
      const parsed = receipt.logs.map((l) => factory.interface.parseLog(l)).find((l) => l.name === "PairCreated");
      pair = attach("UniswapV2Pair", parsed.args.pair, deployer);

      if ((await pair.token0()) !== token0Addr) throw new Error("token0 mismatch");
      if ((await pair.token1()) !== token1Addr) throw new Error("token1 mismatch");
    });

    await test("createPair reverts on a duplicate pair", async () => {
      await assertReverts(factory.createPair(await tokenA.getAddress(), await tokenB.getAddress()), "pair exists");
    });

    await test("first mint locks MINIMUM_LIQUIDITY and credits the rest to the LP", async () => {
      await token0.mint(lp.address, ethers.parseUnits("10000", 18));
      await token1.mint(lp.address, ethers.parseUnits("10000", 18));
      await token0.connect(lp).transfer(await pair.getAddress(), ethers.parseUnits("1000", 18));
      await token1.connect(lp).transfer(await pair.getAddress(), ethers.parseUnits("1000", 18));

      await pair.connect(lp).mint(lp.address);

      const minLiq = await pair.MINIMUM_LIQUIDITY();
      const lpBalance = await pair.balanceOf(lp.address);
      const expected = ethers.parseUnits("1000", 18) - minLiq; // sqrt(1000e18 * 1000e18) - 1000
      if (lpBalance !== expected) throw new Error(`expected LP balance ${expected}, got ${lpBalance}`);

      const [r0, r1] = await pair.getReserves();
      if (r0 !== ethers.parseUnits("1000", 18) || r1 !== ethers.parseUnits("1000", 18)) {
        throw new Error("reserves not updated to 1000/1000 after first mint");
      }
    });

    await test("a swap moves reserves correctly and emits Swap with the real trader as sender", async () => {
      const amountIn = ethers.parseUnits("100", 18);
      await token0.mint(trader.address, amountIn);
      await token0.connect(trader).transfer(await pair.getAddress(), amountIn);

      // out = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997) -- the
      // standard V2 getAmountOut formula, computed here rather than imported so the test
      // independently checks the contract's own fee/invariant math.
      const [r0Before, r1Before] = await pair.getReserves();
      const amountInWithFee = amountIn * 997n;
      const amountOut = (amountInWithFee * r1Before) / (r0Before * 1000n + amountInWithFee);

      const tx = await pair.connect(trader).swap(0, amountOut, trader.address);
      const receipt = await tx.wait();
      // receipt.logs includes MockERC20's own Transfer events too (not just the pair's) --
      // pair.interface.parseLog throws on those, so parse defensively rather than assume
      // every log belongs to this contract's ABI.
      const swapEvent = receipt.logs
        .map((l) => {
          try {
            return pair.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((l) => l && l.name === "Swap");
      if (!swapEvent) throw new Error("Swap event not found in receipt");

      if (swapEvent.args.sender !== trader.address) throw new Error("Swap.sender should be the calling wallet");
      if (swapEvent.args.amount0In !== amountIn) throw new Error("amount0In mismatch");
      if (swapEvent.args.amount1Out !== amountOut) throw new Error("amount1Out mismatch");

      const traderToken1Balance = await token1.balanceOf(trader.address);
      if (traderToken1Balance !== amountOut) throw new Error("trader did not receive the swapped-out token");
    });

    await test("a swap that violates the k invariant (asking for too much output) reverts", async () => {
      const amountIn = ethers.parseUnits("10", 18);
      await token0.mint(trader.address, amountIn);
      await token0.connect(trader).transfer(await pair.getAddress(), amountIn);
      const tooMuchOut = ethers.parseUnits("50", 18); // way more than a fair swap of 10 tokens in should yield
      await assertReverts(pair.connect(trader).swap(0, tooMuchOut, trader.address), "k invariant");
    });

    await test("a second liquidity add mints LP tokens proportional to the existing pool", async () => {
      const [r0Before, r1Before] = await pair.getReserves();
      const totalSupplyBefore = await pair.totalSupply();

      const addAmount0 = ethers.parseUnits("50", 18);
      // match the pool's current ratio exactly so this isolates the "proportional mint" math
      const addAmount1 = (addAmount0 * r1Before) / r0Before;

      await token0.mint(lp.address, addAmount0);
      await token1.mint(lp.address, addAmount1);
      await token0.connect(lp).transfer(await pair.getAddress(), addAmount0);
      await token1.connect(lp).transfer(await pair.getAddress(), addAmount1);

      const lpBalanceBefore = await pair.balanceOf(lp.address);
      await pair.connect(lp).mint(lp.address);
      const lpBalanceAfter = await pair.balanceOf(lp.address);

      const expectedMinted = (addAmount0 * totalSupplyBefore) / r0Before;
      if (lpBalanceAfter - lpBalanceBefore !== expectedMinted) {
        throw new Error(`expected ${expectedMinted} new LP tokens, got ${lpBalanceAfter - lpBalanceBefore}`);
      }
    });
  }

  summary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
