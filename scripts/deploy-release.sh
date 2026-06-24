#!/usr/bin/env bash
# Committed; run ON the VM by the deploy step (deploy-staging.yml / deploy-prod.yml),
# which pipes it over SSH as: ssh ... "bash -s -- <sha>" < scripts/deploy-release.sh
#
# It only ever EXTRACTS and RUNS the artifact it was handed — it never builds,
# never runs `npm install`. That is the whole guarantee: prod runs the exact bytes
# STAGING/UAT signed off (engineering standard §2).
set -euo pipefail
SHA="$1"                      # e.g. main-a1b2c3d
APP=/srv/notes-api

# Extract the immutable artifact into its own release directory.
mkdir -p "$APP/releases/$SHA"
tar -xzf "/tmp/notes-api-$SHA.tar.gz" -C "$APP/releases/$SHA"

# Apply pending DB migrations as their own step, BEFORE the cutover.
# Migrations must be backward-compatible (expand/contract): the currently-live
# release keeps running against the new schema while we reload. The app boots
# with RUN_MIGRATIONS_ON_BOOT=false on the VM (see shared/.env), so cluster
# workers never race to migrate on reload — this single invocation owns it.
( cd "$APP/releases/$SHA" && node --env-file="$APP/shared/.env" src/migrate.js )

# Atomic cutover, then zero-downtime reload (config read from $APP/shared/.env).
ln -sfn "$APP/releases/$SHA" "$APP/current"
pm2 startOrReload "$APP/ecosystem.config.cjs" --update-env
pm2 save

# Retain the last 5 releases for instant rollback; prune the rest.
ls -1dt "$APP/releases"/*/ | tail -n +6 | xargs -r rm -rf
rm -f "/tmp/notes-api-$SHA.tar.gz"
