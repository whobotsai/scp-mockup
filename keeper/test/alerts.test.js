"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { MISSED_ROOT_SLA_MS } = require("../src/alerts");

// checkMissedRootAlerts itself queries Postgres (db.overdueUnconfirmedSnapshots), so it isn't
// unit-tested here -- this only pins down the SLA constant against
// KEEPER_SERVICE_DESIGN.md section 4.8's own suggested value ("within a defined SLA (e.g. 1
// hour)"), so a change to it is a deliberate edit, not an accidental typo.
test("MISSED_ROOT_SLA_MS matches the design doc's suggested 1-hour SLA", () => {
  assertEqual(MISSED_ROOT_SLA_MS, 60 * 60 * 1000);
});

summary();
