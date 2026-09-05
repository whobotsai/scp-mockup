// Run with: node test/sho.test.js
"use strict";
const { ethers } = require("hardhat");
const { suite, test, assertReverts, summary } = require("./helpers/harness");
const { deploy, attach } = require("./helpers/deploy");
const { buildTree } = require("./helpers/merkle");

const WINDOW = { H24: 0, D7: 1, D30: 2 };
const TIER = { M100K: 0, M250K: 1, M1M: 2, M5M: 3 };
const DAY = 24 * 60 * 60;

async function timeTravel(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function main() {
  const [deployer, owner, treasury, keeper, creator, trader1, trader2, stranger] =
    await ethers.getSigners();

  // ---- ETH reward-path: full happy-path lifecycle -------------------------------------
  suite("SHOFactory + SHOCampaign — ETH reward path");
  {
    const factory = await deploy("SHOFactory", deployer, owner.address, treasury.address, keeper.address);

    const lockAmount = ethers.parseEther("10");
    const tiers = [TIER.M100K, TIER.M250K];
    const bps = [4000, 6000]; // 40% / 60%, sums to 10000

    let campaignAddr;
    await test("createCampaign deploys a clone and splits the protocol fee", async () => {
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      const tx = await factory
        .connect(creator)
        .createCampaign(
          ethers.Wallet.createRandom().address, // token (tracked off-chain only)
          ethers.ZeroAddress, // rewardToken = native ETH
          lockAmount,
          WINDOW.D7,
          100,
          30 * DAY,
          tiers,
          bps,
          { value: lockAmount }
        );
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
        .find((l) => l && l.name === "CampaignCreated");
      if (!created) throw new Error("CampaignCreated not emitted");
      campaignAddr = created.args.campaign;

      const fee = (lockAmount * 50n) / 10000n;
      const net = lockAmount - fee;
      const campaignBalance = await ethers.provider.getBalance(campaignAddr);
      if (campaignBalance !== net) throw new Error(`campaign balance ${campaignBalance} != net ${net}`);
      const treasuryAfter = await ethers.provider.getBalance(treasury.address);
      if (treasuryAfter - treasuryBefore !== fee) throw new Error("treasury did not receive the fee");
    });

    const campaign = () => attach("SHOCampaign", campaignAddr, ethers.provider);

    await test("status() is Active right after creation", async () => {
      const s = await campaign().status();
      if (s !== 0n) throw new Error(`expected Active(0), got ${s}`);
    });

    await test("milestoneCount reflects the two configured tiers", async () => {
      const n = await campaign().milestoneCount();
      if (n !== 2n) throw new Error(`expected 2, got ${n}`);
    });

    await test("a non-keeper cannot post a milestone root", async () => {
      await assertReverts(
        campaign().connect(stranger).postMilestoneRoot(0, ethers.ZeroHash, ethers.ZeroHash),
        "not keeper"
      );
    });

    const rewardAmount = ethers.parseEther("1");
    const tree = buildTree([{ account: trader1.address, amount: rewardAmount }]);

    await test("keeper posts a root for milestone 0 and MilestoneReached fires", async () => {
      const tx = await campaign().connect(keeper).postMilestoneRoot(0, tree.root, ethers.id("snapshot-0"));
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l) => { try { return campaign().interface.parseLog(l); } catch { return null; } })
        .find((l) => l && l.name === "MilestoneReached");
      if (!ev) throw new Error("MilestoneReached not emitted");
    });

    await test("claim reverts while the 24h challenge window is still open", async () => {
      await assertReverts(
        campaign().connect(trader1).claim(0, rewardAmount, tree.proofFor(0)),
        "challenge window open"
      );
    });

    await test("the keeper can still correct the root before the window elapses", async () => {
      const corrected = buildTree([{ account: trader2.address, amount: rewardAmount }]);
      await campaign().connect(keeper).postMilestoneRoot(0, corrected.root, ethers.id("snapshot-0-fixed"));
      // put the original root back so the rest of the suite proceeds against trader1
      await campaign().connect(keeper).postMilestoneRoot(0, tree.root, ethers.id("snapshot-0"));
    });

    await timeTravel(DAY + 1);

    await test("claim reverts against a wrong amount/proof (checked once the window is open)", async () => {
      await assertReverts(
        campaign().connect(trader1).claim(0, rewardAmount + 1n, tree.proofFor(0)),
        "bad proof"
      );
    });

    await test("claim succeeds once the challenge window has elapsed", async () => {
      const before = await ethers.provider.getBalance(trader1.address);
      const tx = await campaign().connect(trader1).claim(0, rewardAmount, tree.proofFor(0));
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(trader1.address);
      const got = after - before + gasCost;
      if (got !== rewardAmount) throw new Error(`expected +${rewardAmount}, got +${got}`);
    });

    await test("a second claim on the same milestone reverts", async () => {
      await assertReverts(
        campaign().connect(trader1).claim(0, rewardAmount, tree.proofFor(0)),
        "already claimed"
      );
    });

    await test("the keeper can no longer correct milestone 0 once its window elapsed", async () => {
      await assertReverts(
        campaign().connect(keeper).postMilestoneRoot(0, ethers.id("late"), ethers.id("late-snap")),
        "challenge window elapsed"
      );
    });

    await test("milestone 1 is untouched and still not reached", async () => {
      const m = await campaign().getMilestone(1);
      if (m.reached) throw new Error("milestone 1 should not be reached");
    });

    await test("status() reads Expired once duration has elapsed with milestone 1 unreached", async () => {
      await timeTravel(30 * DAY);
      const s = await campaign().status();
      if (s !== 2n) throw new Error(`expected Expired(2), got ${s}`);
    });

    await test("the unreached milestone's share has no withdraw/sweep path — the ABI exposes none", async () => {
      const { loadArtifact } = require("./helpers/deploy");
      const abi = loadArtifact("SHOCampaign").abi;
      const suspicious = abi.filter(
        (f) => f.type === "function" && /withdraw|sweep|recover|rescue/i.test(f.name)
      );
      if (suspicious.length > 0) {
        throw new Error(`found a fund-recovery function that shouldn't exist: ${suspicious.map((f) => f.name)}`);
      }
      // and the tokens are still sitting right there, permanently
      const bal = await ethers.provider.getBalance(campaignAddr);
      if (bal === 0n) throw new Error("expected the unreached milestone's share to remain locked");
    });
  }

  // ---- validation reverts on creation ---------------------------------------------------
  suite("SHOFactory — creation-time validation");
  {
    const factory = await deploy("SHOFactory", deployer, owner.address, treasury.address, keeper.address);
    const amount = ethers.parseEther("1");

    await test("reverts if milestone bps don't sum to 10000", async () => {
      await assertReverts(
        factory.connect(creator).createCampaign(
          ethers.Wallet.createRandom().address, ethers.ZeroAddress, amount,
          WINDOW.D7, 100, 30 * DAY, [TIER.M100K, TIER.M250K], [4000, 5000],
          { value: amount }
        ),
        "bps must sum to 10000"
      );
    });

    await test("reverts if tiers are not strictly increasing", async () => {
      await assertReverts(
        factory.connect(creator).createCampaign(
          ethers.Wallet.createRandom().address, ethers.ZeroAddress, amount,
          WINDOW.D7, 100, 30 * DAY, [TIER.M250K, TIER.M100K], [4000, 6000],
          { value: amount }
        ),
        "tiers must strictly increase"
      );
    });

    await test("reverts on a non-enum leaderboard size", async () => {
      await assertReverts(
        factory.connect(creator).createCampaign(
          ethers.Wallet.createRandom().address, ethers.ZeroAddress, amount,
          WINDOW.D7, 77, 30 * DAY, [TIER.M100K], [10000],
          { value: amount }
        ),
        "bad leaderboard size"
      );
    });

    await test("reverts if msg.value doesn't match amount for a native-ETH campaign", async () => {
      await assertReverts(
        factory.connect(creator).createCampaign(
          ethers.Wallet.createRandom().address, ethers.ZeroAddress, amount,
          WINDOW.D7, 100, 30 * DAY, [TIER.M100K], [10000],
          { value: amount - 1n }
        ),
        "bad msg.value"
      );
    });
  }

  // ---- ERC20 reward path -----------------------------------------------------------------
  suite("SHOFactory + SHOCampaign — ERC20 reward path");
  {
    const factory = await deploy("SHOFactory", deployer, owner.address, treasury.address, keeper.address);
    const token = await deploy("MockERC20", deployer, "Mock USDC", "mUSDC");
    const amount = ethers.parseUnits("1000", 18);
    await token.mint(creator.address, amount);
    await token.connect(creator).approve(await factory.getAddress(), amount);

    let campaignAddr;
    await test("createCampaign pulls ERC20 from the creator and splits the fee", async () => {
      const tx = await factory
        .connect(creator)
        .createCampaign(
          ethers.Wallet.createRandom().address,
          await token.getAddress(),
          amount,
          WINDOW.H24,
          50,
          7 * DAY,
          [TIER.M100K],
          [10000]
        );
      const receipt = await tx.wait();
      const created = receipt.logs
        .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
        .find((l) => l && l.name === "CampaignCreated");
      campaignAddr = created.args.campaign;

      const fee = (amount * 50n) / 10000n;
      const net = amount - fee;
      const bal = await token.balanceOf(campaignAddr);
      if (bal !== net) throw new Error(`campaign token balance ${bal} != net ${net}`);
      const treasuryBal = await token.balanceOf(treasury.address);
      if (treasuryBal !== fee) throw new Error("treasury did not receive the ERC20 fee");
    });

    await test("claim pays out in the ERC20 reward token", async () => {
      const campaign = attach("SHOCampaign", campaignAddr, ethers.provider);
      const reward = ethers.parseUnits("100", 18);
      const tree = buildTree([{ account: trader1.address, amount: reward }]);
      await campaign.connect(keeper).postMilestoneRoot(0, tree.root, ethers.id("s"));
      await timeTravel(DAY + 1);
      await campaign.connect(trader1).claim(0, reward, tree.proofFor(0));
      const bal = await token.balanceOf(trader1.address);
      if (bal !== reward) throw new Error(`expected ${reward}, got ${bal}`);
    });
  }

  summary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
