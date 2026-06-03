'use strict';

const { createApp } = require('./app');
const { runMigrations } = require('./migrate');
const db = require('./db');

const PORT = process.env.PORT || 3000;

async function start() {
  // Apply any pending DB migrations before serving traffic.
  // Safe to run on every boot — migrations are idempotent.
  await runMigrations();

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`notes-api listening on port ${PORT}`);
  });

  // Graceful shutdown so in-flight requests finish and the DB pool
  // closes cleanly when the platform sends SIGTERM (e.g. on redeploy).
  const shutdown = async (signal) => {
    console.log(`received ${signal}, shutting down`);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('failed to start server', err);
  process.exit(1);
});
