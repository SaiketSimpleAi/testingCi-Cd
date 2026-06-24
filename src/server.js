'use strict';

const { createApp } = require('./app');
const { runMigrations } = require('./migrate');
const db = require('./db');

const PORT = process.env.PORT || 3000;

async function start() {
  // Apply pending DB migrations before serving traffic.
  // Local dev runs them on boot (idempotent, convenient). On the VMs this is
  // disabled (RUN_MIGRATIONS_ON_BOOT=false in /srv/notes-api/shared/.env): the
  // deploy step runs migrations once per release before the cutover
  // (scripts/deploy-release.sh), so PM2 cluster workers never race on reload.
  if (process.env.RUN_MIGRATIONS_ON_BOOT !== 'false') {
    await runMigrations();
  }

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
