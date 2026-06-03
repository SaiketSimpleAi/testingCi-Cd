'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');

// A tiny, dependency-free migration runner.
// It reads every .sql file in /migrations in alphabetical order and
// runs the ones that have not been applied yet, tracking them in a
// `schema_migrations` table. This is enough for a small app and keeps
// the example transparent (no extra migration framework to learn).
async function runMigrations() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await db.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`applying migration: ${file}`);
    // Wrap each migration in a transaction so a failure leaves no
    // half-applied schema behind.
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
        file,
      ]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }
  console.log('migrations up to date');
}

// Allow running directly:  `npm run migrate`
if (require.main === module) {
  runMigrations()
    .then(() => db.close())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('migration failed', err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
