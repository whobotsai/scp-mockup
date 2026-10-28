// Solana counterpart of onchainPoster.js: turns a published snapshot into an on-chain
// post_milestone_root (SHO) or post_epoch_root (SSO) instruction. One shared module for both,
// dispatching on the snapshot's campaign row's `factory` column -- same shared-dispatch shape
// onchainPoster.js already uses for EVM.
//
// Signer model: mirrors onchainPoster.js's own documented simplification exactly, for the
// same reason. The design doc's 3-of-5 Gnosis Safe (EVM) implies an equivalent Solana
// multisig (e.g. Squads) as its counterpart -- standing one up needs real signer keys and its
// own deployment, out of scope for this solo dev/testnet-equivalent validation pass. This
// module instead signs directly with a single keypair loaded from SOLANA_KEEPER_PRIVATE_KEY
// (base58-encoded secret key, the format Phantom/most Solana wallets export), which must be
// the same pubkey both programs' Config.keeper already points at (see
// scripts/... there is no Solana equivalent of initialize-config scripts yet -- see
// contracts-solana/README.md's own next-steps list). root_submissions tracks proposed/
// confirmed exactly as the EVM path does, so swapping in a real multisig later changes *how* a
// root gets signed, not the idempotency/tracking model around it. Revisit before any Solana
// campaign with real funds goes live (see docs/MAINNET_CHECKLIST.md Phase 3).
//
// Never run against a live program (contracts-solana/ has never been deployed anywhere, see
// its own README) -- the pure encoding helpers below (anchorDiscriminator,
// buildPostRootInstruction) are unit-tested; the orchestration function itself
// (postPendingSolanaRoots) is not, matching onchainPoster.js's own precedent of validating
// orchestration-level, heavily-I/O modules live rather than with mocks.
"use strict";
const crypto = require("crypto");
const { PublicKey, Transaction, TransactionInstruction, Keypair, sendAndConfirmTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const { configPda } = require("./solanaCampaignIndexer");
const { decodeShoCampaign, decodeSsoCampaign } = require("./abis/solana");
const db = require("./db");

/// Everything that differs between SHO and SSO for this module, in one place -- same shape as
/// onchainPoster.js's own FACTORY_CONFIG.
const FACTORY_CONFIG = {
  sho: {
    label: "milestone",
    ixName: "post_milestone_root",
    programIdEnv: "SHO_SOLANA_PROGRAM_ID",
    indexByteLen: 1, // milestone_index: u8
    writeIndex: (buf, index) => buf.writeUInt8(index, 0),
    isAlreadyFinalized: (data, index) => !!decodeShoCampaign(data).milestones[index]?.reached,
  },
  sso: {
    label: "epoch",
    ixName: "post_epoch_root",
    programIdEnv: "SSO_SOLANA_PROGRAM_ID",
    indexByteLen: 2, // epoch_index: u16
    writeIndex: (buf, index) => buf.writeUInt16LE(index, 0),
    isAlreadyFinalized: (data, index) => !!decodeSsoCampaign(data).epochs.find((e) => e.epochIndex === index)?.finalized,
  },
};

/// Anchor's instruction discriminator: the first 8 bytes of sha256("global:<ix_name>"). Same
/// derivation the frontend's buildAnchorIx() uses (public/index.html), just via Node's native
/// crypto instead of the browser's Web Crypto -- the two must stay in lockstep, since both
/// target the same deployed program.
function anchorDiscriminator(ixName) {
  return crypto.createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

function hexToBytes32(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const buf = Buffer.from(clean, "hex");
  if (buf.length !== 32) throw new Error(`hexToBytes32: expected 32 bytes, got ${buf.length} (input ${hex})`);
  return buf;
}

/// Pure function (no I/O): builds the post_milestone_root/post_epoch_root TransactionInstruction.
/// The campaign account is the row's own campaign_address directly (not re-derived from a PDA
/// seed+id) -- we already know its address from having discovered/indexed it.
function buildPostRootInstruction({ programId, keeperPubkey, campaignPubkey, factory, index, merkleRootHex, snapshotHashHex }) {
  const cfg = FACTORY_CONFIG[factory];
  const discriminator = anchorDiscriminator(cfg.ixName);
  const indexBuf = Buffer.alloc(cfg.indexByteLen);
  cfg.writeIndex(indexBuf, index);
  const data = Buffer.concat([discriminator, indexBuf, hexToBytes32(merkleRootHex), hexToBytes32(snapshotHashHex)]);

  const keys = [
    { pubkey: keeperPubkey, isSigner: true, isWritable: false },
    { pubkey: configPda(programId), isSigner: false, isWritable: false },
    { pubkey: campaignPubkey, isSigner: false, isWritable: true },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

function loadKeeperKeypair() {
  const secret = process.env.SOLANA_KEEPER_PRIVATE_KEY;
  if (!secret) return null;
  return Keypair.fromSecretKey(bs58.decode(secret));
}

async function postPendingSolanaRoots(connection, keeperKeypair) {
  const pending = await db.unpostedSnapshots();

  for (const snapshot of pending) {
    const campaignRow = await db.getCampaign(snapshot.campaign_address);
    if (!campaignRow || campaignRow.network !== "solana" || !FACTORY_CONFIG[campaignRow.factory]) {
      continue; // not ours -- onchainPoster.js (EVM) handles every other row
    }
    const cfg = FACTORY_CONFIG[campaignRow.factory];

    const programIdStr = process.env[cfg.programIdEnv];
    if (!programIdStr) {
      console.error(`[solanaOnchainPoster] ${cfg.programIdEnv} not set -- cannot post ${snapshot.campaign_address} ${cfg.label} ${snapshot.index}`);
      continue;
    }

    try {
      const programId = new PublicKey(programIdStr);
      const campaignPubkey = new PublicKey(snapshot.campaign_address);

      // Same defensive pre-check onchainPoster.js's own header documents learning the hard
      // way: blindly posting again after a crash between "transaction confirmed" and
      // "bookkeeping recorded" would hit the program's *correction* path, silently resetting
      // a challenge window on a milestone/epoch nothing is wrong with.
      const campaignInfo = await connection.getAccountInfo(campaignPubkey);
      if (!campaignInfo) {
        console.error(`[solanaOnchainPoster] ${snapshot.campaign_address}: campaign account not found on-chain -- skipping`);
        continue;
      }
      if (cfg.isAlreadyFinalized(campaignInfo.data, snapshot.index)) {
        await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "confirmed", txHash: null });
        await db.markSnapshotPosted(snapshot.campaign_address, snapshot.index);
        console.log(
          `[solanaOnchainPoster] ${snapshot.campaign_address} ${cfg.label} ${snapshot.index}: already finalized on-chain -- backfilled bookkeeping, no transaction sent`
        );
        continue;
      }

      const ix = buildPostRootInstruction({
        programId,
        keeperPubkey: keeperKeypair.publicKey,
        campaignPubkey,
        factory: campaignRow.factory,
        index: snapshot.index,
        merkleRootHex: snapshot.merkle_root,
        snapshotHashHex: snapshot.snapshot_hash,
      });

      console.log(`[solanaOnchainPoster] posting ${snapshot.campaign_address} ${cfg.label} ${snapshot.index}...`);
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [keeperKeypair]);

      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "confirmed", txHash: sig });
      await db.markSnapshotPosted(snapshot.campaign_address, snapshot.index);
      console.log(`[solanaOnchainPoster] ${snapshot.campaign_address} ${cfg.label} ${snapshot.index}: posted, tx=${sig}`);
    } catch (e) {
      await db.upsertRootSubmission({ campaignAddress: snapshot.campaign_address, index: snapshot.index, status: "failed", txHash: null });
      console.error(`[solanaOnchainPoster] ${snapshot.campaign_address} ${cfg.label} ${snapshot.index}: post failed:`, e.message);
    }
  }
}

module.exports = { postPendingSolanaRoots, buildPostRootInstruction, anchorDiscriminator, hexToBytes32, loadKeeperKeypair, FACTORY_CONFIG };
