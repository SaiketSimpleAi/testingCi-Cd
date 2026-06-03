'use strict';

const express = require('express');
const notesRouter = require('./routes/notes');

// We export the Express app WITHOUT calling listen() here.
// This lets tests import the app and drive it with supertest,
// while server.js is responsible for actually binding a port.
function createApp() {
  const app = express();

  app.use(express.json());

  // Liveness/readiness probe. CI, Docker, and Railway all hit this
  // to decide whether the container is healthy.
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api/notes', notesRouter);

  // 404 fallback
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Centralized error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
