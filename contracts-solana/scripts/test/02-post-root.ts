// Manual end-to-end test, step 2 of 3 -- Solana counterpart of
// ../../../contracts/scripts/test/02-post-root.js. Posts a Merkle root as the keeper (the
// same AUTHORITY_KEYPAIR as 01-create-campaign.ts, since scripts/initialize.ts defaults
// config.keeper to the authority's own address unless KEEPER_ADDRESS was overridden). Builds
// the simplest possible tree: a single leaf, the keeper wallet claiming the campaign's
// entire locked pool. Run 01-create-campaign.ts first.
"use strict";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";
import { buildTree } from "../../tests/helpers/merkle";
import { loadIdl, makeProvider, programIdFromAnchorToml, readTestCampaign, writeTestCampaign } from "../lib";

function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

async function main() {
  const { provider, wallet } = makeProvider();
  const testCampaign = readTestCampaign();
  const programId = new PublicKey(testCampaign.programId);
  const idl = loadIdl("sho_solana");
  const program = new Program({ ...idl, address: programId.toBase58() } as any, provider);

  const campaign = new PublicKey(testCampaign.campaignAddress);
  const campaignAcct = await (program.account as any).campaign.fetch(campaign);
  const totalLocked = BigInt(campaignAcct.totalLocked.toString());

  console.log(`Campaign: ${campaign.toBase58()}`);
  console.log(`Total locked: ${totalLocked} lamports`);

  const milestoneIndex = 0;
  const claimAmount = totalLocked; // sole "winner" claims the whole pool, same as the EVM test
  const tree = buildTree([{ account: wallet.publicKey, amount: claimAmount }]);
  const snapshotHash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes("manual-test-snapshot")));

  console.log("Posting milestone root as keeper...");
  const sig = await (program.methods as any)
    .postMilestoneRoot(milestoneIndex, Array.from(tree.root), Array.from(snapshotHash))
    .accounts({
      keeper: wallet.publicKey,
      config: configPda(programId),
      campaign,
    } as any)
    .rpc();
  console.log(`Tx sig: ${sig}`);

  const updated = await (program.account as any).campaign.fetch(campaign);
  const challengeWindowEnds = updated.milestones[milestoneIndex].challengeWindowEnds.toString();
  console.log(`Challenge window ends: ${new Date(Number(challengeWindowEnds) * 1000).toISOString()}`);

  writeTestCampaign({
    ...testCampaign,
    milestoneIndex,
    claimAmount: claimAmount.toString(),
    challengeWindowEnds,
  });
  console.log("\nWait for the challenge window above to pass (24h from now, a real on-chain clock --");
  console.log("not the bankrun test suite's simulated one), then run:");
  console.log("  npx ts-node scripts/test/03-claim.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
