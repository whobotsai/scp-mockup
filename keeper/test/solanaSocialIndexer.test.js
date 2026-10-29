"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { scorePost, currentSolanaEpoch } = require("../src/solanaSocialIndexer");

// Same formula as socialIndexer.js's own scorePost -- duplicated on purpose (see this
// module's header), so it gets the same independent test coverage.
test("scorePost matches PRD section 12.2's formula exactly", () => {
  const metrics = { retweet_count: 10, quote_count: 5, reply_count: 8, like_count: 40 };
  assertEqual(scorePost(metrics), 58);
});

test("scorePost: all-zero engagement scores zero", () => {
  assertEqual(scorePost({ retweet_count: 0, quote_count: 0, reply_count: 0, like_count: 0 }), 0);
});

const now = Math.floor(Date.now() / 1000);

test("currentSolanaEpoch: returns the first non-finalized epoch whose window hasn't closed", () => {
  const campaign = {
    epochCount: 3,
    epochs: [
      { finalized: true, endsAt: now - 1000 },
      { finalized: false, endsAt: now + 1000 },
      { finalized: false, endsAt: now + 5000 },
    ],
  };
  const current = currentSolanaEpoch(campaign);
  assertEqual(current.index, 1);
});

test("currentSolanaEpoch: skips a non-finalized epoch whose window has already closed", () => {
  const campaign = {
    epochCount: 2,
    epochs: [
      { finalized: false, endsAt: now - 1000 }, // closed but not yet finalized by epochEngine
      { finalized: false, endsAt: now + 1000 },
    ],
  };
  assertEqual(currentSolanaEpoch(campaign).index, 1);
});

test("currentSolanaEpoch: returns null once every epoch is finalized or past its window", () => {
  const campaign = {
    epochCount: 2,
    epochs: [
      { finalized: true, endsAt: now - 1000 },
      { finalized: false, endsAt: now - 500 },
    ],
  };
  assertEqual(currentSolanaEpoch(campaign), null);
});

summary();
