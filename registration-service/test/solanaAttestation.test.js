"use strict";
const { Keypair } = require("@solana/web3.js");
const { testAsync, assertEqual, summary } = require("./helpers/harness");
const { signSolanaMessage, verifySolanaSignature } = require("../src/solanaAttestation");

async function main() {
  const attestor = Keypair.generate();
  const wrongAttestor = Keypair.generate();
  const message = Buffer.from("fake transaction message bytes -- wallet + register_handle(@alice_onchain)");

  await testAsync("verifySolanaSignature verifies a signature from the real attestor", async () => {
    const sig = signSolanaMessage(attestor, message);
    assertEqual(verifySolanaSignature(attestor.publicKey, message, sig), true);
  });

  await testAsync("a signature from a different key does not verify against the real attestor's pubkey", async () => {
    const sig = signSolanaMessage(wrongAttestor, message);
    assertEqual(verifySolanaSignature(attestor.publicKey, message, sig), false);
  });

  await testAsync("a signature does not verify against different message bytes", async () => {
    const sig = signSolanaMessage(attestor, message);
    const tampered = Buffer.from("fake transaction message bytes -- wallet + register_handle(@mallory)");
    assertEqual(verifySolanaSignature(attestor.publicKey, tampered, sig), false);
  });

  summary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
