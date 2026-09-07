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

  suite("Registry — one wallet per X handle (regression: a handle could otherwise be linked from multiple wallets)");
  {
    const registry = await deploy("Registry", deployer, owner.address, attestorWallet.address);
    const [, , , , carol, dave] = await ethers.getSigners();

    await test("a handle already linked to a different wallet cannot be registered again elsewhere", async () => {
      const carolSig = await signAttestation(attestorWallet, carol.address, "@shared_handle");
      await registry.connect(carol).registerHandle("@shared_handle", carolSig);

      const daveSig = await signAttestation(attestorWallet, dave.address, "@shared_handle");
      await assertReverts(
        registry.connect(dave).registerHandle("@shared_handle", daveSig),
        "handle already linked to another wallet"
      );
    });

    await test("the check is case-insensitive, matching keeper/src/db.js's lower(x_handle) lookup", async () => {
      const daveSig = await signAttestation(attestorWallet, dave.address, "@Shared_Handle");
      await assertReverts(
        registry.connect(dave).registerHandle("@Shared_Handle", daveSig),
        "handle already linked to another wallet"
      );
    });

    await test("the same wallet re-registering the same handle (any case) is a harmless no-op, not a self-block", async () => {
      const carolSig = await signAttestation(attestorWallet, carol.address, "@shared_handle");
      await registry.connect(carol).registerHandle("@shared_handle", carolSig);
      const stored = await registry.handleOf(carol.address);
      if (stored !== "@shared_handle") throw new Error("re-registration by the same wallet should still succeed");
    });

    await test("switching a wallet to a new handle releases its old handle for anyone else to claim", async () => {
      const carolSig = await signAttestation(attestorWallet, carol.address, "@carols_new_handle");
      await registry.connect(carol).registerHandle("@carols_new_handle", carolSig);

      const daveSig = await signAttestation(attestorWallet, dave.address, "@shared_handle");
      await registry.connect(dave).registerHandle("@shared_handle", daveSig);
      const stored = await registry.handleOf(dave.address);
      if (stored !== "@shared_handle") throw new Error("expected dave to pick up the released handle");
    });
  }

  summary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
