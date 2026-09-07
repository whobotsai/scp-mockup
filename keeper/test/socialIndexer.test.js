"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { scorePost } = require("../src/socialIndexer");

// The X API call itself needs live network access, so it isn't unit-tested here (same
// reasoning as tradeSources/uniswapV4.js's and snapshotPublisher.js's own untested-live
// caveats) -- this only checks the pure scoring formula, PRD §12.2:
// 2*(retweets+quotes) + 1*replies + 0.5*likes.
test("scorePost matches PRD section 12.2's formula exactly", () => {
  const metrics = { retweet_count: 10, quote_count: 5, reply_count: 8, like_count: 40 };
  // 2*(10+5) + 8 + 0.5*40 = 30 + 8 + 20 = 58
  assertEqual(scorePost(metrics), 58);
});

test("scorePost: all-zero engagement scores zero", () => {
  assertEqual(scorePost({ retweet_count: 0, quote_count: 0, reply_count: 0, like_count: 0 }), 0);
});

test("scorePost: retweets/quotes are weighted twice as heavily as replies", () => {
  const oneRetweet = scorePost({ retweet_count: 1, quote_count: 0, reply_count: 0, like_count: 0 });
  const oneReply = scorePost({ retweet_count: 0, quote_count: 0, reply_count: 1, like_count: 0 });
  assertEqual(oneRetweet, 2 * oneReply);
});

summary();
