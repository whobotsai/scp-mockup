// Manual end-to-end test, step 1 of 3 -- Solana counterpart of
// ../../../contracts/scripts/test/01-create-campaign.js, same shape: creates one real SHO
// campaign on whatever cluster SOLANA_RPC_URL points at, native-SOL reward, a single
// milestone paying out 100% of the pool. Run this entirely from the terminal (curl-style
// workflow) -- no browser or wallet extension needed, same as the EVM test scripts.
//
// Unlike EVM, post_milestone_root (step 2) has no on-chain price/market-cap check at all --
// it's a plain keeper-signed instruction, nothing enforces that the milestone was actually
// reached by real trading -- so this whole flow validates claim_sol end-to-end without ever
// touching Birdeye/DexScreener, using a placeholder token the same way this script's EVM
// counterpart uses the deployer's own address as an obviously-fake token.
//
// Needs scripts/initialize.ts already run against the same cluster (so config exists), and
// AUTHORITY_KEYPAIR here must be config.keeper too for step 2 to work -- true by default if
// initialize.ts ran without overriding KEEPER_ADDRESS (see that script's own comment).
//
// Usage: SOLANA_RPC_URL=... AUTHORITY_KEYPAIR=... npx ts-node scripts/test/01-create-campaign.ts [amountSol=0.05]
"use strict";
import { BN, Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { loadIdl, makeProvider, programIdFromAnchorToml, writeTestCampaign } from "../lib";

const WINDOW = { h24: {} };
const TIER = { m100K: {} };
const DURATION_SECS = 7 * 24 * 60 * 60;

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
  const programId = programIdFromAnchorToml("sho_solana");
  const idl = loadIdl("sho_solana");
  const program = new Program({ ...idl, address: programId.toBase58() } as any, provider);

  const config = configPda(programId);
  const configAcct = await (program.account as any).config.fetch(config);
  const id: bigint = BigInt(configAcct.nextId.toString());
  const campaign = campaignPda(programId, config, id);

  // Same "deployer's own address as an obviously-fake placeholder, never read on-chain"
  // reasoning as 01-create-campaign.js's EVM placeholderToken -- a real campaign needs a
  // real mint for the keeper/API's price-sampling and leaderboard to mean anything.
  const placeholderToken = wallet.publicKey;
  const amountLamports = new BN(Math.round(amountSol * LAMPORTS_PER_SOL));

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < amountLamports.toNumber() + 0.01 * LAMPORTS_PER_SOL) {
    console.error(`Balance too low for a ${amountSol} SOL campaign plus rent/fees.`);
    process.exit(1);
  }

  console.log("Creating test SHO campaign...");
  const sig = await (program.methods as any)
    .createCampaignSol(
      new BN(id.toString()),
      placeholderToken,
      amountLamports,
      WINDOW,
      50,
      new BN(DURATION_SECS),
      [TIER],
      [10000]
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

  writeTestCampaign({
    programId: programId.toBase58(),
    campaignId: id.toString(),
    campaignAddress: campaign.toBase58(),
    createdAt: new Date().toISOString(),
  });
  console.log("\nNext: npx ts-node scripts/test/02-post-root.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
