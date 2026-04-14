/**
 * USER ROUTES
 * POST /api/user/register    - Register new user
 * POST /api/user/login       - Login
 * POST /api/user/logout      - Logout
 * GET  /api/user/me          - Get current session user
 * POST /api/user/newsletter  - Subscribe to newsletter
 */
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// ── REGISTER ────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!name || !normalizedEmail || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });

    const [[exists]] = await db.query('SELECT id, is_guest FROM users WHERE email = ?', [normalizedEmail]);

    if (exists && !exists.is_guest)
      return res.status(400).json({ error: 'This email is already registered. Please login.' });

    const hash = await bcrypt.hash(password, 10);

    if (exists) {
      // Upgrade guest account to full account
      await db.query(
        'UPDATE users SET name=?, phone=?, password_hash=?, is_guest=0 WHERE email=?',
        [name, phone, hash, normalizedEmail]
      );
    } else {
      await db.query(
        'INSERT INTO users (uuid, name, email, phone, password_hash, is_guest) VALUES (?, ?, ?, ?, ?, 0)',
        [uuidv4(), name, normalizedEmail, phone, hash]
      );
    }

    const [[user]] = await db.query(
      'SELECT id, name, email, phone FROM users WHERE email = ?', [normalizedEmail]
    );

    req.session.user = { id: user.id, name: user.name, email: user.email, is_admin: 0 };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LOGIN ───────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const [[user]] = await db.query('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

    if (!user || !user.password_hash)
      return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password' });

    req.session.user = {
      id:       user.id,
      name:     user.name,
      email:    user.email,
      is_admin: user.is_admin
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LOGOUT ──────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── GET SESSION USER ────────────────────────────────────────
router.get('/me', (req, res) => {
  if (req.session.user) return res.json({ user: req.session.user });
  res.json({ user: null });
});

// ── NEWSLETTER SUBSCRIBE ────────────────────────────────────
router.post('/newsletter', async (req, res) => {
  try {
    const { email, name } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return res.status(400).json({ error: 'Email required' });
    await db.query(
      'INSERT IGNORE INTO newsletter (email, name) VALUES (?, ?)',
      [normalizedEmail, name]
    );
    res.json({ success: true, message: 'Subscribed to Anton Craftex newsletter!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
