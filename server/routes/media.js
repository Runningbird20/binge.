const express = require('express');
const db = require('../db');

const router = express.Router();

// --- Movies ---
router.get('/movies', (req, res) => {
  const { search, genre, year } = req.query;
  let query = 'SELECT * FROM movies WHERE 1=1';
  const params = [];
  if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { query += ' AND genre LIKE ?';  params.push(`%${genre}%`); }
  if (year)   { query += ' AND year = ?';       params.push(Number(year)); }
  query += ' ORDER BY title ASC';
  res.json(db.prepare(query).all(...params));
});

router.get('/movies/:id', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    'SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count FROM ratings WHERE media_type = ? AND media_id = ?'
  ).get('movie', req.params.id);
  res.json({ ...movie, ...stats });
});

// --- TV Shows ---
router.get('/tv-shows', (req, res) => {
  const { search, genre } = req.query;
  let query = 'SELECT * FROM tv_shows WHERE 1=1';
  const params = [];
  if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`); }
  if (genre)  { query += ' AND genre LIKE ?';  params.push(`%${genre}%`); }
  query += ' ORDER BY title ASC';
  res.json(db.prepare(query).all(...params));
});

router.get('/tv-shows/:id', (req, res) => {
  const show = db.prepare('SELECT * FROM tv_shows WHERE id = ?').get(req.params.id);
  if (!show) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    'SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count FROM ratings WHERE media_type = ? AND media_id = ?'
  ).get('tv_show', req.params.id);
  res.json({ ...show, ...stats });
});

// --- Books ---
router.get('/books', (req, res) => {
  const { search, genre, author } = req.query;
  let query = 'SELECT * FROM books WHERE 1=1';
  const params = [];
  if (search) { query += ' AND title LIKE ?';  params.push(`%${search}%`); }
  if (genre)  { query += ' AND genre LIKE ?';   params.push(`%${genre}%`); }
  if (author) { query += ' AND author LIKE ?';  params.push(`%${author}%`); }
  query += ' ORDER BY title ASC';
  res.json(db.prepare(query).all(...params));
});

router.get('/books/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  const stats = db.prepare(
    'SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count FROM ratings WHERE media_type = ? AND media_id = ?'
  ).get('book', req.params.id);
  res.json({ ...book, ...stats });
});

module.exports = router;
