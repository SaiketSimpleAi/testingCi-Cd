// PM2 process manager config — lives on each VM at /srv/notes-api/ and is
// referenced by scripts/deploy-release.sh on every deploy. It is NOT environment
// specific: the artifact is identical everywhere, and all per-environment config
// (DB URLs, secrets, REGION, log level) is read at runtime from the VM-local
// /srv/notes-api/shared/.env — never baked into the artifact.
module.exports = {
  apps: [
    {
      name: 'notes-api',
      script: 'src/server.js',
      cwd: '/srv/notes-api/current', // the symlink swapped atomically on each deploy
      node_args: '--env-file=/srv/notes-api/shared/.env', // VM-local config, never in the artifact
      instances: 'max', // cluster mode → zero-downtime `pm2 reload`
      exec_mode: 'cluster',
      max_memory_restart: '512M',
    },
  ],
};
