'use strict';

const express = require('express');
const notesRouter = require('./routes/notes');

// We export the Express app WITHOUT calling listen() here.
// This lets tests import the app and drive it with supertest,
// while server.js is responsible for actually binding a port.
function createApp() {
  const app = express();

  app.use(express.json());

  // Liveness/readiness probe. CI, Docker/Compose, and the post-deploy
  // health check all hit this to decide whether the container is healthy.
  app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: '1.1.0' });
});

  app.use('/api/notes', notesRouter);

  // 404 fallback
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Centralized error handler. The 4-arg signature (incl. `next`) is what marks
  // this as an Express error handler, even though `next` is unused.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
