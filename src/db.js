'use strict';

const { Pool } = require('pg');

// A single shared connection pool for the whole process.
// Configuration comes entirely from environment variables so the same
// code runs unchanged on a laptop, in CI, and in production.
//
// DATABASE_URL example: postgres://user:password@host:5432/dbname
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway (and most managed Postgres) require TLS in production.
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX || 10),
});

// Thin wrapper so the rest of the app never imports `pool` directly.
async function query(text, params) {
  return pool.query(text, params);
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, close };
