// SSO (Strong Shill Offering) test suite -- Anchor/TS counterpart of
// ../../contracts/test/sso.test.js. Same structural notes as tests/sho.ts (bankrun instead
// of a real validator, context.setClock for time travel, never run against a real toolchain
// -- see that file's header for the full explanation, not repeated here).
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { BanksClient, Clock, ProgramTestContext } from "solana-bankrun";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { buildTree } from "./helpers/merkle";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../target/idl/sso_solana.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PROGRAM_ID = new PublicKey(IDL.address ?? IDL.metadata.address);

const EPOCH_LEN = { H24: { h24: {} }, D7: { d7: {} }, D30: { d30: {} } };
const DAY = 24 * 60 * 60;
const CONFIG_SEED = Buffer.from("config");
const CAMPAIGN_SEED = Buffer.from("campaign");
const CLAIM_SEED = Buffer.from("claim");

describe("sso_solana", () => {
  let context: ProgramTestContext;
  let client: BanksClient;
  let provider: BankrunProvider;
  let program: Program;

  let authority: Keypair, treasury: Keypair, keeper: Keypair, creator: Keypair;
  let shiller1: Keypair, stranger: Keypair;

  function configPda(): PublicKey {
    return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
  }
  function campaignPda(id: bigint): PublicKey {
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(id);
    return PublicKey.findProgramAddressSync([CAMPAIGN_SEED, configPda().toBuffer(), idBuf], PROGRAM_ID)[0];
  }
  // epoch_index is u16, so its seed is 2 bytes LE -- NOT the same width as SHO's u8
  // milestone_index seed (see claim_receipt's seeds in sso_solana/src/lib.rs::ClaimSol).
  function claimReceiptPda(campaign: PublicKey, epochIndex: number, claimant: PublicKey): PublicKey {
    const idxBuf = Buffer.alloc(2);
    idxBuf.writeUInt16LE(epochIndex);
    return PublicKey.findProgramAddressSync(
      [CLAIM_SEED, campaign.toBuffer(), idxBuf, claimant.toBuffer()],
      PROGRAM_ID
    )[0];
  }

  function fundedKeypair(lamports: number): Keypair {
    const kp = Keypair.generate();
    context.setAccount(kp.publicKey, {
      lamports,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
    return kp;
  }

  async function timeTravel(seconds: number) {
    const current = await client.getClock();
    context.setClock(
      new Clock(
        current.slot,
        current.epochStartTimestamp,
        current.epoch,
        current.leaderScheduleEpoch,
        current.unixTimestamp + BigInt(seconds)
      )
    );
  }

  before(async () => {
    context = await startAnchor(".", [], []);
    client = context.banksClient;
    provider = new BankrunProvider(context);
    anchor.setProvider(provider as unknown as anchor.Provider);
    program = new Program(IDL, provider);

    authority = fundedKeypair(10 * anchor.web3.LAMPORTS_PER_SOL);
    treasury = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
    keeper = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
    creator = fundedKeypair(20 * anchor.web3.LAMPORTS_PER_SOL);
    shiller1 = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
    stranger = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);

    await program.methods
      .initializeConfig(treasury.publicKey, keeper.publicKey)
      .accounts({
        authority: authority.publicKey,
        config: configPda(),
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([authority])
      .rpc();
  });

  describe("full epoch lifecycle (native-SOL reward)", () => {
    const campaignId = 0n;
    const lockAmount = new BN(5 * anchor.web3.LAMPORTS_PER_SOL);
    const epochBps = [5000, 5000]; // two 24h epochs, split evenly
    let campaign: PublicKey;
    const trackedToken = Keypair.generate().publicKey;

    it("create_campaign_sol creates the PDA with the tracked keyword and schedules epoch endsAt", async () => {
      campaign = campaignPda(campaignId);
      await program.methods
        .createCampaignSol(
          new BN(campaignId.toString()),
          trackedToken,
          lockAmount,
          "#TestKeyword",
          EPOCH_LEN.H24,
          50,
          new BN(7 * DAY),
          epochBps
        )
        .accounts({
          creator: creator.publicKey,
          config: configPda(),
          campaign,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([creator])
        .rpc();

      const acct = await (program.account as any).campaign.fetch(campaign);
      expect(acct.keyword).to.equal("#TestKeyword");
      expect(acct.epochCount).to.equal(2);
    });

    it("epoch 0 ends ~24h after creation, epoch 1 ~48h after", async () => {
      const acct = await (program.account as any).campaign.fetch(campaign);
      const createdAt: BN = acct.createdAt;
      expect(acct.epochs[0].endsAt.toString()).to.equal(createdAt.addn(DAY).toString());
      expect(acct.epochs[1].endsAt.toString()).to.equal(createdAt.addn(DAY * 2).toString());
    });

    it("keeper cannot finalize epoch 0 before its scheduled window closes", async () => {
      let threw = false;
      try {
        await program.methods
          .postEpochRoot(0, Array(32).fill(0), Array(32).fill(0))
          .accounts({ keeper: keeper.publicKey, config: configPda(), campaign } as any)
          .signers([keeper])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/EpochNotYetEnded|epoch not yet ended/i);
      }
      expect(threw).to.equal(true);
    });

    it("a non-keeper cannot post an epoch root even after it ends", async () => {
      await timeTravel(DAY + 1);
      let threw = false;
      try {
        await program.methods
          .postEpochRoot(0, Array(32).fill(0), Array(32).fill(0))
          .accounts({ keeper: stranger.publicKey, config: configPda(), campaign } as any)
          .signers([stranger])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/NotKeeper|not keeper/i);
      }
      expect(threw).to.equal(true);
    });

    const reward = BigInt(1 * anchor.web3.LAMPORTS_PER_SOL);
    let tree: ReturnType<typeof buildTree>;

    it("keeper finalizes epoch 0 once it has ended", async () => {
      tree = buildTree([{ account: shiller1.publicKey, amount: reward }]);
      await program.methods
        .postEpochRoot(0, Array.from(tree.root), Array(32).fill(1))
        .accounts({ keeper: keeper.publicKey, config: configPda(), campaign } as any)
        .signers([keeper])
        .rpc();

      const acct = await (program.account as any).campaign.fetch(campaign);
      expect(acct.epochs[0].finalized).to.equal(true);
    });

    it("claim_sol reverts while epoch 0's challenge window is open", async () => {
      const receipt = claimReceiptPda(campaign, 0, shiller1.publicKey);
      let threw = false;
      try {
        await program.methods
          .claimSol(0, new BN(reward.toString()), tree.proofFor(0).map((b) => Array.from(b)))
          .accounts({
            claimant: shiller1.publicKey,
            config: configPda(),
            campaign,
            claimReceipt: receipt,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([shiller1])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/ChallengeWindowOpen|challenge window open/i);
      }
      expect(threw).to.equal(true);
    });

    it("claim_sol succeeds once the challenge window elapses, paid in SOL", async () => {
      await timeTravel(DAY + 1);
      const before = await client.getBalance(shiller1.publicKey);
      const receipt = claimReceiptPda(campaign, 0, shiller1.publicKey);
      await program.methods
        .claimSol(0, new BN(reward.toString()), tree.proofFor(0).map((b) => Array.from(b)))
        .accounts({
          claimant: shiller1.publicKey,
          config: configPda(),
          campaign,
          claimReceipt: receipt,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([shiller1])
        .rpc();
      const after = await client.getBalance(shiller1.publicKey);
      // Same "at least the reward minus a generous fee/rent allowance" check sho.ts's own
      // claim test uses -- rent + tx fees are a real, non-refunded cost here, unlike EVM gas.
      expect(after - before > reward - BigInt(anchor.web3.LAMPORTS_PER_SOL) / 100n).to.equal(true);
    });

    it("epoch 1 is still untouched (not finalized)", async () => {
      const acct = await (program.account as any).campaign.fetch(campaign);
      expect(acct.epochs[1].finalized).to.equal(false);
    });
  });

  describe("creation-time validation", () => {
    const amount = new BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const trackedToken = Keypair.generate().publicKey;

    it("reverts on an empty keyword", async () => {
      const id = 1n;
      let threw = false;
      try {
        await program.methods
          .createCampaignSol(new BN(id.toString()), trackedToken, amount, "", EPOCH_LEN.H24, 50, new BN(7 * DAY), [10000])
          .accounts({ creator: creator.publicKey, config: configPda(), campaign: campaignPda(id), treasury: treasury.publicKey, systemProgram: SystemProgram.programId } as any)
          .signers([creator])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/KeywordRequired|keyword required/i);
      }
      expect(threw).to.equal(true);
    });

    it("reverts if epoch bps don't sum to 10000", async () => {
      const id = 1n;
      let threw = false;
      try {
        await program.methods
          .createCampaignSol(new BN(id.toString()), trackedToken, amount, "#k", EPOCH_LEN.H24, 50, new BN(7 * DAY), [5000, 4000])
          .accounts({ creator: creator.publicKey, config: configPda(), campaign: campaignPda(id), treasury: treasury.publicKey, systemProgram: SystemProgram.programId } as any)
          .signers([creator])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/BpsMustSumTo10000|bps must sum to 10000/i);
      }
      expect(threw).to.equal(true);
    });

    it("reverts on more epochs than MAX_EPOCHS allows", async () => {
      const id = 1n;
      const tooMany = Array(91).fill(Math.floor(10000 / 91));
      let threw = false;
      try {
        await program.methods
          .createCampaignSol(new BN(id.toString()), trackedToken, amount, "#k", EPOCH_LEN.H24, 50, new BN(90 * DAY), tooMany)
          .accounts({ creator: creator.publicKey, config: configPda(), campaign: campaignPda(id), treasury: treasury.publicKey, systemProgram: SystemProgram.programId } as any)
          .signers([creator])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/TooManyEpochs|too many epochs/i);
      }
      expect(threw).to.equal(true);
    });
  });
});
