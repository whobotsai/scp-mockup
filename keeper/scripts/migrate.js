// Applies every migrations/*.sql file, in filename order, inside a transaction each.
// No migration-tracking table yet (single migration so far) — every statement uses
// IF NOT EXISTS, so re-running this is a safe no-op. Revisit once there's more than one file.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    console.log(`Applying ${file}...`);
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await pool.query(sql);
  }

  console.log(`Applied ${files.length} migration file(s).`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
