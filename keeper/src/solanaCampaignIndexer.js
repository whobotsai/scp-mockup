// Solana counterpart of campaignIndexer.js: discovers new SHO/SSO campaigns and populates
// the shared `campaigns` table with network='solana' rows. Scope is deliberately limited to
// discovery, same as campaignIndexer.js's own header describes for the EVM side — trade
// indexing, price sampling, and root posting for a Solana campaign all still need a chosen
// Solana DEX source and a Solana signer, neither of which exist yet (see
// contracts-solana/README.md's "What's NOT done yet").
//
// Unlike the EVM indexer, this doesn't scan event logs over a block range: a Solana
// campaign's id is just sho_solana/sso_solana's Config.next_id at creation time, and its PDA
// is deterministically derivable from that id (see contracts-solana/programs/*/src/lib.rs's
// `[CAMPAIGN_SEED, config.key(), id.to_le_bytes()]` seeds) — so "what's new" is simply
// "every id from the cursor up to Config's current next_id", each fetched directly by its
// own PDA address. No getProgramAccounts scan, no log-range rate limiting to work around.
"use strict";
const { PublicKey } = require("@solana/web3.js");
const { decodeConfig, decodeShoCampaign, decodeSsoCampaign, NATIVE_SOL_SENTINEL, WINDOW_SECONDS } = require("./abis/solana");
const db = require("./db");

const CONFIG_SEED = Buffer.from("config");
const CAMPAIGN_SEED = Buffer.from("campaign");

function configPda(programId) {
  const [addr] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  return addr;
}
function campaignPda(programId, configAddr, id) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(id));
  const [addr] = PublicKey.findProgramAddressSync([CAMPAIGN_SEED, configAddr.toBuffer(), idBuf], programId);
  return addr;
}

/// factory: 'sho' | 'sso'. Cursor key / decode function / network-agnostic field mapping
/// differ by which program this is indexing; CURSOR_KEY below picks the right one.
function cursorKey(factory) {
  return `solana_${factory}_campaigns`;
}

async function pollNewSolanaCampaigns(connection, programIdStr, factory) {
  const programId = new PublicKey(programIdStr);
  const cfgAddr = configPda(programId);
  const cfgInfo = await connection.getAccountInfo(cfgAddr);
  if (!cfgInfo) {
    // Matches campaignIndexer.js's own "nothing to do yet" posture rather than erroring —
    // the program's initialize_config hasn't been called on this cluster (very likely true
    // right now, since contracts-solana/ has never been deployed anywhere; see its README).
    console.log(`[solanaCampaignIndexer:${factory}] Config account not found at ${cfgAddr.toBase58()} — skipping (not deployed/initialized yet?)`);
    return;
  }
  const cfg = decodeConfig(cfgInfo.data);

  const key = cursorKey(factory);
  let nextUnindexedId = (await db.getCursor(key)) ?? 0n;
  if (nextUnindexedId >= cfg.nextId) return; // caught up

  console.log(`[solanaCampaignIndexer:${factory}] indexing ids ${nextUnindexedId}..${cfg.nextId - 1n} (Config.next_id=${cfg.nextId})`);

  while (nextUnindexedId < cfg.nextId) {
    const addr = campaignPda(programId, cfgAddr, nextUnindexedId);
    const info = await connection.getAccountInfo(addr);
    if (!info) {
      // Shouldn't happen (next_id only advances after a successful create_campaign_*), but
      // matching campaignIndexer.js's own stance of logging and moving on rather than
      // wedging the whole indexer on one bad/missing account.
      console.error(`[solanaCampaignIndexer:${factory}] expected campaign id ${nextUnindexedId} at ${addr.toBase58()} but found no account — skipping it`);
      nextUnindexedId += 1n;
      await db.setCursor(key, nextUnindexedId);
      continue;
    }

    await indexSolanaCampaign(factory, addr, info.data);
    nextUnindexedId += 1n;
    await db.setCursor(key, nextUnindexedId);
  }
}

async function indexSolanaCampaign(factory, addr, data) {
  const campaignAddress = addr.toBase58();
  if (factory === "sho") {
    const c = decodeShoCampaign(data);
    await db.upsertCampaign({
      campaignId: c.id.toString(),
      network: "solana",
      factory: "sho",
      campaignAddress,
      token: c.token,
      rewardToken: c.rewardMint === NATIVE_SOL_SENTINEL ? NATIVE_SOL_SENTINEL : c.rewardMint,
      creator: c.creator,
      createdAt: new Date(Number(c.createdAt) * 1000),
      durationSeconds: c.duration.toString(),
      leaderboardSize: c.leaderboardSize,
      windowSeconds: WINDOW_SECONDS[c.window],
    });
  } else {
    const c = decodeSsoCampaign(data);
    await db.upsertCampaign({
      campaignId: c.id.toString(),
      network: "solana",
      factory: "sso",
      campaignAddress,
      token: c.token,
      rewardToken: c.rewardMint === NATIVE_SOL_SENTINEL ? NATIVE_SOL_SENTINEL : c.rewardMint,
      creator: c.creator,
      createdAt: new Date(Number(c.createdAt) * 1000),
      durationSeconds: c.duration.toString(),
      leaderboardSize: c.leaderboardSize,
      keyword: c.keyword,
    });
  }
  console.log(`[solanaCampaignIndexer:${factory}] indexed campaign at ${campaignAddress}`);
}

module.exports = { pollNewSolanaCampaigns, configPda, campaignPda };
