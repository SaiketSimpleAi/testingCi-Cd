'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/notes  -> list all notes (newest first)
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, title, body, created_at FROM notes ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/notes/:id -> a single note
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, title, body, created_at FROM notes WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'note not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/notes -> create a note
router.post('/', async (req, res, next) => {
  try {
    const { title, body } = req.body || {};
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }
    const { rows } = await db.query(
      'INSERT INTO notes (title, body) VALUES ($1, $2) RETURNING id, title, body, created_at',
      [title, body || '']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notes/:id -> remove a note
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM notes WHERE id = $1', [
      req.params.id,
    ]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'note not found' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
