'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { runMigrations } = require('../src/migrate');
const db = require('../src/db');

const app = createApp();

// These are integration tests: they talk to a REAL Postgres database.
// In CI, a Postgres "service container" provides that database and sets
// DATABASE_URL. Locally you can run `docker compose up db` first.
beforeAll(async () => {
  await runMigrations();
  await db.query('DELETE FROM notes');
});

afterAll(async () => {
  await db.close();
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('notes CRUD', () => {
  it('creates a note', async () => {
    const res = await request(app)
      .post('/api/notes')
      .send({ title: 'first', body: 'hello' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'first', body: 'hello' });
    expect(res.body.id).toBeDefined();
  });

  it('rejects a note with no title', async () => {
    const res = await request(app).post('/api/notes').send({ body: 'x' });
    expect(res.status).toBe(400);
  });

  it('lists notes', async () => {
    const res = await request(app).get('/api/notes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('fetches and then deletes a note', async () => {
    const created = await request(app)
      .post('/api/notes')
      .send({ title: 'to-delete' });
    const id = created.body.id;

    const got = await request(app).get(`/api/notes/${id}`);
    expect(got.status).toBe(200);

    const del = await request(app).delete(`/api/notes/${id}`);
    expect(del.status).toBe(204);

    const gone = await request(app).get(`/api/notes/${id}`);
    expect(gone.status).toBe(404);
  });
});
