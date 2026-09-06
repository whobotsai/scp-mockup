"use strict";
const { ethers } = require("ethers");
const { testAsync, assertEqual, summary } = require("./helpers/harness");
const { signAttestation, recoverAttestor } = require("../src/attestation");

async function main() {
  const attestor = ethers.Wallet.createRandom();
  const wrongAttestor = ethers.Wallet.createRandom();
  const wallet = ethers.Wallet.createRandom().address;

  await testAsync("recoverAttestor recovers the signer that actually signed", async () => {
    const sig = await signAttestation(attestor, wallet, "@alice_onchain");
    assertEqual(recoverAttestor(wallet, "@alice_onchain", sig), attestor.address);
  });

  await testAsync("a signature from a different key does not recover to the real attestor", async () => {
    const sig = await signAttestation(wrongAttestor, wallet, "@alice_onchain");
    const recovered = recoverAttestor(wallet, "@alice_onchain", sig);
    if (recovered === attestor.address) throw new Error("wrong-key signature should not recover to attestor");
  });

  await testAsync("an attestation is bound to the exact handle -- doesn't recover for a different one", async () => {
    const sig = await signAttestation(attestor, wallet, "@alice_onchain");
    const recovered = recoverAttestor(wallet, "@someone_else", sig);
    if (recovered === attestor.address) throw new Error("attestation should not verify against a different handle");
  });

  await testAsync("an attestation is bound to the exact wallet -- doesn't recover for a different one", async () => {
    const otherWallet = ethers.Wallet.createRandom().address;
    const sig = await signAttestation(attestor, wallet, "@alice_onchain");
    const recovered = recoverAttestor(otherWallet, "@alice_onchain", sig);
    if (recovered === attestor.address) throw new Error("attestation should not verify against a different wallet");
  });

  await testAsync("signAttestation rejects a malformed wallet address", async () => {
    let threw = false;
    try {
      await signAttestation(attestor, "not-an-address", "@alice_onchain");
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("expected signAttestation to reject an invalid address");
  });

  summary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
