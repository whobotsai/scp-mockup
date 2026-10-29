// Solana counterpart of registrationIndexer.js: discovers new wallet<->X-handle links and
// populates the same `handle_registrations` table registrationIndexer.js already writes
// into for EVM (db.upsertHandleRegistration/resolveWalletForHandle are chain-agnostic --
// keyed by a plain wallet string + x_handle, neither cares whether the wallet is a hex
// address or a base58 pubkey). This is the one piece that actually unblocks a future Solana
// SSO epoch engine: socialIndexer.js's resolveWalletForHandle lookup just works for a
// Solana-registered wallet once this indexer runs, no changes needed there at all.
//
// Same "no event-log scanning" pattern solanaCampaignIndexer.js already established: a
// registration's id is registry_solana's own Config.next_registration_id counter at
// registration time, and its PDA is deterministically derivable from that id (see
// contracts-solana/programs/registry_solana/src/lib.rs's RegisterHandle accounts), so
// discovery is "read Config, for each un-indexed id derive+fetch+decode that PDA directly" --
// identical shape to campaign discovery, just a different account type.
"use strict";
const { PublicKey } = require("@solana/web3.js");
const { decodeConfig, decodeRegistration } = require("./abis/registry");
const db = require("./db");

const CONFIG_SEED = Buffer.from("config");
const REGISTRATION_SEED = Buffer.from("registration");

function configPda(programId) {
  const [addr] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  return addr;
}
function registrationPda(programId, configAddr, id) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(id));
  const [addr] = PublicKey.findProgramAddressSync([REGISTRATION_SEED, configAddr.toBuffer(), idBuf], programId);
  return addr;
}

const CURSOR_KEY = "solana_registry_registrations";

async function pollNewSolanaRegistrations(connection, programIdStr) {
  const programId = new PublicKey(programIdStr);
  const cfgAddr = configPda(programId);
  const cfgInfo = await connection.getAccountInfo(cfgAddr);
  if (!cfgInfo) {
    // Matches solanaCampaignIndexer.js's own "nothing to do yet" posture -- very likely true
    // right now, since registry_solana has never been deployed anywhere (see its README).
    console.log(`[registrySolanaIndexer] Config account not found at ${cfgAddr.toBase58()} — skipping (not deployed/initialized yet?)`);
    return;
  }
  const cfg = decodeConfig(cfgInfo.data);

  let nextUnindexedId = (await db.getCursor(CURSOR_KEY)) ?? 0n;
  if (nextUnindexedId >= cfg.nextRegistrationId) return; // caught up

  console.log(`[registrySolanaIndexer] indexing ids ${nextUnindexedId}..${cfg.nextRegistrationId - 1n} (Config.next_registration_id=${cfg.nextRegistrationId})`);

  while (nextUnindexedId < cfg.nextRegistrationId) {
    const addr = registrationPda(programId, cfgAddr, nextUnindexedId);
    const info = await connection.getAccountInfo(addr);
    if (!info) {
      // Shouldn't happen (next_registration_id only advances after a successful
      // register_handle), but matching solanaCampaignIndexer.js's own stance of logging and
      // moving on rather than wedging the whole indexer on one bad/missing account.
      console.error(`[registrySolanaIndexer] expected registration id ${nextUnindexedId} at ${addr.toBase58()} but found no account — skipping it`);
      nextUnindexedId += 1n;
      await db.setCursor(CURSOR_KEY, nextUnindexedId);
      continue;
    }

    const r = decodeRegistration(info.data);
    // No on-chain timestamp on Registration (unlike HandleLink.linked_at) -- see() wasn't
    // worth adding a second account read for here, so this uses the time of indexing as a
    // reasonable proxy. upsertHandleRegistration's own "most recent wins" ordering only
    // matters for a handle switching wallets, which v1 of registry_solana doesn't support
    // yet anyway (see HandleLink's own doc comment in state.rs).
    await db.upsertHandleRegistration(r.wallet, r.xHandle, new Date());
    console.log(`[registrySolanaIndexer] indexed registration: ${r.wallet} -> @${r.xHandle}`);

    nextUnindexedId += 1n;
    await db.setCursor(CURSOR_KEY, nextUnindexedId);
  }
}

module.exports = { pollNewSolanaRegistrations, configPda, registrationPda, CURSOR_KEY };
