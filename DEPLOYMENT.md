# Deployment guide — Notes API on Azure VMs (PM2 + Nginx)

This service follows the team **single-mainline branching + CI/CD engineering
standard**. The deployable thing is built **exactly once** on merge to `main` — a
single versioned tarball — and those exact bytes are promoted, unchanged, through
**two shared environments running on our own Azure VMs**: STAGING, then PROD
(AU + EU). Production **never builds**: the VM only ever *extracts and runs* the
artifact it was handed, then reloads PM2.

- **Compute:** Azure VMs (Ubuntu 24.04 LTS), Node **≥ 24.5** under **PM2** (cluster mode), behind **Nginx** (TLS via Certbot).
- **Artifact store:** Azure Blob Storage (`sasaiartifacts` / `releases` container) — immutable, one blob per commit SHA.
- **Database:** PostgreSQL (a dedicated DB per environment / region).
- **CI/CD:** GitHub Actions — `pr-checks`, `deploy-staging`, `deploy-prod`, `notify-slack`. SSH to the VMs with a per-environment deploy key; OIDC only to reach Blob Storage.
- **Config:** read at runtime from a **VM-local `.env`** (`/srv/notes-api/shared/.env`) via Node's native `--env-file` — never baked into the artifact, never in Git.

---

## The core guarantee: build once, promote the artifact

What you tested is byte-for-byte what you shipped. The artifact is a single
tarball assembled on merge to `main`:

```
notes-api-main-<sha>.tar.gz  =  src/  +  migrations/  +  package.json  +  package-lock.json  +  production node_modules/
```

(Plain-JS service, so it ships `src/` rather than a compiled `dist/`.) It is
uploaded to immutable storage and **never rebuilt**. STAGING runs it; a release
promotes the *same* blob to PROD.

**Identical everywhere:** the artifact — same source, same dependency tree, same lockfile.
**Differs per environment/region (read at runtime):** `DATABASE_URL`, `PGSSL`, `REGION`, `PORT`, log level, secrets — all in the VM-local `.env`.

> `node_modules` is built on the CI runner (`ubuntu-latest`, linux-x64) and the
> VMs are Ubuntu 24.04 linux-x64, so the dependency tree is binary-compatible.
> Never "fix" a mismatch by running `npm ci` on the VM — that reintroduces a
> downstream build and breaks the guarantee.

---

## VM layout

Each VM (STAGING, PROD-AU, PROD-EU) is laid out identically:

```
/srv/notes-api/
├── current            -> releases/main-<sha>      (symlink; swapped atomically on deploy)
├── releases/
│   ├── main-a1b2c3d/   (an extracted artifact: src/ migrations/ node_modules/ …)
│   └── main-9f8e7d6/   (the last 5 are kept for instant rollback)
├── shared/
│   └── .env            (this environment's config — owned by deploy, mode 600)
└── ecosystem.config.cjs   (PM2 config — points at current/, reads shared/.env)
```

`ecosystem.config.cjs` and `scripts/deploy-release.sh` are committed in this repo;
the deploy step copies the artifact up and runs `deploy-release.sh` on the VM over
SSH. PM2 runs in **cluster mode**, so `pm2 reload` cycles workers with zero dropped
connections. Nginx terminates TLS on `:443` and proxies to `127.0.0.1:<PORT>`; it
is unaffected by deploys — releases swap the app behind it.

Example PROD-EU `/srv/notes-api/shared/.env`:

```
REGION=eu
PORT=8080
DATABASE_URL=postgres://...eu-host.../notes
PGSSL=true
RUN_MIGRATIONS_ON_BOOT=false        # the deploy step owns migrations — see below
```

---

## The pipeline

| Workflow | Trigger | What it does |
|---|---|---|
| [`pr-checks.yml`](.github/workflows/pr-checks.yml) | PR into `main` | `npm test` (integration suite + coverage threshold, against a throwaway Postgres) → `npm run build` (syntax check). The required status check. Never deploys. |
| [`deploy-staging.yml`](.github/workflows/deploy-staging.yml) | push to `main` | Re-runs the gate, **builds the one artifact**, uploads it to Blob, SSHes it to the STAGING VM, runs `deploy-release.sh` (migrate → symlink swap → `pm2 reload`), then runs the e2e smoke suite against the live STAGING URL. |
| [`deploy-prod.yml`](.github/workflows/deploy-prod.yml) | published release `vX.Y.Z` | **No build.** Resolves the release to its `main-<sha>`, pauses at the `production` approval gate, then downloads the *same* blob and ships it to each PROD VM (AU + EU). |
| [`notify-slack.yml`](.github/workflows/notify-slack.yml) | called by the others | Posts outcome + who triggered to Slack (toggle: `SLACK_NOTIFICATIONS=true`). |

### Migrations run as their own step, before cutover
`deploy-release.sh` runs `node src/migrate.js` against the VM's `.env` **before**
swapping the `current` symlink — the live release keeps serving against the new
schema while we reload. The app boots with `RUN_MIGRATIONS_ON_BOOT=false` on the
VMs, so PM2 cluster workers never race to migrate on reload. (Locally the app
still migrates on boot for convenience.)

> **Migrations must be backward-compatible (expand/contract):** add columns/tables
> first, remove later, so old and new code both run against the same schema. This
> is what makes a code rollback safe — see the rollback caveat below.

---

## Versioning

Releases use semantic versioning: `vMAJOR.MINOR.PATCH` (`v1.4.0`; hotfix `v1.4.1`).
The Git tag, the GitHub Release, and the deployed artifact all map to one commit.

| Stage | Artifact identity | Built or promoted? |
|---|---|---|
| STAGING | `notes-api-main-<sha>.tar.gz` | Built once (on merge to `main`) |
| PROD | the **same** `notes-api-main-<sha>.tar.gz`, released as `vX.Y.Z` | Promoted (re-deploy of the pinned artifact) |

There is no floating "latest." "What's live" is the `current` symlink on the VM —
a single `ls -l` away.

---

## Rolling back a bad PROD release

Every release sits in its own directory and `current` is just a symlink, so the
previous good build is already on each VM. `deploy-release.sh` keeps the **last 5**.

**Path A — fast path (emergency).** Flip the symlink on the affected VM, per region:

```bash
ssh deploy@<prod-au-host>
ls -1dt /srv/notes-api/releases/        # newest first; find the last good main-<sha>
scripts/rollback.sh main-a1b2c3d        # relink current → main-a1b2c3d, pm2 reload, health check
# then REPEAT on the EU VM — AU and EU are separate machines.
```

**Path B — clean path (preferred when not on fire).** Re-promote the last good
release *through the pipeline* so the deployment record stays truthful: re-run
`deploy-prod` for the previous good tag (Actions → `deploy-prod` → Re-run), or cut
a patch release pinned to the previous good `main-<sha>`. Same gate, same Slack
trail. Use it to reconcile after a Path-A emergency flip too.

> **The caveat that matters — migrations.** Rolling back *code* is safe only if the
> schema the old code expects still exists. If the bad release ran a **destructive**
> change (dropped/renamed a column, incompatible type change), rolling back the code
> alone breaks against the changed schema — roll the schema back too, or
> **forward-fix** instead. Keep migrations backward-compatible to avoid this.

**Every rollback:** announce it, do it **per affected region** (check both AU and
EU), verify with the `/health` check before declaring it resolved, and open a
ticket to root-cause and forward-fix.

---

## One-time setup checklist

Done once per environment/service; after this the pipeline runs itself.

- **Provision the VMs** — Ubuntu 24.04 LTS: a STAGING VM and one PROD VM per region (AU, EU). On each: install **Node 24.x** (≥ 24.5), **PM2** (`pm2 startup` so it survives reboot), **Nginx** + **Certbot** TLS. Keep the two-layer firewall (ufw + Azure NSG).
- **Deploy user + directories** — a low-privilege `deploy` user; `/srv/notes-api/{releases,shared}`; place `ecosystem.config.cjs` at `/srv/notes-api/`; create `/srv/notes-api/shared/.env` with this environment's config (owned by `deploy`, mode `600`). The `.env` is the only place secrets live.
- **SSH deploy keys** — a keypair per environment; public key in the VM's `deploy` `authorized_keys`; private key as a GitHub secret (`STAGING_SSH_KEY`, `PROD_SSH_KEY`). Hosts as `STAGING_HOST`, `PROD_HOST_AU`, `PROD_HOST_EU`.
- **CI → VM network path** — either a **self-hosted runner inside the VNet** (no public SSH), or allow GitHub-hosted runners through the NSG to the `deploy` user. Decide explicitly.
- **Artifact storage** — a Storage account (`sasaiartifacts`) + a `releases` blob container; treat blobs as immutable (never overwrite a `main-<sha>`). Register an Entra app / federated credential for the `azure/login` OIDC step. Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- **Production environment gate** — Settings → Environments → create `production`, add release approvers as required reviewers. This is what makes `deploy-prod` pause.
- **Branch protection on `main`** — require `pr-checks` to pass, require review, no direct pushes, linear history (squash).
- **Slack notifications (optional)** — create a Slack incoming webhook, add it as secret `SLACK_WEBHOOK_URL`, set repo variable `SLACK_NOTIFICATIONS=true`. Leave unset to disable.

### GitHub secrets & variables summary

| Name | Kind | What it is |
|---|---|---|
| `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` | secret | OIDC login to reach Blob Storage |
| `STAGING_SSH_KEY` / `PROD_SSH_KEY` | secret | per-environment deploy private keys |
| `STAGING_HOST` / `PROD_HOST_AU` / `PROD_HOST_EU` | secret | VM hostnames |
| `SLACK_WEBHOOK_URL` | secret | Slack incoming webhook (optional) |
| `SLACK_NOTIFICATIONS` | variable | `true` to enable Slack posts |

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness/readiness probe |
| GET | `/api/notes` | List all notes |
| GET | `/api/notes/:id` | Get one note |
| POST | `/api/notes` | Create a note (JSON: `{ "title", "body" }`) |
| DELETE | `/api/notes/:id` | Delete a note |
