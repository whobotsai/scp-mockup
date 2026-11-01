// Manual end-to-end test, step 3 of 3 -- SSO counterpart of 03-claim.ts. Claims the keeper
// wallet's own reward once the 24h challenge window from sso-02-post-root.ts has actually
// elapsed. Run sso-01-create-campaign.ts and sso-02-post-root.ts first.
"use strict";
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { loadIdl, makeProvider, readTestCampaign } from "../lib";

const STATE_NAME = "test-campaign-sso";

function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}
// epoch_index is u16, so 2 raw bytes LE -- NOT the same width as SHO's u8 milestone_index
// seed (see SHO's own 03-claim.ts claimReceiptPda for that distinction).
function claimReceiptPda(programId: PublicKey, campaign: PublicKey, epochIndex: number, claimant: PublicKey): PublicKey {
  const idxBuf = Buffer.alloc(2);
  idxBuf.writeUInt16LE(epochIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), campaign.toBuffer(), idxBuf, claimant.toBuffer()],
    programId
  )[0];
}

async function main() {
  const { provider, wallet, connection } = makeProvider();
  const testCampaign = readTestCampaign(STATE_NAME);
  if (testCampaign.challengeWindowEnds === undefined) {
    console.error("No challenge window recorded -- run scripts/test/sso-02-post-root.ts first.");
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const endsAt = Number(testCampaign.challengeWindowEnds);
  if (now < endsAt) {
    const remainingMin = Math.ceil((endsAt - now) / 60);
    console.error(
      `Challenge window still open -- about ${remainingMin} more minutes (ends ${new Date(endsAt * 1000).toISOString()}).`
    );
    process.exit(1);
  }

  const programId = new PublicKey(testCampaign.programId);
  const idl = loadIdl("sso_solana");
  const program = new Program({ ...idl, address: programId.toBase58() } as any, provider);
  const campaign = new PublicKey(testCampaign.campaignAddress);

  console.log(`Campaign: ${campaign.toBase58()}`);
  console.log(`Claiming ${testCampaign.claimAmount} lamports for ${wallet.publicKey.toBase58()}...`);

  const before = await connection.getBalance(wallet.publicKey);
  const sig = await (program.methods as any)
    .claimSol(testCampaign.epochIndex, new BN(testCampaign.claimAmount), [] as number[][]) // single-leaf tree -- no sibling hashes needed
    .accounts({
      claimant: wallet.publicKey,
      config: configPda(programId),
      campaign,
      claimReceipt: claimReceiptPda(programId, campaign, testCampaign.epochIndex, wallet.publicKey),
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  console.log(`Tx sig: ${sig}`);

  const after = await connection.getBalance(wallet.publicKey);
  console.log(`Balance change: ${(after - before) / 1e9} SOL (claim minus this tx's own fee + claim_receipt rent)`);
  console.log("Claimed successfully -- the full SSO lifecycle now works end-to-end on this cluster.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
