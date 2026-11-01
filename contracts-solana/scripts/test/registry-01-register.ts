// Manual end-to-end test for registry_solana -- single step, unlike SHO/SSO's 3-step
// create/post-root/claim flow, since register_handle is the whole lifecycle (link a wallet to
// an X handle once, on-chain; nothing to wait on afterward).
//
// register_handle needs TWO signers -- `wallet` and `attestor` -- see
// contracts-solana/programs/registry_solana/src/lib.rs's own module header for why this
// program uses a co-signer instead of an on-chain Ed25519 signature check the way an EVM
// attestation would. Defaults ATTESTOR_KEYPAIR to the same key as AUTHORITY_KEYPAIR (one
// keypair signing both roles in the same transaction, which Solana allows -- an account can
// appear in a transaction's account list more than once) so this runs with zero extra setup
// against a fresh scripts/initialize.ts run, where config.attestor defaults to the
// authority's own address unless ATTESTOR_ADDRESS was overridden. Pass a real, different
// ATTESTOR_KEYPAIR for a more realistic test once you have one.
//
// Needs scripts/initialize.ts already run against the same cluster (so config exists).
//
// Usage: SOLANA_RPC_URL=... AUTHORITY_KEYPAIR=... [ATTESTOR_KEYPAIR=...] [xHandle=@DiamondHandManualTest] \
//   npx ts-node scripts/test/registry-01-register.ts
"use strict";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { normalizedHandleKey } from "../../tests/helpers/merkle";
import { loadIdl, loadKeypair, makeProvider, programIdFromAnchorToml } from "../lib";

function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}
function handleLinkPda(programId: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("handle"), wallet.toBuffer()], programId)[0];
}
function walletOfHandlePda(programId: PublicKey, xHandle: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("wallet_of_handle"), normalizedHandleKey(xHandle)], programId)[0];
}
function registrationPda(programId: PublicKey, config: PublicKey, nextRegistrationId: bigint): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(nextRegistrationId);
  return PublicKey.findProgramAddressSync([Buffer.from("registration"), config.toBuffer(), idBuf], programId)[0];
}

async function main() {
  const xHandle = process.env.xHandle || "@DiamondHandManualTest";
  const { provider, wallet } = makeProvider();
  const attestor = process.env.ATTESTOR_KEYPAIR ? loadKeypair(process.env.ATTESTOR_KEYPAIR) : wallet;

  const programId = programIdFromAnchorToml("registry_solana");
  const idl = loadIdl("registry_solana");
  const program = new Program({ ...idl, address: programId.toBase58() } as any, provider);

  const config = configPda(programId);
  const configAcct = await (program.account as any).config.fetch(config);
  console.log(`Wallet:    ${wallet.publicKey.toBase58()}`);
  console.log(`Attestor:  ${attestor.publicKey.toBase58()} (config.attestor: ${configAcct.attestor.toBase58()})`);
  if (!configAcct.attestor.equals(attestor.publicKey)) {
    console.error(
      "ATTESTOR_KEYPAIR's public key does not match config.attestor on-chain -- register_handle will revert with NotAttestor. " +
        "Either unset ATTESTOR_KEYPAIR to use AUTHORITY_KEYPAIR (if config.attestor is still the authority's default), or call set_attestor first."
    );
    process.exit(1);
  }
  console.log(`X handle:  ${xHandle}`);

  const nextRegistrationId = BigInt(configAcct.nextRegistrationId.toString());
  const handleLink = handleLinkPda(programId, wallet.publicKey);
  const walletOfHandle = walletOfHandlePda(programId, xHandle);
  const registration = registrationPda(programId, config, nextRegistrationId);

  const sameSigner = attestor.publicKey.equals(wallet.publicKey);
  console.log("Registering handle...");
  const sig = await (program.methods as any)
    .registerHandle(xHandle)
    .accounts({
      wallet: wallet.publicKey,
      attestor: attestor.publicKey,
      config,
      handleLink,
      walletOfHandle,
      registration,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers(sameSigner ? [wallet] : [wallet, attestor])
    .rpc();

  console.log(`Tx sig: ${sig}`);

  const linkAcct = await (program.account as any).handleLink.fetch(handleLink);
  console.log(`\nhandle_link:       ${handleLink.toBase58()} -> wallet=${linkAcct.wallet.toBase58()}, xHandle=${linkAcct.xHandle}`);
  console.log(`wallet_of_handle:  ${walletOfHandle.toBase58()}`);
  console.log(`registration #${nextRegistrationId}: ${registration.toBase58()}`);
  console.log("\nRegistered successfully. Running this again for the same wallet (any handle) will fail");
  console.log("with 'already in use' -- handle_link's PDA only depends on the wallet, and v1 allows");
  console.log("exactly one link per wallet, ever (see registry_solana/src/state.rs's own doc comment).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
