require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const databasePath = path.resolve(process.env.EMBERFANS_DB_PATH || './data/emberfans.db');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer', 'performer', 'moderator', 'admin')),
    age_verified_at TEXT NOT NULL,
    terms_accepted_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    performer_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('sfw_photo', 'nsfw_photo', 'video', 'live_event')),
    access_type TEXT NOT NULL CHECK(access_type IN ('free', 'subscriber', 'purchase')),
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS entitlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content_id INTEGER REFERENCES content_items(id),
    entitlement_type TEXT NOT NULL CHECK(entitlement_type IN ('subscriber', 'purchase')),
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS device_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    performer_id INTEGER NOT NULL REFERENCES users(id),
    viewer_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'revoked', 'stopped')),
    viewer_consented_at TEXT,
    performer_approved_at TEXT,
    stopped_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS device_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES device_sessions(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname), { index: 'index.html', dotfiles: 'deny' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name, role: user.role, ageVerifiedAt: user.age_verified_at, createdAt: user.created_at };
}

function createToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '8h', issuer: 'emberfans', audience: 'emberfans-web' });
}

function authenticate(request, response, next) {
  const [scheme, token] = (request.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return response.status(401).json({ error: 'Authentication is required.' });
  try {
    const claims = jwt.verify(token, jwtSecret, { issuer: 'emberfans', audience: 'emberfans-web' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(claims.sub);
    if (!user) return response.status(401).json({ error: 'Account is no longer available.' });
    request.user = user;
    next();
  } catch {
    return response.status(401).json({ error: 'Your session is invalid or has expired.' });
  }
}

function requireRole(...roles) {
  return (request, response, next) => roles.includes(request.user.role)
    ? next()
    : response.status(403).json({ error: 'You do not have permission for this action.' });
}

app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'emberfans-api' }));

app.post('/api/auth/register', authLimiter, (request, response) => {
  const { email, password, displayName, confirmAdult, acceptTerms } = request.body || {};
  if (!emailPattern.test(String(email || ''))) return response.status(400).json({ error: 'Enter a valid email address.' });
  if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 48) return response.status(400).json({ error: 'Display name must be 2 to 48 characters.' });
  if (typeof password !== 'string' || password.length < 12) return response.status(400).json({ error: 'Password must be at least 12 characters.' });
  if (confirmAdult !== true || acceptTerms !== true) return response.status(400).json({ error: 'Adult confirmation and Terms acceptance are required.' });
  const passwordHash = bcrypt.hashSync(password, 12);
  const now = new Date().toISOString();
  try {
    const result = db.prepare('INSERT INTO users (email, display_name, password_hash, age_verified_at, terms_accepted_at) VALUES (?, ?, ?, ?, ?)')
      .run(email.trim().toLowerCase(), displayName.trim(), passwordHash, now, now);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    return response.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return response.status(409).json({ error: 'An account already exists for that email.' });
    throw error;
  }
});

app.post('/api/auth/login', authLimiter, (request, response) => {
  const { email, password } = request.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) return response.status(401).json({ error: 'Email or password is incorrect.' });
  return response.json({ token: createToken(user), user: publicUser(user) });
});

app.get('/api/me', authenticate, (request, response) => response.json({ user: publicUser(request.user) }));

app.get('/api/content', authenticate, (request, response) => {
  const items = db.prepare(`SELECT content_items.*, users.display_name AS performer_name FROM content_items JOIN users ON users.id = content_items.performer_id WHERE published_at IS NOT NULL ORDER BY published_at DESC`).all();
  response.json({ items });
});

app.post('/api/content', authenticate, requireRole('performer', 'admin'), (request, response) => {
  const { title, summary = '', kind, accessType } = request.body || {};
  const validKinds = ['sfw_photo', 'nsfw_photo', 'video', 'live_event'];
  const validAccessTypes = ['free', 'subscriber', 'purchase'];
  if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 120) return response.status(400).json({ error: 'Title must be 2 to 120 characters.' });
  if (!validKinds.includes(kind) || !validAccessTypes.includes(accessType)) return response.status(400).json({ error: 'Choose a valid content type and access type.' });
  const result = db.prepare('INSERT INTO content_items (performer_id, title, summary, kind, access_type, published_at) VALUES (?, ?, ?, ?, ?, ?)').run(request.user.id, title.trim(), String(summary).trim(), kind, accessType, new Date().toISOString());
  response.status(201).json({ item: db.prepare('SELECT * FROM content_items WHERE id = ?').get(result.lastInsertRowid) });
});

app.post('/api/device-sessions/:id/stop', authenticate, (request, response) => {
  const session = db.prepare('SELECT * FROM device_sessions WHERE id = ?').get(request.params.id);
  if (!session) return response.status(404).json({ error: 'Control session was not found.' });
  if (![session.viewer_id, session.performer_id].includes(request.user.id)) return response.status(403).json({ error: 'Only participants can stop this session.' });
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE device_sessions SET status = 'stopped', stopped_at = ? WHERE id = ?").run(now, session.id);
    db.prepare('INSERT INTO device_audit_log (session_id, actor_id, action, details) VALUES (?, ?, ?, ?)').run(session.id, request.user.id, 'emergency_stop', JSON.stringify({ source: 'api' }));
  })();
  response.json({ status: 'stopped', stoppedAt: now });
});

app.use((error, _request, response, _next) => {
  console.error('[emberfans] unhandled request error', error);
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(port, () => console.log(`EmberFans service is listening on http://127.0.0.1:${port}`));
