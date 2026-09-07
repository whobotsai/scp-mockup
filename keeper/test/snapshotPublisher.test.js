"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { buildPayload, dueToPublish, DEFAULT_PUBLISH_INTERVAL_MS } = require("../src/snapshotPublisher");

// The IPFS upload call itself needs live network access to Lighthouse.storage, so it isn't
// unit-tested here (same reasoning as tradeSources/uniswapV4.js's own untested-live caveat) --
// this only checks the pure payload-shaping logic a challenger would actually need to
// recompute and check the root against, independent of any network call.
test("buildPayload includes everything a challenger needs to recompute the root", () => {
  const snapshot = {
    campaign_address: "0xA540Fb10A6566b95a9FAaAfe7819f96da144112D",
    index: 0,
    merkle_root: "0x" + "ab".repeat(32),
    snapshot_hash: "0x" + "cd".repeat(32),
    entries: [{ account: "0x1111111111111111111111111111111111111111", amount: "1990000000000000" }],
  };
  const payload = buildPayload(snapshot);
  assertEqual(payload.campaignAddress, snapshot.campaign_address);
  assertEqual(payload.milestoneIndex, snapshot.index);
  assertEqual(payload.merkleRoot, snapshot.merkle_root);
  assertEqual(payload.snapshotHash, snapshot.snapshot_hash);
  assertEqual(payload.entries, snapshot.entries);
});

test("DEFAULT_PUBLISH_INTERVAL_MS is 2 hours", () => {
  assertEqual(DEFAULT_PUBLISH_INTERVAL_MS, 2 * 60 * 60 * 1000);
});

test("dueToPublish: true on the very first attempt (lastAttemptAt=0)", () => {
  assertEqual(dueToPublish(0, Date.now(), DEFAULT_PUBLISH_INTERVAL_MS), true);
});

test("dueToPublish: false right after an attempt, before the interval elapses", () => {
  const now = 1_000_000;
  assertEqual(dueToPublish(now, now + 1000, 2 * 60 * 60 * 1000), false);
});

test("dueToPublish: true once the interval has fully elapsed", () => {
  const now = 1_000_000;
  const interval = 2 * 60 * 60 * 1000;
  assertEqual(dueToPublish(now, now + interval, interval), true);
});

summary();
