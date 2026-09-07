// Snapshot Publisher (KEEPER_SERVICE_DESIGN.md section 4.6): publishes a computed snapshot's
// full leaderboard to IPFS, content-addressed, so anyone can independently recompute the root
// during the 24h challenge window -- without a published snapshot, "challenge window" would
// just mean "wait 24 hours," not "anyone can actually check the math" (that section's own
// words). Records the resulting CID in snapshots.ipfs_cid.
//
// Provider: Lighthouse.storage, per that section's own resolved choice. Needs
// LIGHTHOUSE_API_KEY in .env -- a real credential from https://lighthouse.storage's own
// dashboard, never hardcoded or pasted into chat. Written against Lighthouse's publicly
// documented multipart upload endpoint but not yet exercised against a real account/key while
// building this (same "implemented, not yet validated" caveat as tradeSources/uniswapV4.js
// elsewhere in this codebase) -- if the request/response shape below is wrong, expect a clear
// HTTP error or a missing-CID error, not a silently wrong CID.
"use strict";
const db = require("./db");

const LIGHTHOUSE_UPLOAD_URL = "https://node.lighthouse.storage/api/v0/add";

/// The exact payload a challenger needs to independently recompute the root and check it
/// against what's posted on-chain: the full entry list plus enough context to know what
/// campaign/milestone it belongs to.
function buildPayload(snapshot) {
  return {
    campaignAddress: snapshot.campaign_address,
    milestoneIndex: snapshot.index,
    merkleRoot: snapshot.merkle_root,
    snapshotHash: snapshot.snapshot_hash,
    entries: snapshot.entries,
  };
}

async function uploadJson(payload, apiKey) {
  const body = new FormData();
  body.append("file", new Blob([JSON.stringify(payload)], { type: "application/json" }), "snapshot.json");

  const res = await fetch(LIGHTHOUSE_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  if (!res.ok) {
    throw new Error(`Lighthouse upload failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const cid = data.Hash || data.hash || data.cid;
  if (!cid) {
    throw new Error(`Lighthouse response had no recognizable CID field: ${JSON.stringify(data)}`);
  }
  return cid;
}

async function publishPendingSnapshots() {
  const apiKey = process.env.LIGHTHOUSE_API_KEY;
  const pending = await db.snapshotsMissingIpfsCid();

  for (const snapshot of pending) {
    if (!apiKey) {
      console.log(
        `[snapshotPublisher] LIGHTHOUSE_API_KEY not set -- skipping publish for ` +
          `${snapshot.campaign_address} milestone ${snapshot.index}`
      );
      continue;
    }
    try {
      const cid = await uploadJson(buildPayload(snapshot), apiKey);
      await db.setSnapshotIpfsCid(snapshot.campaign_address, snapshot.index, cid);
      console.log(`[snapshotPublisher] ${snapshot.campaign_address} milestone ${snapshot.index}: published, cid=${cid}`);
    } catch (e) {
      console.error(`[snapshotPublisher] ${snapshot.campaign_address} milestone ${snapshot.index}: publish failed:`, e.message);
    }
  }
}

module.exports = { buildPayload, publishPendingSnapshots };
