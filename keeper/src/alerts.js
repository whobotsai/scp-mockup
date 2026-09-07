// Monitoring/alerting (KEEPER_SERVICE_DESIGN.md section 4.8). Per the roadmap's own guiding
// principle -- "a missed or malformed root post is a production incident, not a bug to notice
// later" -- this ships alongside the poster, not after it.
//
// Only the missed-root alert is implemented here: "a milestone confirmed crossed with no
// corresponding root_submissions row reaching confirmed within a defined SLA (e.g. 1 hour)
// pages whoever's on call. This is the single most safety-critical alert in the system -- it
// is the thing standing between 'keeper working' and 'funds silently unclaimable because
// nobody posted a root.'" The design doc's own section 7 marks the on-call rotation itself as
// still an open decision the team hasn't made -- so there is nowhere to actually page yet.
// This alert logs loudly to the console instead (unmissable in the same terminal everything
// else in this project reports through), ready to be wired into a real paging system once
// that rotation exists -- and that gap is exactly what needs to close before any campaign
// with real funds goes live (see docs/BACKEND_ROADMAP.md).
"use strict";
const db = require("./db");

const MISSED_ROOT_SLA_MS = 60 * 60 * 1000; // 1 hour, per section 4.8's own suggested SLA

async function checkMissedRootAlerts() {
  const overdue = await db.overdueUnconfirmedSnapshots(MISSED_ROOT_SLA_MS);
  for (const snapshot of overdue) {
    console.error(
      `[alerts] MISSED ROOT: ${snapshot.campaign_address} milestone ${snapshot.index} crossed at ` +
        `${snapshot.computed_at.toISOString()} and still has no confirmed root_submissions row ` +
        `after ${Math.round(MISSED_ROOT_SLA_MS / 60000)} minutes -- funds may be silently unclaimable. ` +
        `Check the keeper's onchainPoster logs and, if needed, run scripts/post-milestone-root.js by hand.`
    );
  }
}

module.exports = { MISSED_ROOT_SLA_MS, checkMissedRootAlerts };
