#!/usr/bin/env bash
# Emergency rollback — run ON the affected PROD VM, per region (AU and EU are
# separate machines; rolling back one does nothing for the other).
#
# Every release lives in its own directory and `current` is just a symlink, so
# rolling back is repointing the symlink at the previous good release and
# reloading PM2. deploy-release.sh keeps the last 5 releases, so the last several
# versions are always one command away.
#
#   scripts/rollback.sh                 # roll back to the release just before current
#   scripts/rollback.sh main-a1b2c3d    # roll back to a specific release dir
#
# CAUTION — migrations: rolling back CODE is only safe if the schema the old code
# expects still exists. If the bad release ran a DESTRUCTIVE migration (dropped/
# renamed a column, incompatible type change), the old code will break against the
# changed schema — roll the schema back too, or forward-fix instead. This is why
# migrations must be backward-compatible (expand/contract). See DEPLOYMENT.md.
set -euo pipefail
APP=/srv/notes-api
TARGET="${1:-}"                  # a specific release dir, or empty = "the one before current"
cd "$APP/releases"
CURRENT="$(basename "$(readlink "$APP/current")")"
if [ -z "$TARGET" ]; then
  TARGET="$(ls -1dt */ | sed 's:/$::' | grep -v "^$CURRENT$" | head -n1)"
fi
[ -d "$APP/releases/$TARGET" ] || { echo "No such release: $TARGET"; exit 1; }
echo "Rolling back: $CURRENT  ->  $TARGET"
ln -sfn "$APP/releases/$TARGET" "$APP/current"
pm2 reload "$APP/ecosystem.config.cjs" --update-env
pm2 save
curl -fsS http://127.0.0.1:8080/health && echo "  ✅ serving after rollback"
