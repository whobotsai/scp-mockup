// Minimal test harness — no mocha/chai dependency, since `npx hardhat test` would try to
// run Hardhat's compile task first (which needs the native solc binary this environment
// can't download; see scripts/compile.js). Run these files directly with plain `node`.
"use strict";

let passed = 0;
let failed = 0;
const failures = [];
let currentSuite = "";

function suite(name) {
  currentSuite = name;
  console.log(`\n${name}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    failures.push({ suite: currentSuite, name, error: e });
    console.log(`  FAIL - ${name}`);
    console.log(`    ${e.message}`);
  }
}

async function assertReverts(promise, expectedReason) {
  try {
    await promise;
  } catch (e) {
    const msg = e.message || "";
    if (expectedReason && !msg.includes(expectedReason)) {
      throw new Error(`expected revert containing "${expectedReason}", got: ${msg}`);
    }
    return;
  }
  throw new Error(`expected a revert${expectedReason ? ` ("${expectedReason}")` : ""}, but call succeeded`);
}

function summary() {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - [${f.suite}] ${f.name}: ${f.error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { suite, test, assertReverts, summary };
