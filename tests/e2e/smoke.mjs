// Post-deploy e2e smoke test — runs against the DEPLOYED STAGING VM, not in the
// PR gate. The engineering standard (§6/§7) keeps the heavy suite off the fast PR
// checks and on STAGING, against the exact artifact that will ship to PROD. This
// is the honest starting point for that suite: it drives the real running service
// end to end (create → read → delete) so a broken deploy fails loudly before UAT.
//
// Grow it as the API grows. Run by `npm run test:e2e` with E2E_BASE_URL set to the
// deployed base URL (defaults to the VM-local port for on-box checks).
const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

async function main() {
  console.log(`e2e smoke against ${base}`);

  // 1. Health probe.
  const health = await fetch(`${base}/health`);
  const healthBody = await health.json().catch(() => ({}));
  check('GET /health is 200', health.status === 200, `(got ${health.status})`);
  check('health status is ok', healthBody.status === 'ok');

  // 2. Create a note (exercises a DB write end to end).
  const marker = `smoke-${process.env.GITHUB_SHA || 'local'}`;
  const created = await fetch(`${base}/api/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: marker, body: 'e2e smoke' }),
  });
  const note = await created.json().catch(() => ({}));
  check('POST /api/notes is 201', created.status === 201, `(got ${created.status})`);
  check('created note has an id', Boolean(note.id));

  // 3. Read it back, then clean it up so the smoke run leaves no residue.
  if (note.id) {
    const got = await fetch(`${base}/api/notes/${note.id}`);
    check('GET /api/notes/:id is 200', got.status === 200, `(got ${got.status})`);

    const del = await fetch(`${base}/api/notes/${note.id}`, { method: 'DELETE' });
    check('DELETE /api/notes/:id is 204', del.status === 204, `(got ${del.status})`);
  }

  if (failures > 0) {
    console.error(`\ne2e smoke FAILED — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\ne2e smoke passed');
}

main().catch((err) => {
  console.error('e2e smoke crashed', err);
  process.exit(1);
});
