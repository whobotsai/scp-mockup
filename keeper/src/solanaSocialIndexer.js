// Solana counterpart of socialIndexer.js. Same job (poll X for posts matching a campaign's
// tracked keyword within the currently-open epoch's window, resolve each poster's wallet,
// apply PRD §12.5's account-age/follower gates, store every qualifying post) -- the only
// thing that differs is reading epoch state from a decoded sso_solana Campaign account
// instead of ethers.Contract calls, since Solana has no "view function" distinct from
// fetching account data. `db.resolveWalletForHandle` needed no changes at all to work for a
// Solana-registered wallet -- registrySolanaIndexer.js already writes into the same
// handle_registrations table socialIndexer.js's own lookup already used for EVM.
//
// X API caveats are identical to socialIndexer.js's own (never exercised against a real
// token/account in this sandbox, and the free/basic search tier's 7-day window can't see the
// start of a 30-day epoch) -- see that module's header for the full explanation. xApiGet/
// scorePost/daysSince are duplicated here rather than imported, same per-package/per-chain-
// adapter duplication convention this project already uses elsewhere (e.g.
// solanaPriceSampler.js doesn't share priceSampler.js's fetch internals either).
"use strict";
const { PublicKey } = require("@solana/web3.js");
const { decodeSsoCampaign, EPOCH_LENGTH_SECONDS } = require("./abis/solana");
const { MIN_ACCOUNT_AGE_DAYS, MIN_FOLLOWERS } = require("./abis/sso");
const db = require("./db");

const X_API_BASE = "https://api.x.com/2";
const REQUEST_TIMEOUT_MS = 30_000;

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

/// Same PRD §12.2 formula as socialIndexer.js::scorePost -- duplicated, not imported, so this
/// module has no dependency on the EVM-specific file at all (consistent with every other
/// Solana adapter in this package).
function scorePost(metrics) {
  return 2 * (metrics.retweet_count + metrics.quote_count) + metrics.reply_count + 0.5 * metrics.like_count;
}

function daysSince(dateIso) {
  return (Date.now() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24);
}

/// Mirrors socialIndexer.js::currentEpoch -- the first non-finalized epoch whose window
/// hasn't closed yet, read directly from the decoded Campaign account instead of live
/// contract calls.
function currentSolanaEpoch(campaign) {
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < campaign.epochCount; i++) {
    const epoch = campaign.epochs[i];
    if (!epoch.finalized && now < Number(epoch.endsAt)) return { index: i, epoch };
  }
  return null;
}

/// @returns the currently-open epoch's index if posts were (or would have been) polled for
///   it, or null if there's nothing to poll right now -- same contract pollPostsForCampaign
///   has for index.js's own logging.
async function pollPostsForSolanaCampaign(connection, campaignRow) {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    console.log(`[solanaSocialIndexer] X_BEARER_TOKEN not set -- skipping post polling for ${campaignRow.campaign_address}`);
    return null;
  }

  const info = await connection.getAccountInfo(new PublicKey(campaignRow.campaign_address));
  if (!info) {
    console.error(`[solanaSocialIndexer] ${campaignRow.campaign_address}: campaign account not found on-chain -- skipping`);
    return null;
  }
  const campaign = decodeSsoCampaign(info.data);

  const current = currentSolanaEpoch(campaign);
  if (!current) {
    console.log(`[solanaSocialIndexer] ${campaignRow.campaign_address}: no open epoch to poll`);
    return null;
  }

  const epochSeconds = EPOCH_LENGTH_SECONDS[campaign.epochLength];
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
    console.error(`[solanaSocialIndexer] ${campaignRow.campaign_address}: X API request failed:`, e.message, e.cause || "");
    return null;
  }

  const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));
  let qualifying = 0;

  for (const post of data.data || []) {
    const author = users.get(post.author_id);
    if (!author) continue;

    const wallet = await db.resolveWalletForHandle(author.username);
    if (!wallet) continue; // unregistered account -- never counts (PRD §12.2)
    if (daysSince(author.created_at) < MIN_ACCOUNT_AGE_DAYS) continue;
    if (author.public_metrics.followers_count < MIN_FOLLOWERS) continue;

    const m = post.public_metrics;
    await db.insertSsoPost({
      campaignAddress: campaignRow.campaign_address,
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
    `[solanaSocialIndexer] ${campaignRow.campaign_address}: epoch ${current.index}, ${qualifying} qualifying post(s) indexed this poll`
  );
  return current.index;
}

module.exports = { pollPostsForSolanaCampaign, scorePost, currentSolanaEpoch };
