# Staging deploy — complete walkthrough (what, where, which files)

How a code change reaches the **staging VM** (`20.212.177.222`) through the CI/CD
pipeline, end to end. This documents the *current* staging setup, which follows
the single-mainline standard with one simplification: the build-once artifact is
copied **straight to the VM over SSH** (no Azure Blob / OIDC yet).

> **Golden rule:** there is exactly **one build**, on merge to `main`. The VM only
> ever *extracts and runs* that artifact — it never builds, never `npm install`s.

---

## 1. The flow at a glance

```
   feature branch ──PR──▶  pr-checks (gate)  ──merge to main──▶  deploy-staging  ──ssh──▶  STAGING VM
                            test + build                          BUILD ONCE               extract → migrate
                            (GitHub runner)                       (GitHub runner)           → symlink → pm2 reload
                                                                                            (the VM)
                                                                                                │
                                                                                   Nginx :80 ──┘ → 127.0.0.1:8080
                                                                                   http://20.212.177.222/health
```

| Where it runs | What happens |
|---|---|
| **GitHub-hosted runner** | gate (`npm test`, `npm run build`), then the one build: `npm ci` → `npm prune --omit=dev` → `tar` the artifact |
| **SSH (runner → VM)** | `scp` the tarball to `/tmp`, then run `scripts/deploy-release.sh` on the VM over SSH |
| **The VM** | extract into a release dir → run migrations → swap the `current` symlink → `pm2 reload` |

---

## 2. Step by step — what & where

### Step 1 — Open a PR → `pr-checks` runs (GitHub runner)
- **File:** [`.github/workflows/pr-checks.yml`](../.github/workflows/pr-checks.yml)
- Runs `npm ci` → `npm test` (against a throwaway Postgres service container) → `npm run build`.
- **Nothing deploys.** This is the required merge gate. Red = can't merge.

### Step 2 — Merge to `main` → `deploy-staging` runs (GitHub runner)
- **File:** [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml)
- Re-runs the gate as insurance, then **builds the one artifact**:
  - `npm prune --omit=dev` (keep only production deps)
  - `tar -czf notes-api-main-<sha>.tar.gz src migrations package.json package-lock.json node_modules`
- Computes the release id: `main-<short-sha>` (e.g. `main-3357347`).

### Step 3 — Ship to the VM (SSH, runner → VM)
Still in `deploy-staging.yml`:
```bash
scp  notes-api-<sha>.tar.gz  deploy@20.212.177.222:/tmp/
ssh  deploy@20.212.177.222  "bash -s -- <sha>"  < scripts/deploy-release.sh
```
- Auth uses the **`STAGING_SSH_KEY`** secret (a dedicated deploy key) as the low-privilege **`deploy`** user. Host comes from the **`STAGING_HOST`** secret.

### Step 4 — The VM applies the release (on the VM)
- **File:** [`scripts/deploy-release.sh`](../scripts/deploy-release.sh) (piped over SSH, runs as `deploy`)
  1. Extract the tarball → `/srv/notes-api/releases/main-<sha>/`
  2. **Run migrations** (`node --env-file=shared/.env src/migrate.js`) — *before* cutover, expand/contract safe
  3. Atomically swap `/srv/notes-api/current` → the new release dir
  4. `pm2 startOrReload /srv/notes-api/ecosystem.config.cjs` (zero-downtime cluster reload) + `pm2 save`
  5. Keep the **last 5** releases, prune older ones
- **File on VM:** [`ecosystem.config.cjs`](../ecosystem.config.cjs) tells PM2 to run `src/server.js` from `current/`, reading config via `--env-file=/srv/notes-api/shared/.env`.

### Step 5 — Serve (on the VM)
- The app listens on `127.0.0.1:8080`. **Nginx** proxies `:80 → 8080`, so the service is reachable at `http://20.212.177.222/health`.
- A Slack message is posted if `SLACK_NOTIFICATIONS=true` (currently off → no-op).

---

## 3. What changes on the VM each deploy

```
/srv/notes-api/
├── current  ───────────▶ releases/main-<new-sha>     ← symlink repointed (the only "switch")
├── releases/
│   ├── main-3357347/     ← this deploy (src, migrations, node_modules, …)
│   └── main-<older>/     ← previous releases (last 5 kept for instant rollback)
├── shared/.env           ← UNCHANGED by deploys (config + secrets live here, mode 600)
└── ecosystem.config.cjs  ← UNCHANGED by deploys (PM2 config)
```
Only `current` + a new `releases/<sha>` dir change. `shared/.env` (DB URL, secrets,
`REGION`, `PORT`) is **never** touched by a deploy and is **never** in the artifact.

---

## 4. File inventory — which file does what

**In the repo (source of truth):**
| File | Role |
|---|---|
| `.github/workflows/pr-checks.yml` | Merge gate: test + build on every PR |
| `.github/workflows/deploy-staging.yml` | The one build + ship to STAGING on merge to `main` |
| `.github/workflows/deploy-prod.yml` | Gated promotion to PROD (AU/EU) — *not active yet* |
| `.github/workflows/notify-slack.yml` | Reusable Slack notifier (toggle) |
| `scripts/deploy-release.sh` | Runs on the VM: extract → migrate → symlink → reload |
| `scripts/rollback.sh` | Symlink flip to a previous release + reload |
| `scripts/build.sh` | `npm run build` = JS syntax check (no TS compile) |
| `ecosystem.config.cjs` | PM2 process config (copied to the VM once) |
| `tests/e2e/smoke.mjs` | Post-deploy smoke suite (disabled in CI until staging DNS/TLS) |
| `src/`, `migrations/` | The app + SQL migrations (shipped in the artifact) |

**On the VM (created once, by provisioning — not the pipeline):**
| Path | Role |
|---|---|
| `deploy` user + key | Low-privilege CI login (key = `STAGING_SSH_KEY`) |
| `/srv/notes-api/shared/.env` | Per-env config + secrets (DB URL, PORT=8080, `RUN_MIGRATIONS_ON_BOOT=false`) |
| `/srv/notes-api/ecosystem.config.cjs` | PM2 config |
| PostgreSQL (localhost) | Staging database |
| Nginx (`:80 → 8080`) | Reverse proxy |
| `pm2-deploy` systemd unit | Resurrects PM2 apps on reboot |

**GitHub secrets used:** `STAGING_HOST`, `STAGING_SSH_KEY`.

---

## 5. Verify & roll back

**Verify (anyone):**
```bash
curl http://20.212.177.222/health      # {"status":"ok","version":"..."}
```
**Inspect on the VM (as `deploy`):**
```bash
ls -l /srv/notes-api/current           # which release is live
pm2 status                             # process health
```
**Roll back to the previous release:**
```bash
# on the VM, as deploy:
scripts/rollback.sh                    # or: scripts/rollback.sh main-<sha>
```
> ⚠️ Safe only if migrations were backward-compatible. A destructive migration
> needs the schema rolled back too, or a forward-fix.

---

## 6. Security / safety choices made

- **Dedicated deploy key**, not the admin (`azureuser`) key. Private key lives only
  in GitHub secrets — never on the server, never in git.
- **Least privilege:** CI logs in as a non-sudo `deploy` user scoped to `/srv/notes-api`.
- **Secrets only on the VM:** DB password etc. live in `shared/.env` (mode `600`),
  not in the repo or the artifact.
- **Postgres bound to localhost** — not exposed publicly.
- **Idempotent provisioning** — re-running the setup never clobbers the DB/env.
- **Build once, never on the server** — the VM only extracts + runs proven bytes.
- **Atomic cutover + 5-release retention** — instant, low-risk rollback.

---

## 7. Not done yet (intentional, next steps)
- **TLS** — Nginx serves `:80` only; add a domain + Certbot for HTTPS.
- **e2e smoke in CI** — re-enable in `deploy-staging.yml` once staging has a reachable URL.
- **Immutable artifact store (Azure Blob/OIDC)** — needed before the gated **PROD**
  promotion (`deploy-prod.yml`) can re-deploy the *same* bytes to AU/EU.
- **Branch protection on `main`** — require `verify` + review so the gate is enforced.
