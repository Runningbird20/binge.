const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const MAX_BIO_LENGTH = 280;
const MAX_AVATAR_URL_LENGTH = 3_000_000;

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    bio: user.bio || '',
    avatarUrl: user.avatar_url || null,
    createdAt: user.created_at,
  };
}

router.post('/signup', async (req, res) => {
  const username = req.body.username?.trim();
  const email = req.body.email?.trim().toLowerCase();
  const password = req.body.password;
  const bio = req.body.bio?.trim() || '';
  const avatarUrl = req.body.avatarUrl?.trim() || null;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (bio.length > MAX_BIO_LENGTH) {
    return res.status(400).json({ error: `Bio must be ${MAX_BIO_LENGTH} characters or fewer` });
  }
  if (avatarUrl && avatarUrl.length > MAX_AVATAR_URL_LENGTH) {
    return res.status(400).json({ error: 'Avatar image is too large' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash, bio, avatar_url) VALUES (?, ?, ?, ?, ?)'
    ).run(username, email, hash, bio, avatarUrl);
    const user = db
      .prepare('SELECT id, username, email, bio, avatar_url, created_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid);
    const token = jwt.sign(
      { id: result.lastInsertRowid, username, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({
      token,
      user: serializeUser(user),
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, user: serializeUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, bio, avatar_url, created_at FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(serializeUser(user));
});

module.exports = router;
