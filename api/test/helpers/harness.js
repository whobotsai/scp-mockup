// Same minimal plain-Node harness pattern as ../../contracts/test/helpers/harness.js —
// duplicated rather than imported since this is an independently deployable package that
// shouldn't depend on contracts/'s local dev tooling.
"use strict";
let passed = 0;
let failed = 0;
// Holds every async test's promise so summary() can await them all before reporting --
// without this, an async `fn` (one that returns a thenable) would report "ok" immediately
// (fn() throwing nothing synchronously), with its actual assertions/rejections only
// surfacing later as an unhandled rejection, never counted as a failure here. Sync tests
// (the overwhelming majority in this project) are unaffected: fn() for a sync function
// returns undefined, not a thenable, so they're still counted synchronously exactly as before.
const pending = [];

function test(name, fn) {
  let result;
  try {
    result = fn();
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${e.message}`);
    return;
  }
  if (result && typeof result.then === "function") {
    pending.push(
      result.then(
        () => {
          passed++;
          console.log(`  ok - ${name}`);
        },
        (e) => {
          failed++;
          console.log(`  FAIL - ${name}`);
          console.log(`    ${e.message}`);
        }
      )
    );
    return;
  }
  passed++;
  console.log(`  ok - ${name}`);
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

// async, but existing callers' plain `summary();` (no await) still works correctly --
// calling an async function runs its body immediately rather than lazily, so `pending`'s
// promises still get awaited and counted before the final log/exit, whether or not the call
// site awaits the returned promise.
async function summary() {
  await Promise.all(pending);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = { test, assertEqual, summary };
