// Same minimal plain-Node harness pattern as ../../contracts/test/helpers/harness.js —
// duplicated rather than imported since this is an independently deployable package that
// shouldn't depend on contracts/'s local dev tooling.
"use strict";
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${e.message}`);
  }
}

// BigInt has no native JSON representation -- stringify it explicitly (as "123n") rather
// than letting JSON.stringify throw, since several modules here (rewardAllocator.js) return
// BigInt amounts by design (on-chain uint256 precision, not float).
function stringify(value) {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v}n` : v));
}

function assertEqual(actual, expected, msg) {
  const a = stringify(actual);
  const e = stringify(expected);
  if (a !== e) throw new Error(msg || `expected ${e}, got ${a}`);
}

function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = { test, assertEqual, summary };
