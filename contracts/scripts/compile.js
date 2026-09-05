// Manual solc-based compiler, used instead of Hardhat's built-in `compile` task.
// Hardhat's task downloads a native solc binary from binaries.soliditylang.org at
// build time; that host isn't reachable from this environment's network policy, so
// this script drives the pure JS/WASM `solc` npm package directly (installed like any
// other dependency, no separate runtime download) with a Node-based import resolver
// standing in for the one Hardhat would normally provide.
"use strict";
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "build");

function listSolFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listSolFiles(full));
    else if (entry.name.endsWith(".sol")) out.push(full);
  }
  return out;
}

function findImport(importPath) {
  // node_modules-style import, e.g. "@openzeppelin/contracts/access/Ownable.sol"
  const nodeModulesPath = path.join(ROOT, "node_modules", importPath);
  if (fs.existsSync(nodeModulesPath)) {
    return { contents: fs.readFileSync(nodeModulesPath, "utf8") };
  }
  // relative import resolved against src/
  const srcPath = path.join(SRC_DIR, importPath);
  if (fs.existsSync(srcPath)) {
    return { contents: fs.readFileSync(srcPath, "utf8") };
  }
  return { error: `File not found: ${importPath}` };
}

function main() {
  const files = listSolFiles(SRC_DIR);
  const sources = {};
  for (const f of files) {
    const rel = path.relative(SRC_DIR, f);
    sources[rel] = { content: fs.readFileSync(f, "utf8") };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));

  let hasError = false;
  for (const err of output.errors || []) {
    if (err.severity === "error") hasError = true;
    console.log(err.formattedMessage);
  }
  if (hasError) {
    console.error("\nCompilation failed.");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let count = 0;
  for (const [file, contractsInFile] of Object.entries(output.contracts)) {
    for (const [name, contract] of Object.entries(contractsInFile)) {
      const artifact = {
        contractName: name,
        sourceName: file,
        abi: contract.abi,
        bytecode: "0x" + contract.evm.bytecode.object,
        deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
      };
      fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(artifact, null, 2));
      count++;
    }
  }
  console.log(`Compiled OK — ${count} contract artifact(s) written to ${path.relative(ROOT, OUT_DIR)}/`);
}

main();
