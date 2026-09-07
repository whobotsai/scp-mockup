// Social Indexer (KEEPER_SERVICE_DESIGN.md §4.4): for each active SSO campaign, polls the X
// API for posts matching its tracked keyword within the currently-open epoch's window,
// resolves each poster's wallet via registrationIndexer.js's indexed table, applies PRD
// §12.5's protocol-wide gates (account age >= 30 days, followers >= 25), and stores every
// qualifying post. A post from an unregistered account, or one that fails either gate, is
// simply never written -- never entering sso_posts at all, per PRD §12.2's "doesn't qualify
// and never will retroactively."
//
// Needs X_BEARER_TOKEN in .env -- a real credential from X's own developer portal, never
// hardcoded or pasted into chat. Written against X API v2's recent-search endpoint but not
// yet exercised against a real token/account (same "implemented, not yet validated" caveat as
// snapshotPublisher.js's Lighthouse integration elsewhere in this codebase) -- and
// specifically consistent with registration-service's own paused OAuth verification: neither
// that module nor this one has ever completed a real round-trip against X's live API.
//
// A real, known limitation, not a bug: X API v2's *recent* search endpoint (the free/basic
// tier's search product) only covers the last 7 days. An epoch can be up to 30 days
// (Types.EpochLength.D30), so this can't actually see the start of a 30-day epoch's window
// until the account has access to full-archive search (an X API Enterprise/Academic tier) --
// out of scope to solve here since it's a plan/access decision, not a code one (mirrors
// KEEPER_SERVICE_DESIGN.md §7's own "X API tier ... rate limits ... read from the account
// once Stage 1 implementation starts").
"use strict";
const { ethers } = require("ethers");
const { SSO_CAMPAIGN_ABI, MIN_ACCOUNT_AGE_DAYS, MIN_FOLLOWERS, EPOCH_LENGTH_SECONDS } = require("./abis/sso");
const db = require("./db");

const X_API_BASE = "https://api.x.com/2";
const REQUEST_TIMEOUT_MS = 30_000;

/// Bounded with the same AbortController pattern snapshotPublisher.js's Lighthouse upload
/// uses, after that call's own missing timeout hung the entire keeper indefinitely -- see
/// that module's own comment on the incident this fixes preemptively here.
async function xApiGet(path, params, bearerToken) {
  const url = new URL(`${X_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` }, signal: controller.signal });
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`X API request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`X API request failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/// Pure scoring formula, PRD §12.2: 2*(retweets+quotes) + 1*replies + 0.5*likes.
function scorePost(metrics) {
  return 2 * (metrics.retweet_count + metrics.quote_count) + metrics.reply_count + 0.5 * metrics.like_count;
}

function daysSince(dateIso) {
  return (Date.now() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24);
}

/// The epoch currently accepting posts: the first non-finalized epoch whose window hasn't
/// closed yet. Returns null once every epoch is finalized or past its window -- nothing left
/// to poll for (epochEngine.js is what actually finalizes a closed epoch).
async function currentEpoch(campaignContract) {
  const epochCount = Number(await campaignContract.epochCount());
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < epochCount; i++) {
    const epoch = await campaignContract.getEpoch(i);
    if (!epoch.finalized && now < Number(epoch.endsAt)) return { index: i, epoch };
  }
  return null;
}

/// @returns the currently-open epoch's index if posts were (or would have been) polled for
///   it, or null if there's nothing to poll right now -- index.js uses this to know which
///   epoch's leaderboard to log, without a second round of on-chain epoch lookups.
async function pollPostsForCampaign(provider, campaign) {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    console.log(`[socialIndexer] X_BEARER_TOKEN not set -- skipping post polling for ${campaign.campaign_address}`);
    return null;
  }

  const campaignContract = new ethers.Contract(campaign.campaign_address, SSO_CAMPAIGN_ABI, provider);
  const current = await currentEpoch(campaignContract);
  if (!current) {
    console.log(`[socialIndexer] ${campaign.campaign_address}: no open epoch to poll`);
    return null;
  }

  const epochLengthIdx = Number(await campaignContract.epochLength());
  const epochSeconds = EPOCH_LENGTH_SECONDS[epochLengthIdx];
  const startTime = new Date(Number(current.epoch.endsAt) * 1000 - epochSeconds * 1000).toISOString();

  let data;
  try {
    data = await xApiGet(
      "/tweets/search/recent",
      {
        query: campaign.keyword,
        start_time: startTime,
        "tweet.fields": "public_metrics,author_id,created_at",
        expansions: "author_id",
        "user.fields": "created_at,public_metrics,username",
        max_results: "100",
      },
      bearerToken
    );
  } catch (e) {
    console.error(`[socialIndexer] ${campaign.campaign_address}: X API request failed:`, e.message, e.cause || "");
    return null;
  }

  const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));
  let qualifying = 0;

  for (const post of data.data || []) {
    const author = users.get(post.author_id);
    if (!author) continue; // shouldn't happen given the expansions request, but never trust it blindly

    const wallet = await db.resolveWalletForHandle(author.username);
    if (!wallet) continue; // unregistered account -- never counts (PRD §12.2)
    if (daysSince(author.created_at) < MIN_ACCOUNT_AGE_DAYS) continue;
    if (author.public_metrics.followers_count < MIN_FOLLOWERS) continue;

    const m = post.public_metrics;
    await db.insertSsoPost({
      campaignAddress: campaign.campaign_address,
      postId: post.id,
      wallet,
      xHandle: author.username,
      epochIndex: current.index,
      retweets: m.retweet_count,
      quotes: m.quote_count,
      replies: m.reply_count,
      likes: m.like_count,
      score: scorePost(m),
      postedAt: new Date(post.created_at),
    });
    qualifying++;
  }

  console.log(
    `[socialIndexer] ${campaign.campaign_address}: epoch ${current.index}, ${qualifying} qualifying post(s) indexed this poll`
  );
  return current.index;
}

module.exports = { pollPostsForCampaign, scorePost, currentEpoch };
