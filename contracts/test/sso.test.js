// Run with: node test/sso.test.js
"use strict";
const { ethers } = require("hardhat");
const { suite, test, assertReverts, summary } = require("./helpers/harness");
const { deploy, attach } = require("./helpers/deploy");
const { buildTree } = require("./helpers/merkle");

const EPOCH_LEN = { H24: 0, D7: 1, D30: 2 };
const DAY = 24 * 60 * 60;

async function timeTravel(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function main() {
  const [deployer, owner, treasury, keeper, creator, shiller1, stranger] = await ethers.getSigners();

  suite("SSOFactory + SSOCampaign — full epoch lifecycle");
  {
    const factory = await deploy("SSOFactory", deployer, owner.address, treasury.address, keeper.address);
    const lockAmount = ethers.parseEther("5");
    const epochBps = [5000, 5000]; // two 24h epochs, split evenly

    let campaignAddr;
    await test("createCampaign deploys a clone with the tracked keyword and schedules epoch endsAt", async () => {
      const tx = await factory
        .connect(creator)
        .createCampaign(
          ethers.Wallet.createRandom().address,
          ethers.ZeroAddress,
          lockAmount,
          "#TestKeyword",
          EPOCH_LEN.H24,
          50,
          7 * DAY,
          epochBps,
          { value: lockAmount }
        );
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
        .find((l) => l && l.name === "CampaignCreated");
      if (!created) throw new Error("CampaignCreated not emitted");
      if (created.args.keyword !== "#TestKeyword") throw new Error("keyword mismatch");
      campaignAddr = created.args.campaign;
    });

    const campaign = () => attach("SSOCampaign", campaignAddr, ethers.provider);

    await test("epoch 0 ends ~24h after creation, epoch 1 ~48h after", async () => {
      const e0 = await campaign().getEpoch(0);
      const e1 = await campaign().getEpoch(1);
      const createdAt = await campaign().createdAt();
      if (e0.endsAt !== createdAt + BigInt(DAY)) throw new Error("epoch 0 endsAt mismatch");
      if (e1.endsAt !== createdAt + BigInt(DAY) * 2n) throw new Error("epoch 1 endsAt mismatch");
    });

    await test("keeper cannot finalize epoch 0 before its scheduled window closes", async () => {
      await assertReverts(
        campaign().connect(keeper).postEpochRoot(0, ethers.ZeroHash, ethers.ZeroHash),
        "epoch not yet ended"
      );
    });

    await test("a non-keeper cannot post an epoch root even after it ends", async () => {
      await timeTravel(DAY + 1);
      await assertReverts(
        campaign().connect(stranger).postEpochRoot(0, ethers.ZeroHash, ethers.ZeroHash),
        "not keeper"
      );
    });

    const reward = ethers.parseEther("1");
    const tree = buildTree([{ account: shiller1.address, amount: reward }]);

    await test("keeper finalizes epoch 0 once it has ended", async () => {
      const tx = await campaign().connect(keeper).postEpochRoot(0, tree.root, ethers.id("snap-0"));
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l) => { try { return campaign().interface.parseLog(l); } catch { return null; } })
        .find((l) => l && l.name === "EpochFinalized");
      if (!ev) throw new Error("EpochFinalized not emitted");
    });

    await test("claim reverts while epoch 0's challenge window is open", async () => {
      await assertReverts(
        campaign().connect(shiller1).claim(0, reward, tree.proofFor(0)),
        "challenge window open"
      );
    });

    await test("claim succeeds once the challenge window elapses, paid in ETH", async () => {
      await timeTravel(DAY + 1);
      const before = await ethers.provider.getBalance(shiller1.address);
      const tx = await campaign().connect(shiller1).claim(0, reward, tree.proofFor(0));
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(shiller1.address);
      const got = after - before + gasCost;
      if (got !== reward) throw new Error(`expected +${reward}, got +${got}`);
    });

    await test("epoch 1 is still untouched (not finalized)", async () => {
      const e1 = await campaign().getEpoch(1);
      if (e1.finalized) throw new Error("epoch 1 should not be finalized yet");
    });

    await test("status() is Expired once the campaign duration elapses with epoch 1 unfinalized", async () => {
      await timeTravel(7 * DAY);
      const s = await campaign().status();
      if (s !== 2n) throw new Error(`expected Expired(2), got ${s}`);
    });
  }

  summary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
