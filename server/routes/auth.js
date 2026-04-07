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

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
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
    const token = createToken(user);
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

  const token = createToken(user);
  res.json({ token, user: serializeUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, bio, avatar_url, created_at FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(serializeUser(user));
});

router.patch('/account', requireAuth, async (req, res) => {
  const username = req.body.username?.trim();
  const email = req.body.email?.trim().toLowerCase();
  const currentPassword = req.body.currentPassword;
  const newPassword = req.body.newPassword;

  if (username !== undefined && !username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  if (email !== undefined && !email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (newPassword !== undefined && newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  if (newPassword !== undefined && !currentPassword) {
    return res.status(400).json({ error: 'Current password is required to change your password' });
  }

  const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!currentUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (username && username !== currentUser.username) {
    const duplicateUsername = db
      .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .get(username, currentUser.id);
    if (duplicateUsername) {
      return res.status(409).json({ error: 'Username is already in use' });
    }
  }

  if (email && email !== currentUser.email) {
    const duplicateEmail = db
      .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .get(email, currentUser.id);
    if (duplicateEmail) {
      return res.status(409).json({ error: 'Email is already in use' });
    }
  }

  let nextPasswordHash = currentUser.password_hash;
  if (newPassword !== undefined) {
    const validCurrentPassword = await bcrypt.compare(currentPassword, currentUser.password_hash);
    if (!validCurrentPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    nextPasswordHash = await bcrypt.hash(newPassword, 10);
  }

  const nextUsername = username ?? currentUser.username;
  const nextEmail = email ?? currentUser.email;

  const hasChanges =
    nextUsername !== currentUser.username ||
    nextEmail !== currentUser.email ||
    nextPasswordHash !== currentUser.password_hash;

  if (!hasChanges) {
    return res.status(400).json({ error: 'No account changes to save' });
  }

  try {
    db.prepare(
      'UPDATE users SET username = ?, email = ?, password_hash = ? WHERE id = ?'
    ).run(nextUsername, nextEmail, nextPasswordHash, currentUser.id);

    const updatedUser = db.prepare(
      'SELECT id, username, email, bio, avatar_url, created_at FROM users WHERE id = ?'
    ).get(currentUser.id);

    res.json({
      token: createToken(updatedUser),
      user: serializeUser(updatedUser),
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
