// SHO (Strong Hold Offering) test suite -- Anchor/TS counterpart of ../../contracts/test/sho.test.js.
// Mirrors that file's scenario coverage exactly (ETH/SOL happy path, creation-time
// validation reverts, ERC20/SPL reward path), adapted to Solana's account model: no clone
// deploy (a PDA per campaign instead), no `evm_increaseTime` (uses solana-bankrun's
// `context.setClock` to warp wall-clock time directly, since a real localnet validator has
// no equivalent JSON-RPC time-travel call), and challenge-window/claim mechanics expressed
// as PDA account state rather than Solidity storage.
//
// Uses solana-bankrun (via anchor-bankrun's BankrunProvider) rather than a spun-up
// `solana-test-validator` -- faster, and gives clean programmatic clock control. Run with
// `anchor test` (Anchor.toml's own [scripts] entry), which builds the workspace first if
// needed.
//
// NEVER RUN: this sandbox has no `solana`/`anchor` CLI (see every program's own lib.rs
// header). Written and cross-checked line-by-line against
// programs/sho_solana/src/{lib,state,constants,errors}.rs, but this is the first time any
// of this logic will actually execute once a real toolchain runs it -- expect to find and
// fix real bugs, that is the normal/expected outcome at this validation level, not a sign
// something went wrong in how this was written.
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { BanksClient, Clock, ProgramTestContext } from "solana-bankrun";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  AccountLayout,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import { expect } from "chai";
import { buildTree } from "./helpers/merkle";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../target/idl/sho_solana.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PROGRAM_ID = new PublicKey(IDL.address ?? IDL.metadata.address);

const WINDOW = { H24: { h24: {} }, D7: { d7: {} }, D30: { d30: {} } };
const TIER = { M100K: { m100K: {} }, M250K: { m250K: {} }, M1M: { m1M: {} }, M5M: { m5M: {} } };
const CHALLENGE_WINDOW_SECS = 24 * 60 * 60;
const DAY = 24 * 60 * 60;
const CONFIG_SEED = Buffer.from("config");
const CAMPAIGN_SEED = Buffer.from("campaign");
const CLAIM_SEED = Buffer.from("claim");

describe("sho_solana", () => {
  let context: ProgramTestContext;
  let client: BanksClient;
  let provider: BankrunProvider;
  let program: Program;

  let authority: Keypair, treasury: Keypair, keeper: Keypair, creator: Keypair;
  let trader1: Keypair, trader2: Keypair, stranger: Keypair;

  function configPda(): PublicKey {
    return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
  }
  function campaignPda(id: bigint): PublicKey {
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(id);
    return PublicKey.findProgramAddressSync([CAMPAIGN_SEED, configPda().toBuffer(), idBuf], PROGRAM_ID)[0];
  }
  function claimReceiptPda(campaign: PublicKey, milestoneIndex: number, claimant: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [CLAIM_SEED, campaign.toBuffer(), Buffer.from([milestoneIndex]), claimant.toBuffer()],
      PROGRAM_ID
    )[0];
  }

  // Funds a fresh keypair directly via bankrun's account-seeding escape hatch -- faster and
  // simpler than routing a SystemProgram.transfer through a real transaction for test setup.
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

  // Sends a raw transaction through bankrun's BanksClient directly, bypassing
  // provider.connection entirely -- used for SPL Token setup below, since it's unclear
  // whether @solana/spl-token's high-level (Connection-based) helpers work unmodified
  // against BankrunProvider's own connection shim, and this lower-level path removes that
  // uncertainty rather than relying on it.
  async function sendTx(instructions: anchor.web3.TransactionInstruction[], signers: Keypair[]) {
    const tx = new Transaction();
    tx.add(...instructions);
    tx.feePayer = signers[0].publicKey;
    const latestBlockhash = await client.getLatestBlockhash();
    if (!latestBlockhash) throw new Error("getLatestBlockhash returned null");
    tx.recentBlockhash = latestBlockhash[0];
    tx.sign(...signers);
    await client.processTransaction(tx);
  }

  async function tokenBalance(ata: PublicKey): Promise<bigint> {
    const info = await client.getAccount(ata);
    if (!info) throw new Error(`token account ${ata.toBase58()} not found`);
    return AccountLayout.decode(Buffer.from(info.data)).amount;
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
    trader1 = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
    trader2 = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
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

  describe("native-SOL reward path: full happy-path lifecycle", () => {
    const campaignId = 0n;
    const lockAmount = new BN(10 * anchor.web3.LAMPORTS_PER_SOL);
    const tiers = [TIER.M100K, TIER.M250K];
    const bps = [4000, 6000]; // 40% / 60%, sums to 10000
    let campaign: PublicKey;
    const trackedToken = Keypair.generate().publicKey; // tracked off-chain only, any pubkey works

    it("create_campaign_sol creates the PDA and splits the protocol fee", async () => {
      campaign = campaignPda(campaignId);
      const treasuryBefore = await client.getBalance(treasury.publicKey);

      await program.methods
        .createCampaignSol(
          new BN(campaignId.toString()),
          trackedToken,
          lockAmount,
          WINDOW.D7,
          100,
          new BN(30 * DAY),
          tiers,
          bps
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

      const fee = (BigInt(lockAmount.toString()) * 50n) / 10000n;
      const net = BigInt(lockAmount.toString()) - fee;

      const treasuryAfter = await client.getBalance(treasury.publicKey);
      expect(treasuryAfter - treasuryBefore).to.equal(fee);

      const campaignInfo = await client.getAccount(campaign);
      expect(campaignInfo).to.not.be.null;
      const rent = await client.getRent();
      const rentExempt = rent.minimumBalance(BigInt(campaignInfo!.data.length));
      expect(BigInt(campaignInfo!.lamports)).to.equal(rentExempt + net);

      const acct = await (program.account as any).campaign.fetch(campaign);
      expect(acct.milestoneCount).to.equal(2);
      expect(acct.id.toString()).to.equal(campaignId.toString());
      expect(acct.rewardMint.toString()).to.equal(PublicKey.default.toString());
    });

    it("a non-keeper cannot post a milestone root", async () => {
      let threw = false;
      try {
        await program.methods
          .postMilestoneRoot(0, Array(32).fill(0), Array(32).fill(0))
          .accounts({ keeper: stranger.publicKey, config: configPda(), campaign } as any)
          .signers([stranger])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/NotKeeper|not keeper/i);
      }
      expect(threw).to.equal(true);
    });

    const rewardAmount = BigInt(1 * anchor.web3.LAMPORTS_PER_SOL);
    let tree: ReturnType<typeof buildTree>;

    it("keeper posts a root for milestone 0 and the account reflects it as reached", async () => {
      tree = buildTree([{ account: trader1.publicKey, amount: rewardAmount }]);
      const snapshotHash = Buffer.alloc(32, 1);

      await program.methods
        .postMilestoneRoot(0, Array.from(tree.root), Array.from(snapshotHash))
        .accounts({ keeper: keeper.publicKey, config: configPda(), campaign } as any)
        .signers([keeper])
        .rpc();

      const acct = await (program.account as any).campaign.fetch(campaign);
      expect(acct.milestones[0].reached).to.equal(true);
    });

    it("claim_sol reverts while the 24h challenge window is still open", async () => {
      const receipt = claimReceiptPda(campaign, 0, trader1.publicKey);
      let threw = false;
      try {
        await program.methods
          .claimSol(0, new BN(rewardAmount.toString()), tree.proofFor(0).map((b) => Array.from(b)))
          .accounts({
            claimant: trader1.publicKey,
            config: configPda(),
            campaign,
            claimReceipt: receipt,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([trader1])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/ChallengeWindowOpen|challenge window open/i);
      }
      expect(threw).to.equal(true);
    });

    it("the keeper can still correct the root before the window elapses", async () => {
      const corrected = buildTree([{ account: trader2.publicKey, amount: rewardAmount }]);
      await program.methods
        .postMilestoneRoot(0, Array.from(corrected.root), Array(32).fill(2))
        .accounts({ keeper: keeper.publicKey, config: configPda(), campaign } as any)
        .signers([keeper])
        .rpc();
      // put the original root back so the rest of this suite proceeds against trader1
      await program.methods
        .postMilestoneRoot(0, Array.from(tree.root), Array(32).fill(1))
        .accounts({ keeper: keeper.publicKey, config: configPda(), campaign } as any)
        .signers([keeper])
        .rpc();
    });

    it("claim_sol reverts against a wrong amount/proof once the window is open", async () => {
      await timeTravel(DAY + 1);
      const receipt = claimReceiptPda(campaign, 0, trader1.publicKey);
      let threw = false;
      try {
        await program.methods
          .claimSol(0, new BN((rewardAmount + 1n).toString()), tree.proofFor(0).map((b) => Array.from(b)))
          .accounts({
            claimant: trader1.publicKey,
            config: configPda(),
            campaign,
            claimReceipt: receipt,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([trader1])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/BadProof|bad proof/i);
      }
      expect(threw).to.equal(true);
    });

    it("claim_sol succeeds once the challenge window has elapsed", async () => {
      const before = await client.getBalance(trader1.publicKey);
      const receipt = claimReceiptPda(campaign, 0, trader1.publicKey);
      await program.methods
        .claimSol(0, new BN(rewardAmount.toString()), tree.proofFor(0).map((b) => Array.from(b)))
        .accounts({
          claimant: trader1.publicKey,
          config: configPda(),
          campaign,
          claimReceipt: receipt,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([trader1])
        .rpc();
      const after = await client.getBalance(trader1.publicKey);
      // trader1 also pays its own tx fee + the claim_receipt PDA's rent, so this only checks
      // that balance increased by at least the reward minus a generous fee/rent allowance,
      // not an exact delta the way the EVM test can (gas is refunded there; rent here is a
      // real, non-refunded cost borne by the claimant).
      expect(after - before > rewardAmount - BigInt(anchor.web3.LAMPORTS_PER_SOL) / 100n).to.equal(true);
    });

    it("a second claim on the same milestone fails (claim_receipt PDA already exists)", async () => {
      const receipt = claimReceiptPda(campaign, 0, trader1.publicKey);
      let threw = false;
      try {
        await program.methods
          .claimSol(0, new BN(rewardAmount.toString()), tree.proofFor(0).map((b) => Array.from(b)))
          .accounts({
            claimant: trader1.publicKey,
            config: configPda(),
            campaign,
            claimReceipt: receipt,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([trader1])
          .rpc();
      } catch (e) {
        threw = true; // "already in use" / account-already-exists, Anchor's own init-collision error
      }
      expect(threw).to.equal(true);
    });

    it("the keeper can no longer correct milestone 0 once its window elapsed", async () => {
      let threw = false;
      try {
        await program.methods
          .postMilestoneRoot(0, Array(32).fill(9), Array(32).fill(9))
          .accounts({ keeper: keeper.publicKey, config: configPda(), campaign } as any)
          .signers([keeper])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/ChallengeWindowElapsed|challenge window elapsed/i);
      }
      expect(threw).to.equal(true);
    });

    it("milestone 1 is untouched and still not reached", async () => {
      const acct = await (program.account as any).campaign.fetch(campaign);
      expect(acct.milestones[1].reached).to.equal(false);
    });

    it("the unreached milestone's share stays locked -- the lamports are still sitting in the campaign PDA", async () => {
      const bal = await client.getBalance(campaign);
      expect(bal > 0n).to.equal(true);
    });
  });

  describe("creation-time validation", () => {
    const amount = new BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const trackedToken = Keypair.generate().publicKey;

    it("reverts if milestone bps don't sum to 10000", async () => {
      const id = 1n;
      let threw = false;
      try {
        await program.methods
          .createCampaignSol(new BN(id.toString()), trackedToken, amount, WINDOW.D7, 100, new BN(30 * DAY), [TIER.M100K, TIER.M250K], [4000, 5000])
          .accounts({ creator: creator.publicKey, config: configPda(), campaign: campaignPda(id), treasury: treasury.publicKey, systemProgram: SystemProgram.programId } as any)
          .signers([creator])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/BpsMustSumTo10000|bps must sum to 10000/i);
      }
      expect(threw).to.equal(true);
    });

    it("reverts if tiers are not strictly increasing", async () => {
      const id = 1n; // same id as the previous (rejected) attempt -- next_id hasn't advanced
      let threw = false;
      try {
        await program.methods
          .createCampaignSol(new BN(id.toString()), trackedToken, amount, WINDOW.D7, 100, new BN(30 * DAY), [TIER.M250K, TIER.M100K], [4000, 6000])
          .accounts({ creator: creator.publicKey, config: configPda(), campaign: campaignPda(id), treasury: treasury.publicKey, systemProgram: SystemProgram.programId } as any)
          .signers([creator])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/TiersMustStrictlyIncrease|tiers must strictly increase/i);
      }
      expect(threw).to.equal(true);
    });

    it("reverts on a non-enum leaderboard size", async () => {
      const id = 1n;
      let threw = false;
      try {
        await program.methods
          .createCampaignSol(new BN(id.toString()), trackedToken, amount, WINDOW.D7, 77, new BN(30 * DAY), [TIER.M100K], [10000])
          .accounts({ creator: creator.publicKey, config: configPda(), campaign: campaignPda(id), treasury: treasury.publicKey, systemProgram: SystemProgram.programId } as any)
          .signers([creator])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/BadLeaderboardSize|bad leaderboard size/i);
      }
      expect(threw).to.equal(true);
    });

    it("reverts on a bad duration", async () => {
      const id = 1n;
      let threw = false;
      try {
        await program.methods
          .createCampaignSol(new BN(id.toString()), trackedToken, amount, WINDOW.D7, 100, new BN(3 * DAY), [TIER.M100K], [10000])
          .accounts({ creator: creator.publicKey, config: configPda(), campaign: campaignPda(id), treasury: treasury.publicKey, systemProgram: SystemProgram.programId } as any)
          .signers([creator])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/BadDuration|bad duration/i);
      }
      expect(threw).to.equal(true);
    });
  });

  describe("SPL reward path", () => {
    let mint: PublicKey;
    let mintKeypair: Keypair;
    const amount = BigInt(1000) * 10n ** 9n; // 9-decimal mock mint, 1000 tokens

    before(async () => {
      mintKeypair = Keypair.generate();
      mint = mintKeypair.publicKey;
      const rent = await client.getRent();
      const mintRent = rent.minimumBalance(BigInt(MINT_SIZE));

      const createMintIx = SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mint,
        space: MINT_SIZE,
        lamports: Number(mintRent),
        programId: TOKEN_PROGRAM_ID,
      });
      const initMintIx = createInitializeMint2Instruction(mint, 9, authority.publicKey, null, TOKEN_PROGRAM_ID);
      await sendTx([createMintIx, initMintIx], [authority, mintKeypair]);

      const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
      const createAtaIx = createAssociatedTokenAccountInstruction(creator.publicKey, creatorAta, creator.publicKey, mint);
      const mintToIx = createMintToInstruction(mint, creatorAta, authority.publicKey, amount);
      await sendTx([createAtaIx, mintToIx], [creator, authority]);
    });

    it("create_campaign_spl pulls SPL tokens from the creator and splits the fee", async () => {
      const id = 2n;
      const campaign = campaignPda(id);
      const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
      const treasuryAta = getAssociatedTokenAddressSync(mint, treasury.publicKey);
      const vaultAta = getAssociatedTokenAddressSync(mint, campaign, true);

      await program.methods
        .createCampaignSpl(new BN(id.toString()), Keypair.generate().publicKey, new BN(amount.toString()), WINDOW.H24, 50, new BN(7 * DAY), [TIER.M100K], [10000])
        .accounts({
          creator: creator.publicKey,
          config: configPda(),
          campaign,
          rewardMint: mint,
          creatorTokenAccount: creatorAta,
          treasuryTokenAccount: treasuryAta,
          treasuryAuthority: treasury.publicKey,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([creator])
        .rpc();

      const fee = (amount * 50n) / 10000n;
      const net = amount - fee;
      expect((await tokenBalance(treasuryAta)).toString()).to.equal(fee.toString());
      expect((await tokenBalance(vaultAta)).toString()).to.equal(net.toString());
    });

    it("claim_spl pays out in the SPL reward token", async () => {
      const id = 2n;
      const campaign = campaignPda(id);
      const reward = BigInt(100) * 10n ** 9n;
      const tree = buildTree([{ account: trader1.publicKey, amount: reward }]);

      await program.methods
        .postMilestoneRoot(0, Array.from(tree.root), Array(32).fill(1))
        .accounts({ keeper: keeper.publicKey, config: configPda(), campaign } as any)
        .signers([keeper])
        .rpc();
      await timeTravel(DAY + 1);

      const vaultAta = getAssociatedTokenAddressSync(mint, campaign, true);
      const claimantAta = getAssociatedTokenAddressSync(mint, trader1.publicKey);
      const receipt = claimReceiptPda(campaign, 0, trader1.publicKey);

      await program.methods
        .claimSpl(0, new BN(reward.toString()), tree.proofFor(0).map((b) => Array.from(b)))
        .accounts({
          claimant: trader1.publicKey,
          config: configPda(),
          campaign,
          rewardMint: mint,
          vaultTokenAccount: vaultAta,
          claimantTokenAccount: claimantAta,
          claimReceipt: receipt,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([trader1])
        .rpc();

      expect((await tokenBalance(claimantAta)).toString()).to.equal(reward.toString());
    });
  });
});
