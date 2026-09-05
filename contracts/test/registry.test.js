// Run with: node test/registry.test.js
"use strict";
const { ethers } = require("hardhat");
const { suite, test, assertReverts, summary } = require("./helpers/harness");
const { deploy } = require("./helpers/deploy");

async function signAttestation(attestorWallet, wallet, xHandle) {
  const digest = ethers.keccak256(
    ethers.solidityPacked(["address", "string"], [wallet, xHandle])
  );
  return attestorWallet.signMessage(ethers.getBytes(digest));
}

async function main() {
  const [deployer, owner, alice, bob] = await ethers.getSigners();
  const attestorWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  const wrongWallet = ethers.Wallet.createRandom().connect(ethers.provider);

  suite("Registry — attestation-gated handle linking");
  {
    const registry = await deploy("Registry", deployer, owner.address, attestorWallet.address);

    await test("registerHandle succeeds with a valid attestation from the configured attestor", async () => {
      const sig = await signAttestation(attestorWallet, alice.address, "@alice_onchain");
      await registry.connect(alice).registerHandle("@alice_onchain", sig);
      const stored = await registry.handleOf(alice.address);
      if (stored !== "@alice_onchain") throw new Error(`expected @alice_onchain, got ${stored}`);
    });

    await test("registerHandle reverts against a signature from a non-attestor key", async () => {
      const sig = await signAttestation(wrongWallet, bob.address, "@bob_onchain");
      await assertReverts(registry.connect(bob).registerHandle("@bob_onchain", sig), "bad attestation");
    });

    await test("an attestation is bound to both the wallet and the handle — can't be replayed for a different handle", async () => {
      const sig = await signAttestation(attestorWallet, alice.address, "@alice_onchain");
      await assertReverts(registry.connect(alice).registerHandle("@someone_else", sig), "bad attestation");
    });

    await test("only the owner can rotate the attestor", async () => {
      // OZ v5's Ownable reverts with the OwnableUnauthorizedAccount custom error rather
      // than a string reason; 0x118cdaa7 is that error's selector.
      await assertReverts(registry.connect(bob).setAttestor(bob.address), "0x118cdaa7");
      await registry.connect(owner).setAttestor(wrongWallet.address);
      const sig = await signAttestation(wrongWallet, bob.address, "@bob_onchain");
      await registry.connect(bob).registerHandle("@bob_onchain", sig);
      const stored = await registry.handleOf(bob.address);
      if (stored !== "@bob_onchain") throw new Error("registration after attestor rotation failed");
    });
  }

  summary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
