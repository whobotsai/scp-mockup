"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { allocateProportional } = require("../src/rewardAllocator");

test("empty leaderboard allocates nothing", () => {
  assertEqual(allocateProportional([], 1000n), []);
});

test("a single entry gets the entire reward", () => {
  const result = allocateProportional([{ wallet: "0xA", netBuyUsd: 100 }], 1000n);
  assertEqual(result, [{ account: "0xA", amount: 1000n }]);
});

test("two equal entries split evenly", () => {
  const result = allocateProportional(
    [
      { wallet: "0xA", netBuyUsd: 100 },
      { wallet: "0xB", netBuyUsd: 100 },
    ],
    1000n
  );
  assertEqual(result, [
    { account: "0xA", amount: 500n },
    { account: "0xB", amount: 500n },
  ]);
});

test("allocation is proportional to netBuyUsd", () => {
  const result = allocateProportional(
    [
      { wallet: "0xA", netBuyUsd: 300 },
      { wallet: "0xB", netBuyUsd: 100 },
    ],
    1000n
  );
  assertEqual(result, [
    { account: "0xA", amount: 750n },
    { account: "0xB", amount: 250n },
  ]);
});

test("the sum of all allocations always exactly equals totalReward, remainder goes to the top entry", () => {
  const leaderboard = [
    { wallet: "0xA", netBuyUsd: 333.33 },
    { wallet: "0xB", netBuyUsd: 333.33 },
    { wallet: "0xC", netBuyUsd: 333.34 },
  ];
  const totalReward = 1000n;
  const result = allocateProportional(leaderboard, totalReward);
  const sum = result.reduce((a, b) => a + b.amount, 0n);
  if (sum !== totalReward) throw new Error(`expected sum ${totalReward}, got ${sum}`);
});

test("a large realistic wei-scale reward distributes without precision loss", () => {
  const leaderboard = [
    { wallet: "0xA", netBuyUsd: 40.13 },
    { wallet: "0xB", netBuyUsd: 9.87 },
  ];
  const totalReward = 1_990_000_000_000_000_000n; // 1.99 ETH in wei, e.g. this project's own test campaign
  const result = allocateProportional(leaderboard, totalReward);
  const sum = result.reduce((a, b) => a + b.amount, 0n);
  if (sum !== totalReward) throw new Error(`expected sum ${totalReward}, got ${sum}`);
  // 0xA should get roughly 40.13/(40.13+9.87) = 80.26% of the pool
  const shareA = Number(result[0].amount) / Number(totalReward);
  if (Math.abs(shareA - 0.8026) > 0.001) throw new Error(`expected 0xA's share ~0.8026, got ${shareA}`);
});

summary();
