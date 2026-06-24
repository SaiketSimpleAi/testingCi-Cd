#!/usr/bin/env bash
# `npm run build` for a plain-JavaScript service.
#
# There is no TypeScript compile step here, so "build" is the closest honest
# equivalent: it parses every source file with `node --check` and fails the gate
# if any file has a syntax error — proving the code at least loads before it can
# merge to main. (See the engineering standard, §6 / §2: the PR gate proves the
# code builds; the deployable artifact is assembled once on merge in
# deploy-staging.yml, not here.)
set -euo pipefail

status=0
while IFS= read -r -d '' f; do
  if ! node --check "$f"; then
    echo "syntax error: $f" >&2
    status=1
  fi
done < <(find src -name '*.js' -print0)

if [ "$status" -eq 0 ]; then
  echo "build OK — all src/*.js parse"
fi
exit "$status"
