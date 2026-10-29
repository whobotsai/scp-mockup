// Calls initialize_config on sho_solana, sso_solana, and registry_solana against whatever
// SOLANA_RPC_URL points at (devnet or mainnet-beta). Mirrors ../../contracts/scripts/deploy.js's
// own "default treasury/keeper/attestor to the deployer's own address, rotate later" posture --
// see that script's comment for why, and never leave these defaults in place for a mainnet run.
//
// Needs `anchor build` to have already produced target/idl/*.json for all three programs, and
// the real program ids from `anchor keys list` already pasted into Anchor.toml / each
// declare_id!() (see README.md's "Next steps" step 1/3) -- this script reads ids from
// Anchor.toml's [programs.<cluster>] section, not from a placeholder.
//
// Usage: SOLANA_RPC_URL=... AUTHORITY_KEYPAIR=/path/to/id.json npx ts-node scripts/initialize.ts
"use strict";
import * as fs from "fs";
import * as path from "path";
import * as toml from "@iarna/toml";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

function loadKeypair(keypairPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadIdl(name: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "target", "idl", `${name}.json`), "utf8"));
}

function programIdFromAnchorToml(name: string): PublicKey {
  const anchorToml = toml.parse(fs.readFileSync(path.join(__dirname, "..", "Anchor.toml"), "utf8")) as any;
  const cluster = process.env.ANCHOR_CLUSTER || anchorToml.provider?.cluster || "localnet";
  const section = anchorToml.programs?.[cluster];
  if (!section?.[name]) {
    throw new Error(`Anchor.toml has no [programs.${cluster}] entry for ${name} -- run anchor keys list and paste it in first (README.md step 1/3).`);
  }
  return new PublicKey(section[name]);
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const authorityKeypairPath = process.env.AUTHORITY_KEYPAIR;
  if (!rpcUrl || !authorityKeypairPath) {
    console.error("Set SOLANA_RPC_URL and AUTHORITY_KEYPAIR before running this.");
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const authority = loadKeypair(authorityKeypairPath);
  const provider = new AnchorProvider(connection, new Wallet(authority), { commitment: "confirmed" });

  console.log(`Cluster: ${rpcUrl}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Authority balance: ${balance / 1e9} SOL`);
  if (balance === 0) {
    console.error("\nAuthority has 0 balance -- fund it first (devnet: solana airdrop 2 <address> --url devnet).");
    process.exit(1);
  }

  // Same "default to the authority's own address, rotate later via set_* instructions"
  // posture as contracts/scripts/deploy.js -- never leave these as the deployer on mainnet.
  const treasury = process.env.TREASURY_ADDRESS ? new PublicKey(process.env.TREASURY_ADDRESS) : authority.publicKey;
  const keeper = process.env.KEEPER_ADDRESS ? new PublicKey(process.env.KEEPER_ADDRESS) : authority.publicKey;
  const attestor = process.env.ATTESTOR_ADDRESS ? new PublicKey(process.env.ATTESTOR_ADDRESS) : authority.publicKey;
  console.log(`\ntreasury=${treasury.toBase58()}\nkeeper=${keeper.toBase58()}\nattestor=${attestor.toBase58()}\n`);

  async function initOne(programName: string, methodArgs: any[]) {
    const idl = loadIdl(programName);
    const programId = programIdFromAnchorToml(programName);
    const program = new Program({ ...idl, address: programId.toBase58() } as any, provider);
    const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];

    const existing = await connection.getAccountInfo(configPda);
    if (existing) {
      console.log(`${programName}: config ${configPda.toBase58()} already initialized, skipping.`);
      return;
    }

    const sig = await (program.methods as any)
      .initializeConfig(...methodArgs)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`${programName}: initialized config ${configPda.toBase58()} (tx ${sig})`);
  }

  await initOne("sho_solana", [treasury, keeper]);
  await initOne("sso_solana", [treasury, keeper]);
  await initOne("registry_solana", [attestor]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
