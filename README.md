# Notes API — Node.js + PostgreSQL with a full Docker CI/CD pipeline

A deliberately small REST API used to demonstrate a **complete, production-style
CI/CD pipeline**: local Docker development → automated tests in CI → Docker image
build → automated deploy to **Railway** (with managed PostgreSQL).

```
src/server.js  → boots HTTP server, runs migrations, handles graceful shutdown
src/app.js     → Express app (no listen — so tests can import it)
src/db.js      → shared Postgres connection pool, configured by env vars
src/migrate.js → tiny dependency-free SQL migration runner
src/routes/    → the /api/notes CRUD endpoints
migrations/    → versioned .sql schema files
tests/         → Jest + supertest integration tests (hit a real Postgres)
```

The API: `GET /health`, and CRUD on `/api/notes` (list, get, create, delete).

---

## The big picture

```
   you push to main
         │
         ▼
┌──────────────────┐   ┌──────────────────┐        ┌──────────────────┐
│  1. TEST          │→ │  2. BUILD IMAGE   │   ╎    │  DEPLOY           │
│  npm ci + lint    │   │  docker build     │   ╎    │  Railway watches  │
│  + jest against   │   │  push to GHCR     │   ╎    │  the repo and     │
│  a Postgres svc   │   │                   │   ╎    │  auto-deploys     │
└──────────────────┘   └──────────────────┘        └──────────────────┘
   ── GitHub Actions (quality gate) ──         ── Railway integration ──
```

GitHub Actions runs the **test → build** quality gate (each job only runs if the
previous passed). **Deployment is handled by Railway's GitHub integration**, which
watches `main` and auto-deploys using `railway.json`. PRs are tested + built but
never deployed.

---

## Step 0 — Run it locally (no Docker needed)

```bash
cp .env.example .env          # local config
# point DATABASE_URL at any local Postgres, then:
npm install
npm test                      # runs migrations + integration tests
npm run dev                   # starts the API on http://localhost:3000
curl localhost:3000/health
```

> ⚠️ **Gotcha for THIS folder:** the directory name `TestingCi:Cd` contains a
> colon. On macOS/Linux the colon is the `PATH` separator, which breaks
> `npm test`/`npm run …` (npm can't add `node_modules/.bin` to `PATH`). Either
> run binaries directly (`./node_modules/.bin/jest`) **or rename the folder to
> `TestingCi-Cd`**. This only affects local runs in this folder — on GitHub the
> repo is checked out to a colon-free path, so CI is unaffected.

## Step 1 — Run the whole stack with Docker Compose

```bash
docker compose up --build     # starts Postgres + the app together
curl localhost:3000/api/notes
```

`docker-compose.yml` defines two services — `db` (Postgres 16) and `app` (built
from the `Dockerfile`). The app waits for the DB's healthcheck before starting,
and runs migrations automatically on boot.

## Step 2 — Understand the production Docker image

The `Dockerfile` is **multi-stage**:

1. **`deps` stage** runs `npm ci --omit=dev` so only runtime deps land in the
   image (no jest/eslint). Because dependencies are a separate layer, they're
   only re-installed when `package*.json` changes — fast rebuilds.
2. **`runner` stage** copies those deps + the source, runs as the non-root
   `node` user, exposes port 3000, and defines a `HEALTHCHECK`.

Smaller image, better cache hits, and it doesn't run as root.

---

## Step 3 — The CI/CD pipeline (`.github/workflows/ci-cd.yml`)

### Job 1 — `test`
- Spins up a **Postgres service container** alongside the runner and waits for
  `pg_isready`.
- `npm ci` (reproducible install from the lockfile) → `npm run lint` → `npm test`.
- Tests run against that real Postgres via `DATABASE_URL`, exactly like prod.

### Job 2 — `build-and-push` (`needs: test`)
- Logs in to **GitHub Container Registry (GHCR)** using the auto-provided
  `GITHUB_TOKEN` (no secret to create).
- Builds the image and pushes two tags: the immutable commit SHA and `latest`.
- Uses GitHub Actions build cache (`cache-from/to: type=gha`) for speed.

### Job 3 — `deploy` (`needs: build-and-push`)
- Guarded by `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`
  so it **never runs on PRs**.
- Bound to a GitHub `production` environment — add required reviewers there for a
  manual approval gate before deploys.
- Installs the Railway CLI and runs `railway up`, authenticated by a
  `RAILWAY_TOKEN` secret.

---

## Step 4 — One-time setup to make it deploy

### a) Push to GitHub
```bash
git init && git add . && git commit -m "initial commit"
git branch -M main
git remote add origin git@github.com:<you>/notes-api.git
git push -u origin main
```

### b) Create the Railway project + database
1. Create a project at <https://railway.app> and add a **PostgreSQL** plugin.
2. Add a service from your GitHub repo (Railway detects `railway.json` and builds
   with the `Dockerfile`).
3. In the service **Variables**, set:
   - `DATABASE_URL` → reference the Postgres plugin's connection string
     (`${{Postgres.DATABASE_URL}}` in Railway's variable referencing).
   - `PGSSL` → `true` (Railway's Postgres requires TLS).
   - `PORT` → Railway injects this automatically; the app already reads it.

### c) Wire the GitHub → Railway secret
1. In Railway: **Project → Settings → Tokens** → create a **Project Token**.
2. In GitHub: **Repo → Settings → Secrets and variables → Actions**
   - Add a **secret** `RAILWAY_TOKEN` = the token from step 1.
   - Add a **variable** `RAILWAY_SERVICE` = your Railway service name.

### d) Ship it
Push to `main`. Watch the run under the repo's **Actions** tab:
`test` → `build-and-push` → `deploy`. When green, your API is live at the
Railway-provided URL — verify with `curl https://<your-app>.up.railway.app/health`.

> **Simpler alternative:** Railway can auto-deploy on every push if you connect
> the repo directly in its dashboard — then you can delete Job 3 and keep CI
> (test + build) in GitHub Actions only. The CLI approach here gives you explicit
> control and an approval gate, which is closer to a real production setup.

---

## How migrations stay safe
`src/migrate.js` records applied files in a `schema_migrations` table and wraps
each migration in a transaction. It runs on every boot but only applies new
files — safe to redeploy repeatedly. To evolve the schema, add
`migrations/002_*.sql`; it applies automatically on the next deploy.

## Production checklist (beyond this demo)
- Add `helmet`, rate limiting, and request validation (e.g. `zod`).
- Run migrations as a separate release step, not on every replica's boot, once
  you scale past one instance.
- Add a security scan (e.g. `npm audit` / Trivy image scan) as a CI job.
- Pin base images by digest and enable Dependabot.
# testingCi-Cd
