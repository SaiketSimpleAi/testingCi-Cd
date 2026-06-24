<!--
  Single-mainline standard: short-lived branch -> PR into main -> squash merge.
  Branch name: <type>/SA-<number>-<short-kebab>  (feature|bugfix|hotfix|chore|docs)
  Keep PRs small and focused. `pr-checks` must be green before merge.
-->

## What & why
<!-- What does this change do, and why? The diff shows the "what" in detail;
     use this space for the intent/context a reviewer needs. -->


## Ticket
<!-- Link the Jira key, e.g. SA-123. One ticket, one branch. -->
SA-

## Type of change
- [ ] feature
- [ ] bugfix
- [ ] hotfix
- [ ] chore / docs

## How to test
<!-- Steps a reviewer can follow. Note anything that needs the STAGING VM. -->


## Checklist
- [ ] `pr-checks` is green (`npm test` + `npm run build`)
- [ ] Squash-merge intended; branch will be deleted on merge
- [ ] No secrets, real `.env`, or build artifacts committed (config is read from the VM-local `.env`)
- [ ] DB changes are a migration in `migrations/` and **backward-compatible** (expand/contract — see DEPLOYMENT.md)
- [ ] Docs updated if behavior, endpoints, or deploy/runbook changed

## Deploy / rollout notes
<!-- Anything special for STAGING auto-deploy or the gated PROD release (AU + EU)?
     Schema migration? Config/secret to add on the VMs first? Otherwise "none". -->
none
