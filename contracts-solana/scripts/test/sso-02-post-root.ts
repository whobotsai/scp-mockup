// Manual end-to-end test, step 2 of 3 -- SSO counterpart of 02-post-root.ts. Posts a Merkle
// root as the keeper (the same AUTHORITY_KEYPAIR as sso-01-create-campaign.ts, since
// scripts/initialize.ts defaults config.keeper to the authority's own address unless
// KEEPER_ADDRESS was overridden). Builds the simplest possible tree: a single leaf, the
// keeper wallet claiming the campaign's entire locked pool. Run sso-01-create-campaign.ts
// first, and wait for epoch 0's ends_at (printed by that script) to actually pass --
// post_epoch_root reverts with EpochNotYetEnded otherwise, unlike SHO's post_milestone_root
// which the keeper can call as soon as it decides a milestone was reached.
"use strict";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";
import { buildTree } from "../../tests/helpers/merkle";
import { loadIdl, makeProvider, programIdFromAnchorToml, readTestCampaign, writeTestCampaign } from "../lib";

const STATE_NAME = "test-campaign-sso";

function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

async function main() {
  const { provider, wallet } = makeProvider();
  const testCampaign = readTestCampaign(STATE_NAME);

  const now = Math.floor(Date.now() / 1000);
  if (now < testCampaign.epoch0EndsAt) {
    const remainingMin = Math.ceil((testCampaign.epoch0EndsAt - now) / 60);
    console.error(
      `Epoch 0 hasn't ended yet -- about ${remainingMin} more minutes (ends ${new Date(testCampaign.epoch0EndsAt * 1000).toISOString()}).`
    );
    process.exit(1);
  }

  const programId = new PublicKey(testCampaign.programId);
  const idl = loadIdl("sso_solana");
  const program = new Program({ ...idl, address: programId.toBase58() } as any, provider);

  const campaign = new PublicKey(testCampaign.campaignAddress);
  const campaignAcct = await (program.account as any).campaign.fetch(campaign);
  const totalLocked = BigInt(campaignAcct.totalLocked.toString());

  console.log(`Campaign: ${campaign.toBase58()}`);
  console.log(`Total locked: ${totalLocked} lamports`);

  const epochIndex = 0;
  const claimAmount = totalLocked; // sole "winner" claims the whole pool, same as SHO's own test
  const tree = buildTree([{ account: wallet.publicKey, amount: claimAmount }]);
  const snapshotHash = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes("manual-test-snapshot")));

  console.log("Posting epoch root as keeper...");
  const sig = await (program.methods as any)
    .postEpochRoot(epochIndex, Array.from(tree.root), Array.from(snapshotHash))
    .accounts({
      keeper: wallet.publicKey,
      config: configPda(programId),
      campaign,
    } as any)
    .rpc();
  console.log(`Tx sig: ${sig}`);

  const updated = await (program.account as any).campaign.fetch(campaign);
  const challengeWindowEnds = updated.epochs[epochIndex].challengeWindowEnds.toString();
  console.log(`Challenge window ends: ${new Date(Number(challengeWindowEnds) * 1000).toISOString()}`);

  writeTestCampaign(
    {
      ...testCampaign,
      epochIndex,
      claimAmount: claimAmount.toString(),
      challengeWindowEnds,
    },
    STATE_NAME
  );
  console.log("\nWait for the challenge window above to pass (24h from now, a real on-chain clock --");
  console.log("not the bankrun test suite's simulated one), then run:");
  console.log("  npx ts-node scripts/test/sso-03-claim.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
