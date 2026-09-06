// Same minimal plain-Node harness as ../../contracts/test/helpers/harness.js and
// ../../keeper/test/helpers/harness.js -- duplicated rather than shared since each of these
// is an independently deployable package.
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

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${e.message}`);
  }
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg || `expected ${e}, got ${a}`);
}

function assertRejects(promise, msg) {
  return promise.then(
    () => {
      throw new Error(msg || "expected promise to reject, but it resolved");
    },
    () => {}
  );
}

function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = { test, testAsync, assertEqual, assertRejects, summary };
