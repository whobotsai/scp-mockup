"use strict";
const { PublicKey, Keypair } = require("@solana/web3.js");
const { test, assertEqual, summary } = require("./helpers/harness");
const { isValidSolanaAddress, rankOf, rankOfExact, solanaClaimReceiptPda } = require("../src/walletRoutes");

test("isValidSolanaAddress: accepts a real base58 pubkey, rejects an EVM hex address", () => {
  assertEqual(isValidSolanaAddress("11111111111111111111111111111111"), true);
  assertEqual(isValidSolanaAddress("0x257F835b1066c064e9e9896c31556034f8Eee8c9"), false);
  assertEqual(isValidSolanaAddress("not-an-address"), false);
});

test("rankOf: case-insensitive, correct for EVM-style addresses", () => {
  const leaderboard = [{ wallet: "0xAAAA", score: 10 }, { wallet: "0xBBBB", score: 5 }];
  assertEqual(rankOf(leaderboard, "0xaaaa"), { rank: 1, score: 10 });
  assertEqual(rankOf(leaderboard, "0xbbbb"), { rank: 2, score: 5 });
  assertEqual(rankOf(leaderboard, "0xcccc"), null);
});

test("rankOfExact: case-sensitive -- a differently-cased base58 string is a different address, not a match", () => {
  const leaderboard = [{ wallet: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", score: 42 }];
  assertEqual(rankOfExact(leaderboard, "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), { rank: 1, score: 42 });
  // Same letters, different case -- a genuinely different base58 string/address, must NOT match.
  assertEqual(rankOfExact(leaderboard, "atokengpvbdgvxr1b2hvzbsiqw5xwh25eftnslja8knl"), null);
});

test("solanaClaimReceiptPda: SHO encodes a 1-byte milestone_index", () => {
  const programId = Keypair.generate().publicKey;
  const campaign = Keypair.generate().publicKey;
  const claimant = Keypair.generate().publicKey;
  const index = 2;

  const got = solanaClaimReceiptPda(programId, campaign, "sho", index, claimant);
  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), campaign.toBuffer(), Buffer.from([index]), claimant.toBuffer()],
    programId
  );
  assertEqual(got.toBase58(), expected.toBase58());
});

test("solanaClaimReceiptPda: SSO encodes a 2-byte little-endian epoch_index, not the same as SHO's 1-byte", () => {
  const programId = Keypair.generate().publicKey;
  const campaign = Keypair.generate().publicKey;
  const claimant = Keypair.generate().publicKey;
  const index = 300; // > 255 -- would silently truncate if this were encoded as a single byte

  const got = solanaClaimReceiptPda(programId, campaign, "sso", index, claimant);
  const idxBuf = Buffer.alloc(2);
  idxBuf.writeUInt16LE(index, 0);
  assertEqual(idxBuf, Buffer.from([44, 1])); // 300 = 0x012C -> LE bytes [0x2C, 0x01] = [44, 1]

  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), campaign.toBuffer(), idxBuf, claimant.toBuffer()],
    programId
  );
  assertEqual(got.toBase58(), expected.toBase58());
});

test("solanaClaimReceiptPda: SHO and SSO derive different addresses for the same numeric index (seed width differs)", () => {
  const programId = Keypair.generate().publicKey;
  const campaign = Keypair.generate().publicKey;
  const claimant = Keypair.generate().publicKey;

  const shoPda = solanaClaimReceiptPda(programId, campaign, "sho", 1, claimant);
  const ssoPda = solanaClaimReceiptPda(programId, campaign, "sso", 1, claimant);
  if (shoPda.toBase58() === ssoPda.toBase58()) {
    throw new Error("SHO (1-byte index) and SSO (2-byte index) must not derive the same PDA");
  }
});

summary();
