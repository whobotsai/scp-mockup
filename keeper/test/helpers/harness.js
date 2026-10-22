// Same minimal plain-Node harness pattern as ../../contracts/test/helpers/harness.js —
// duplicated rather than imported since this is an independently deployable package that
// shouldn't depend on contracts/'s local dev tooling.
"use strict";
let passed = 0;
let failed = 0;
// Chains every test (sync or async) through one running promise so each fully completes --
// including any `finally` cleanup inside it -- before the next one starts. An earlier version
// fired each async test immediately without awaiting it before the next `test()` call ran;
// that's fine for independent tests, but any two that monkey-patch shared module state (e.g.
// db.* methods, global.fetch) with a per-test `finally`-restore would race and clobber each
// other's mocks mid-flight (see keeper/test/solanaPriceSampler.test.js). Sequential chaining
// in file order removes the race. Kept in lockstep with ../../api/test/helpers/harness.js's
// identical fix.
let chain = Promise.resolve();

function test(name, fn) {
  chain = chain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ok - ${name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL - ${name}`);
      console.log(`    ${e.message}`);
    }
  });
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

// async, but existing callers' plain `summary();` (no await) still works correctly -- see
// ../../api/test/helpers/harness.js's identical comment for why.
async function summary() {
  await chain;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = { test, assertEqual, summary };
