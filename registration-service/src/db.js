"use strict";
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function recordRegistration(wallet, xHandle, attestation) {
  await pool.query(
    "INSERT INTO registrations (wallet, x_handle, attestation) VALUES ($1, $2, $3)",
    [wallet, xHandle, attestation]
  );
}

module.exports = { pool, recordRegistration };
