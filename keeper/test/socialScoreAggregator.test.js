"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { computeEpochScores } = require("../src/socialScoreAggregator");

test("empty posts produce an empty leaderboard", () => {
  assertEqual(computeEpochScores([]), []);
});

test("a single post: score is just that post's score", () => {
  assertEqual(computeEpochScores([{ wallet: "0xA", score: 12 }]), [{ wallet: "0xA", score: 12 }]);
});

test("multiple posts from the same account sum, up to the cap", () => {
  // 6 posts, cap is 5 -- the smallest (1) should be dropped.
  const posts = [1, 2, 3, 4, 5, 6].map((score) => ({ wallet: "0xA", score }));
  assertEqual(computeEpochScores(posts), [{ wallet: "0xA", score: 2 + 3 + 4 + 5 + 6 }]);
});

test("sorted descending by score, multiple accounts", () => {
  const posts = [
    { wallet: "0xA", score: 10 },
    { wallet: "0xB", score: 30 },
    { wallet: "0xC", score: 20 },
  ];
  assertEqual(computeEpochScores(posts), [
    { wallet: "0xB", score: 30 },
    { wallet: "0xC", score: 20 },
    { wallet: "0xA", score: 10 },
  ]);
});

test("a zero-score post still counts an account as participating", () => {
  assertEqual(computeEpochScores([{ wallet: "0xA", score: 0 }]), [{ wallet: "0xA", score: 0 }]);
});

summary();
