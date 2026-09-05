// Runs every test/*.test.js file in its own process (each needs a fresh Hardhat network
// instance) and fails the overall run if any of them exit non-zero.
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TEST_DIR = path.join(__dirname, "..", "test");
const files = fs
  .readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

let anyFailed = false;
for (const file of files) {
  console.log(`\n>>> ${file}`);
  try {
    execFileSync("node", [path.join(TEST_DIR, file)], { stdio: "inherit" });
  } catch (e) {
    anyFailed = true;
  }
}

console.log(`\n${"#".repeat(50)}`);
console.log(anyFailed ? "Some test files reported failures." : "All test files passed.");
process.exit(anyFailed ? 1 : 0);
