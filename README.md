# Notes API — single-mainline CI/CD, build-once artifact on Azure VMs

A deliberately small Node.js + PostgreSQL REST API that implements the team
**single-mainline branching + CI/CD engineering standard**: work on one permanent
branch (`main`), build **one** immutable artifact on merge, and promote those exact
bytes through **two shared environments — STAGING then PROD** — running on our own
**Azure VMs under PM2 behind Nginx**. Nothing is rebuilt downstream, so what QA
signs off on STAGING is byte-for-byte what customers run in PROD.

```
src/server.js  → boots HTTP server, optional boot migrations, graceful shutdown
src/app.js     → Express app (no listen — so tests can import it)
src/db.js      → shared Postgres connection pool, configured by env vars
src/migrate.js → tiny dependency-free SQL migration runner
src/routes/    → the /api/notes CRUD endpoints
migrations/    → versioned .sql schema files
tests/         → jest + supertest integration tests (PR gate)
tests/e2e/     → post-deploy smoke test, run against the deployed STAGING VM
```

The API: `GET /health`, and CRUD on `/api/notes` (list, get, create, delete).

---

## The model in one picture

```
feature/SA-123  ──PR──▶  main  ──merge──▶  BUILD ONCE                 ──▶  STAGING VM   ──▶  release vX.Y.Z  ──▶  PROD VMs
  pr-checks:               (squash)         notes-api-main-<sha>.tar.gz       (auto:           (gated promotion:    (AU + EU)
  test + build                              → Azure Blob (immutable)          pm2 reload,      download the SAME
  (no deploy)                                                                 e2e + UAT)       artifact, no rebuild)
```

There is exactly **one build**, on merge to `main`. Every step after that
re-deploys the same bytes — STAGING runs the artifact, and publishing a release
tag promotes that identical artifact to the PROD VMs behind a manual gate.

| Trigger | Workflow | What happens |
|---|---|---|
| PR into `main` | [`pr-checks.yml`](.github/workflows/pr-checks.yml) | `npm test` (coverage gate) + `npm run build` (syntax check). No deploy. Green checks gate the merge. |
| Push to `main` | [`deploy-staging.yml`](.github/workflows/deploy-staging.yml) | **Build the artifact once**, publish to immutable storage, ship to the STAGING VM, `pm2 reload`, run the e2e smoke suite. |
| Publish release `vX.Y.Z` | [`deploy-prod.yml`](.github/workflows/deploy-prod.yml) | **No build.** Download that exact `main-<sha>` artifact and ship it to the PROD VMs (AU + EU) behind a manual approval gate. |

Every deploy (and any failed PR check) reports outcome + who triggered it to
Slack via [`notify-slack.yml`](.github/workflows/notify-slack.yml) — a feature
toggle, off unless `SLACK_NOTIFICATIONS=true`.

> **Note on language:** the engineering standard is written for a TypeScript
> service (it has a `tsc --noEmit` typecheck step and compiles to `dist/`). This
> service is plain JavaScript, so there is **no typecheck step** and the artifact
> ships `src/` rather than a compiled `dist/`. Everything else — the branching,
> the build-once artifact, the VM/PM2 promotion model, the gate — is applied as
> written.

---

## Run it locally (the optional DEV)

There's nothing to spin up beyond Node and a Postgres to point at:

```bash
nvm use                       # picks up .nvmrc → Node 24.x
npm ci
cp .env.example .env          # local, non-production values
# point DATABASE_URL at a local or shared-dev Postgres, then:
npm test                      # jest integration tests (needs Postgres) + coverage
npm run dev                   # node --watch with --env-file=.env, on http://localhost:3000
curl localhost:3000/health
```

> ⚠️ **Folder-name gotcha:** if this directory's name contains a colon (`:`),
> npm can't add `node_modules/.bin` to `PATH` on macOS/Linux and `npm test` /
> `npm run …` break. Keep the folder named `TestingCi-Cd` (hyphen). CI is
> unaffected — GitHub checks out to a colon-free path.

---

## Day-to-day workflow

```bash
git checkout -b feature/SA-123-add-csv-export   # 1. short-lived branch off main
# ... edit code ...
git commit -am "add csv export"
git push -u origin feature/SA-123-add-csv-export # 2. push the branch
gh pr create                                     # 3. open a PR → pr-checks runs (NO deploy)
# review the green checks, then:
gh pr merge --squash                             # 4. squash-merge → builds + auto-deploys to STAGING
```

- **On a PR:** `pr-checks` runs `npm test` + `npm run build`. It can't merge unless green.
- **On merge to `main`:** the one build happens; the artifact auto-deploys to the STAGING VM and the e2e smoke suite runs.
- **To ship to PROD:** after UAT signoff on STAGING, publish a GitHub Release `vX.Y.Z`. That promotes the **same** artifact to the PROD VMs (AU + EU) behind the approval gate.

Branch naming, the freeze branch, the hotfix lane, multi-region, and the
dependency policy all follow the engineering standard.

---

## Deployment, rollback, and one-time VM setup

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full picture: the VM layout
(`/srv/notes-api/{releases,current,shared}`), PM2 + Nginx, the artifact lifecycle,
how migrations run as their own pre-cutover step, rollback (symlink flip via
[`scripts/rollback.sh`](scripts/rollback.sh)), and the one-time setup checklist.
