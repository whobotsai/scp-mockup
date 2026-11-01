// Manual end-to-end test, step 1 of 3 -- SSO counterpart of 01-create-campaign.ts, same
// shape: creates one real SSO campaign on whatever cluster SOLANA_RPC_URL points at,
// native-SOL reward, a single epoch paying out 100% of the pool. Run entirely from the
// terminal -- no browser or wallet extension needed.
//
// Unlike SHO's post_milestone_root, post_epoch_root (step 2) genuinely requires real time to
// pass -- it reverts with EpochNotYetEnded until the epoch's own ends_at (createdAt + epoch
// length) has actually elapsed, not just "whenever the keeper feels like it" the way SHO's
// milestone-reached call is. With H24 below, that means waiting a real ~24h before step 2
// can run, then another real 24h challenge window before step 3 can claim -- see that
// script's own header, same as 02-post-root.ts's caveat for SHO.
//
// Needs scripts/initialize.ts already run against the same cluster (so config exists), and
// AUTHORITY_KEYPAIR here must be config.keeper too for step 2 to work -- true by default if
// initialize.ts ran without overriding KEEPER_ADDRESS (see that script's own comment).
//
// Usage: SOLANA_RPC_URL=... AUTHORITY_KEYPAIR=... npx ts-node scripts/test/sso-01-create-campaign.ts [amountSol=0.05]
"use strict";
import { BN, Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { loadIdl, makeProvider, programIdFromAnchorToml, writeTestCampaign } from "../lib";

const EPOCH_LENGTH = { h24: {} };
const KEYWORD = "#DiamondHandManualTest";
const DURATION_SECS = 7 * 24 * 60 * 60; // must be exactly 7D/30D/90D -- see validate_campaign_params
const STATE_NAME = "test-campaign-sso";

function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}
function campaignPda(programId: PublicKey, configKey: PublicKey, id: bigint): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(id);
  return PublicKey.findProgramAddressSync([Buffer.from("campaign"), configKey.toBuffer(), idBuf], programId)[0];
}

async function main() {
  const amountSol = Number(process.argv[2] || "0.05");
  const { provider, wallet, connection } = makeProvider();
  const programId = programIdFromAnchorToml("sso_solana");
  const idl = loadIdl("sso_solana");
  const program = new Program({ ...idl, address: programId.toBase58() } as any, provider);

  const config = configPda(programId);
  const configAcct = await (program.account as any).config.fetch(config);
  const id: bigint = BigInt(configAcct.nextId.toString());
  const campaign = campaignPda(programId, config, id);

  // Same "deployer's own address as an obviously-fake placeholder, never read on-chain"
  // reasoning as SHO's own 01-create-campaign.ts.
  const placeholderToken = wallet.publicKey;
  const amountLamports = new BN(Math.round(amountSol * LAMPORTS_PER_SOL));

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < amountLamports.toNumber() + 0.01 * LAMPORTS_PER_SOL) {
    console.error(`Balance too low for a ${amountSol} SOL campaign plus rent/fees.`);
    process.exit(1);
  }

  console.log("Creating test SSO campaign...");
  const sig = await (program.methods as any)
    .createCampaignSol(
      new BN(id.toString()),
      placeholderToken,
      amountLamports,
      KEYWORD,
      EPOCH_LENGTH,
      50,
      new BN(DURATION_SECS),
      [10000] // single epoch, 100% of the pool
    )
    .accounts({
      creator: wallet.publicKey,
      config,
      campaign,
      treasury: configAcct.treasury,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();

  console.log(`Tx sig: ${sig}`);
  console.log(`Campaign id: ${id}`);
  console.log(`Campaign address: ${campaign.toBase58()}`);

  const campaignAcct = await (program.account as any).campaign.fetch(campaign);
  const epoch0EndsAt = Number(campaignAcct.epochs[0].endsAt.toString());
  console.log(`Epoch 0 ends at: ${new Date(epoch0EndsAt * 1000).toISOString()} (wait for this before step 2)`);

  writeTestCampaign(
    {
      programId: programId.toBase58(),
      campaignId: id.toString(),
      campaignAddress: campaign.toBase58(),
      epoch0EndsAt,
      createdAt: new Date().toISOString(),
    },
    STATE_NAME
  );
  console.log("\nNext (once epoch 0 has ended): npx ts-node scripts/test/sso-02-post-root.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
