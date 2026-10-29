// registry_solana test suite -- Anchor/TS counterpart of ../../contracts/test/registry.test.js.
// Same bankrun/never-run caveats as tests/sho.ts's header (not repeated here).
//
// Biggest structural difference from the EVM suite: Registry.sol gates registerHandle with
// an off-chain ECDSA attestation signature verified inside the instruction; registry_solana
// instead requires the attestor to co-sign the same transaction as a second Signer (see
// registry_solana/src/lib.rs's module header). So every register_handle call below signs
// with BOTH `wallet` and `attestor` keypairs, and "bad attestation" is tested by co-signing
// with a keypair that isn't `config.attestor` rather than by forging a signature.
//
// Also adapted: registry_solana v1 only supports linking a handle once per wallet (no
// "switch to a different handle" path -- see HandleLink's doc comment in state.rs). The EVM
// suite's "switching releases the old handle" scenario doesn't apply here; it's replaced
// below with "a second registration from the same wallet fails outright", since
// `handle_link`'s PDA already exists via `init` after the first call.
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { normalizedHandleKey } from "./helpers/merkle";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../target/idl/registry_solana.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PROGRAM_ID = new PublicKey(IDL.address ?? IDL.metadata.address);

const CONFIG_SEED = Buffer.from("config");
const HANDLE_SEED = Buffer.from("handle");
const WALLET_OF_HANDLE_SEED = Buffer.from("wallet_of_handle");
const REGISTRATION_SEED = Buffer.from("registration");

describe("registry_solana", () => {
  let context: ProgramTestContext;
  let client: BanksClient;
  let provider: BankrunProvider;
  let program: Program;

  let authority: Keypair, attestor: Keypair, stranger: Keypair;

  function configPda(): PublicKey {
    return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
  }
  function handleLinkPda(wallet: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([HANDLE_SEED, wallet.toBuffer()], PROGRAM_ID)[0];
  }
  function walletOfHandlePda(xHandle: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [WALLET_OF_HANDLE_SEED, normalizedHandleKey(xHandle)],
      PROGRAM_ID
    )[0];
  }
  function registrationPda(id: bigint): PublicKey {
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(id);
    return PublicKey.findProgramAddressSync(
      [REGISTRATION_SEED, configPda().toBuffer(), idBuf],
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

  before(async () => {
    context = await startAnchor(".", [], []);
    client = context.banksClient;
    provider = new BankrunProvider(context);
    anchor.setProvider(provider as unknown as anchor.Provider);
    program = new Program(IDL, provider);

    authority = fundedKeypair(10 * anchor.web3.LAMPORTS_PER_SOL);
    attestor = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
    stranger = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);

    await program.methods
      .initializeConfig(attestor.publicKey)
      .accounts({
        authority: authority.publicKey,
        config: configPda(),
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([authority])
      .rpc();
  });

  describe("initialize_config / set_attestor", () => {
    it("seeds config with the given attestor and a zeroed registration counter", async () => {
      const acct = await (program.account as any).config.fetch(configPda());
      expect(acct.attestor.toBase58()).to.equal(attestor.publicKey.toBase58());
      expect(acct.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(acct.nextRegistrationId.toString()).to.equal("0");
    });

    it("a non-authority cannot call set_attestor", async () => {
      let threw = false;
      try {
        await program.methods
          .setAttestor(stranger.publicKey)
          .accounts({ authority: stranger.publicKey, config: configPda() } as any)
          .signers([stranger])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/NotAuthority|not authority/i);
      }
      expect(threw).to.equal(true);
    });

    it("the authority can rotate the attestor", async () => {
      const newAttestor = Keypair.generate();
      await program.methods
        .setAttestor(newAttestor.publicKey)
        .accounts({ authority: authority.publicKey, config: configPda() } as any)
        .signers([authority])
        .rpc();

      const acct = await (program.account as any).config.fetch(configPda());
      expect(acct.attestor.toBase58()).to.equal(newAttestor.publicKey.toBase58());

      // Restore the original attestor so every other describe block below (which runs
      // after this one, as mocha executes describe/it in source order) keeps using the
      // `attestor` keypair declared at the top of the file.
      await program.methods
        .setAttestor(attestor.publicKey)
        .accounts({ authority: authority.publicKey, config: configPda() } as any)
        .signers([authority])
        .rpc();
    });
  });

  describe("register_handle (co-signed by wallet + attestor)", () => {
    it("links the handle and populates handle_link / wallet_of_handle / registration", async () => {
      const wallet = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
      const xHandle = "@TestUser";
      const idBefore = (await (program.account as any).config.fetch(configPda()))
        .nextRegistrationId as BN;

      await program.methods
        .registerHandle(xHandle)
        .accounts({
          wallet: wallet.publicKey,
          attestor: attestor.publicKey,
          config: configPda(),
          handleLink: handleLinkPda(wallet.publicKey),
          walletOfHandle: walletOfHandlePda(xHandle),
          registration: registrationPda(BigInt(idBefore.toString())),
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([wallet, attestor])
        .rpc();

      const handleLink = await (program.account as any).handleLink.fetch(handleLinkPda(wallet.publicKey));
      expect(handleLink.wallet.toBase58()).to.equal(wallet.publicKey.toBase58());
      expect(handleLink.xHandle).to.equal(xHandle);

      const walletOfHandle = await (program.account as any).walletOfHandle.fetch(
        walletOfHandlePda(xHandle)
      );
      expect(walletOfHandle.wallet.toBase58()).to.equal(wallet.publicKey.toBase58());

      const registration = await (program.account as any).registration.fetch(
        registrationPda(BigInt(idBefore.toString()))
      );
      expect(registration.id.toString()).to.equal(idBefore.toString());
      expect(registration.wallet.toBase58()).to.equal(wallet.publicKey.toBase58());
      expect(registration.xHandle).to.equal(xHandle);

      const configAcct = await (program.account as any).config.fetch(configPda());
      expect(configAcct.nextRegistrationId.toString()).to.equal(idBefore.addn(1).toString());
    });

    it("a co-signer who isn't config.attestor is rejected", async () => {
      const wallet = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
      const notAttestor = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
      const xHandle = "@WrongAttestor";
      const idBefore = (await (program.account as any).config.fetch(configPda()))
        .nextRegistrationId as BN;

      let threw = false;
      try {
        await program.methods
          .registerHandle(xHandle)
          .accounts({
            wallet: wallet.publicKey,
            attestor: notAttestor.publicKey,
            config: configPda(),
            handleLink: handleLinkPda(wallet.publicKey),
            walletOfHandle: walletOfHandlePda(xHandle),
            registration: registrationPda(BigInt(idBefore.toString())),
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([wallet, notAttestor])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/NotAttestor|not attestor/i);
      }
      expect(threw).to.equal(true);
    });

    it("a handle already linked to a different wallet cannot be linked again", async () => {
      const firstWallet = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
      const secondWallet = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
      const xHandle = "@TakenHandle";

      const idFirst = (await (program.account as any).config.fetch(configPda())).nextRegistrationId as BN;
      await program.methods
        .registerHandle(xHandle)
        .accounts({
          wallet: firstWallet.publicKey,
          attestor: attestor.publicKey,
          config: configPda(),
          handleLink: handleLinkPda(firstWallet.publicKey),
          walletOfHandle: walletOfHandlePda(xHandle),
          registration: registrationPda(BigInt(idFirst.toString())),
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([firstWallet, attestor])
        .rpc();

      // Same x_handle, case-differently spelled -- normalized_handle_key lowercases ASCII
      // A-Z, so this must collide onto the same wallet_of_handle PDA as "@TakenHandle" above.
      const idSecond = (await (program.account as any).config.fetch(configPda())).nextRegistrationId as BN;
      let threw = false;
      try {
        await program.methods
          .registerHandle("@TAKENHANDLE")
          .accounts({
            wallet: secondWallet.publicKey,
            attestor: attestor.publicKey,
            config: configPda(),
            handleLink: handleLinkPda(secondWallet.publicKey),
            walletOfHandle: walletOfHandlePda("@TAKENHANDLE"),
            registration: registrationPda(BigInt(idSecond.toString())),
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([secondWallet, attestor])
          .rpc();
      } catch (e) {
        // wallet_of_handle's PDA (seeded from the normalized handle) already exists, so the
        // second call's `init` constraint fails -- same "account already in use" mechanism
        // as sho.ts's double-claim test, just on a different account.
        threw = true;
        expect(String(e)).to.match(/already in use|0x0|already initialized/i);
      }
      expect(threw).to.equal(true);
    });

    it("adapted from EVM: a wallet that already linked a handle can't register a second one, even a different handle (no 'switch handle' path in v1)", async () => {
      const wallet = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
      const firstHandle = "@FirstHandle";
      const secondHandle = "@SecondHandle";

      const idFirst = (await (program.account as any).config.fetch(configPda())).nextRegistrationId as BN;
      await program.methods
        .registerHandle(firstHandle)
        .accounts({
          wallet: wallet.publicKey,
          attestor: attestor.publicKey,
          config: configPda(),
          handleLink: handleLinkPda(wallet.publicKey),
          walletOfHandle: walletOfHandlePda(firstHandle),
          registration: registrationPda(BigInt(idFirst.toString())),
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([wallet, attestor])
        .rpc();

      const idSecond = (await (program.account as any).config.fetch(configPda())).nextRegistrationId as BN;
      let threw = false;
      try {
        await program.methods
          .registerHandle(secondHandle)
          .accounts({
            wallet: wallet.publicKey,
            attestor: attestor.publicKey,
            config: configPda(),
            // handle_link's seed is just [HANDLE_SEED, wallet] -- unlike wallet_of_handle,
            // its PDA address doesn't depend on which handle is being linked, so this
            // second call derives the *same* handle_link address as the first call above,
            // and `init` fails on it regardless of secondHandle's own wallet_of_handle PDA
            // being fresh.
            handleLink: handleLinkPda(wallet.publicKey),
            walletOfHandle: walletOfHandlePda(secondHandle),
            registration: registrationPda(BigInt(idSecond.toString())),
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([wallet, attestor])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/already in use|0x0|already initialized/i);
      }
      expect(threw).to.equal(true);

      // The original link is untouched -- still @FirstHandle, not overwritten or cleared.
      const handleLink = await (program.account as any).handleLink.fetch(handleLinkPda(wallet.publicKey));
      expect(handleLink.xHandle).to.equal(firstHandle);
    });

    it("rejects an x_handle longer than MAX_X_HANDLE_LEN", async () => {
      const wallet = fundedKeypair(1 * anchor.web3.LAMPORTS_PER_SOL);
      const tooLong = "@" + "a".repeat(64); // 65 chars, one over MAX_X_HANDLE_LEN (64)
      const idBefore = (await (program.account as any).config.fetch(configPda())).nextRegistrationId as BN;

      let threw = false;
      try {
        await program.methods
          .registerHandle(tooLong)
          .accounts({
            wallet: wallet.publicKey,
            attestor: attestor.publicKey,
            config: configPda(),
            handleLink: handleLinkPda(wallet.publicKey),
            walletOfHandle: walletOfHandlePda(tooLong),
            registration: registrationPda(BigInt(idBefore.toString())),
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([wallet, attestor])
          .rpc();
      } catch (e) {
        threw = true;
        expect(String(e)).to.match(/HandleTooLong|handle.*too long/i);
      }
      expect(threw).to.equal(true);
    });
  });
});
