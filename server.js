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
const multer = require('multer');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const databasePath = path.resolve(process.env.EMBERFANS_DB_PATH || './data/emberfans.db');
const mediaDirectory = path.resolve(process.env.EMBERFANS_MEDIA_PATH || './data/media');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.mkdirSync(mediaDirectory, { recursive: true });
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
  CREATE TABLE IF NOT EXISTS communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS community_members (
    community_id INTEGER NOT NULL REFERENCES communities(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'moderator', 'member')),
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (community_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL REFERENCES communities(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (community_id, name)
  );
  CREATE TABLE IF NOT EXISTS channel_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS direct_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_one_id INTEGER NOT NULL REFERENCES users(id),
    user_two_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(user_one_id < user_two_id),
    UNIQUE (user_one_id, user_two_id)
  );
  CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES direct_conversations(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique ON users(display_name COLLATE NOCASE)');

const contentColumns = db.prepare('PRAGMA table_info(content_items)').all().map(column => column.name);
if (!contentColumns.includes('media_path')) db.exec('ALTER TABLE content_items ADD COLUMN media_path TEXT');
if (!contentColumns.includes('media_mime_type')) db.exec('ALTER TABLE content_items ADD COLUMN media_mime_type TEXT');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, mediaDirectory),
    filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
    callback(allowed.includes(file.mimetype) ? null : new Error('Only JPEG, PNG, WebP, MP4, and WebM files are accepted.'), allowed.includes(file.mimetype));
  }
});

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(express.json({ limit: '64kb' }));
app.use((request, response, next) => request.path.startsWith('/data/') ? response.sendStatus(404) : next());
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

function hasContentAccess(userId, item) {
  if (item.access_type === 'free') return true;
  const entitlement = db.prepare(`SELECT id FROM entitlements WHERE user_id = ? AND (content_id = ? OR (content_id IS NULL AND entitlement_type = 'subscriber')) AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`).get(userId, item.id, new Date().toISOString());
  return Boolean(entitlement);
}

function communityMembership(communityId, userId) {
  return db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?').get(communityId, userId);
}

function communityModerator(communityId, user) {
  const membership = communityMembership(communityId, user.id);
  return user.role === 'admin' || membership?.role === 'owner' || membership?.role === 'moderator';
}

function messagePayload(message) {
  return { id: message.id, body: message.body, createdAt: message.created_at, author: { id: message.author_id, username: message.display_name, role: message.role } };
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
  const { username, password } = request.body || {};
  const user = db.prepare('SELECT * FROM users WHERE display_name = ? COLLATE NOCASE').get(String(username || '').trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) return response.status(401).json({ error: 'Username or password is incorrect.' });
  return response.json({ token: createToken(user), user: publicUser(user) });
});

app.get('/api/me', authenticate, (request, response) => response.json({ user: publicUser(request.user) }));

app.get('/api/communities', authenticate, (request, response) => {
  const communities = db.prepare(`SELECT communities.*, community_members.role AS member_role, (SELECT count(*) FROM community_members WHERE community_id = communities.id) AS member_count FROM communities JOIN community_members ON community_members.community_id = communities.id WHERE community_members.user_id = ? ORDER BY communities.name`).all(request.user.id);
  response.json({ communities });
});

app.post('/api/communities', authenticate, requireRole('performer', 'admin'), (request, response) => {
  const { name, description = '' } = request.body || {};
  const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (String(name || '').trim().length < 3 || String(name || '').trim().length > 80 || slug.length < 3) return response.status(400).json({ error: 'Community name must be 3 to 80 characters.' });
  try {
    const result = db.transaction(() => {
      const created = db.prepare('INSERT INTO communities (owner_id, name, slug, description) VALUES (?, ?, ?, ?)').run(request.user.id, name.trim(), slug, String(description).trim());
      db.prepare("INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, 'owner')").run(created.lastInsertRowid, request.user.id);
      db.prepare('INSERT INTO channels (community_id, name) VALUES (?, ?), (?, ?)').run(created.lastInsertRowid, 'welcome', created.lastInsertRowid, 'general');
      return created.lastInsertRowid;
    })();
    response.status(201).json({ community: db.prepare('SELECT * FROM communities WHERE id = ?').get(result) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return response.status(409).json({ error: 'A community with that name already exists.' });
    throw error;
  }
});

app.post('/api/communities/:id/join', authenticate, (request, response) => {
  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(request.params.id);
  if (!community) return response.status(404).json({ error: 'Community was not found.' });
  db.prepare("INSERT OR IGNORE INTO community_members (community_id, user_id, role) VALUES (?, ?, 'member')").run(community.id, request.user.id);
  response.status(201).json({ joined: true });
});

app.get('/api/communities/:id/channels', authenticate, (request, response) => {
  if (!communityMembership(request.params.id, request.user.id)) return response.status(403).json({ error: 'Join this community before viewing its channels.' });
  response.json({ channels: db.prepare('SELECT * FROM channels WHERE community_id = ? ORDER BY name').all(request.params.id) });
});

app.post('/api/communities/:id/channels', authenticate, (request, response) => {
  if (!communityModerator(request.params.id, request.user)) return response.status(403).json({ error: 'Only community moderators can create channels.' });
  const name = String(request.body?.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '');
  if (name.length < 2 || name.length > 48) return response.status(400).json({ error: 'Channel names must be 2 to 48 lowercase characters.' });
  try { const result = db.prepare('INSERT INTO channels (community_id, name) VALUES (?, ?)').run(request.params.id, name); response.status(201).json({ channel: db.prepare('SELECT * FROM channels WHERE id = ?').get(result.lastInsertRowid) }); }
  catch (error) { if (String(error.message).includes('UNIQUE')) return response.status(409).json({ error: 'That channel already exists.' }); throw error; }
});

app.get('/api/channels/:id/messages', authenticate, (request, response) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(request.params.id);
  if (!channel) return response.status(404).json({ error: 'Channel was not found.' });
  if (!communityMembership(channel.community_id, request.user.id)) return response.status(403).json({ error: 'Join this community before viewing messages.' });
  const messages = db.prepare(`SELECT channel_messages.*, users.display_name, users.role FROM channel_messages JOIN users ON users.id = channel_messages.author_id WHERE channel_id = ? ORDER BY channel_messages.id DESC LIMIT 100`).all(channel.id).reverse().map(messagePayload);
  response.json({ messages });
});

app.post('/api/channels/:id/messages', authenticate, (request, response) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(request.params.id);
  const body = String(request.body?.body || '').trim();
  if (!channel) return response.status(404).json({ error: 'Channel was not found.' });
  if (!communityMembership(channel.community_id, request.user.id)) return response.status(403).json({ error: 'Join this community before posting.' });
  if (!body || body.length > 2000) return response.status(400).json({ error: 'Messages must be 1 to 2,000 characters.' });
  const result = db.prepare('INSERT INTO channel_messages (channel_id, author_id, body) VALUES (?, ?, ?)').run(channel.id, request.user.id, body);
  const message = db.prepare(`SELECT channel_messages.*, users.display_name, users.role FROM channel_messages JOIN users ON users.id = channel_messages.author_id WHERE channel_messages.id = ?`).get(result.lastInsertRowid);
  response.status(201).json({ message: messagePayload(message) });
});

app.delete('/api/channel-messages/:id', authenticate, (request, response) => {
  const message = db.prepare('SELECT channel_messages.*, channels.community_id FROM channel_messages JOIN channels ON channels.id = channel_messages.channel_id WHERE channel_messages.id = ?').get(request.params.id);
  if (!message) return response.status(404).json({ error: 'Message was not found.' });
  if (message.author_id !== request.user.id && !communityModerator(message.community_id, request.user)) return response.status(403).json({ error: 'Only the author or a moderator can remove this message.' });
  db.prepare('DELETE FROM channel_messages WHERE id = ?').run(message.id);
  response.sendStatus(204);
});

app.get('/api/direct-conversations', authenticate, (request, response) => {
  const conversations = db.prepare(`SELECT direct_conversations.*, CASE WHEN user_one_id = ? THEN two.display_name ELSE one.display_name END AS recipient_username, CASE WHEN user_one_id = ? THEN two.id ELSE one.id END AS recipient_id FROM direct_conversations JOIN users AS one ON one.id = user_one_id JOIN users AS two ON two.id = user_two_id WHERE user_one_id = ? OR user_two_id = ? ORDER BY direct_conversations.id DESC`).all(request.user.id, request.user.id, request.user.id, request.user.id);
  response.json({ conversations });
});

app.post('/api/direct-conversations', authenticate, (request, response) => {
  const recipient = db.prepare('SELECT id, display_name FROM users WHERE display_name = ? COLLATE NOCASE').get(String(request.body?.username || '').trim());
  if (!recipient) return response.status(404).json({ error: 'No account exists with that username.' });
  if (recipient.id === request.user.id) return response.status(400).json({ error: 'You cannot start a direct conversation with yourself.' });
  const [first, second] = [request.user.id, recipient.id].sort((a, b) => a - b);
  db.prepare('INSERT OR IGNORE INTO direct_conversations (user_one_id, user_two_id) VALUES (?, ?)').run(first, second);
  const conversation = db.prepare('SELECT * FROM direct_conversations WHERE user_one_id = ? AND user_two_id = ?').get(first, second);
  response.status(201).json({ conversation });
});

function directConversationForUser(conversationId, userId) {
  return db.prepare('SELECT * FROM direct_conversations WHERE id = ? AND (user_one_id = ? OR user_two_id = ?)').get(conversationId, userId, userId);
}

app.get('/api/direct-conversations/:id/messages', authenticate, (request, response) => {
  if (!directConversationForUser(request.params.id, request.user.id)) return response.status(403).json({ error: 'You are not part of this direct conversation.' });
  const messages = db.prepare(`SELECT direct_messages.*, users.display_name, users.role FROM direct_messages JOIN users ON users.id = direct_messages.author_id WHERE conversation_id = ? ORDER BY direct_messages.id DESC LIMIT 100`).all(request.params.id).reverse().map(messagePayload);
  response.json({ messages });
});

app.post('/api/direct-conversations/:id/messages', authenticate, (request, response) => {
  if (!directConversationForUser(request.params.id, request.user.id)) return response.status(403).json({ error: 'You are not part of this direct conversation.' });
  const body = String(request.body?.body || '').trim();
  if (!body || body.length > 2000) return response.status(400).json({ error: 'Messages must be 1 to 2,000 characters.' });
  const result = db.prepare('INSERT INTO direct_messages (conversation_id, author_id, body) VALUES (?, ?, ?)').run(request.params.id, request.user.id, body);
  const message = db.prepare(`SELECT direct_messages.*, users.display_name, users.role FROM direct_messages JOIN users ON users.id = direct_messages.author_id WHERE direct_messages.id = ?`).get(result.lastInsertRowid);
  response.status(201).json({ message: messagePayload(message) });
});

app.get('/api/content', authenticate, (request, response) => {
  const items = db.prepare(`SELECT content_items.*, users.display_name AS performer_name FROM content_items JOIN users ON users.id = content_items.performer_id WHERE published_at IS NOT NULL ORDER BY published_at DESC`).all()
    .map(item => ({ ...item, hasAccess: hasContentAccess(request.user.id, item), mediaUrl: item.media_path && hasContentAccess(request.user.id, item) ? `/api/media/${item.id}` : null }));
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

app.post('/api/content/:id/media', authenticate, requireRole('performer', 'admin'), upload.single('media'), (request, response) => {
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(request.params.id);
  if (!item) return response.status(404).json({ error: 'Content item was not found.' });
  if (request.user.role !== 'admin' && item.performer_id !== request.user.id) return response.status(403).json({ error: 'Only the performer who created this item can upload media.' });
  if (!request.file) return response.status(400).json({ error: 'Select a supported image or video file.' });
  if (item.media_path) fs.rmSync(path.join(mediaDirectory, item.media_path), { force: true });
  db.prepare('UPDATE content_items SET media_path = ?, media_mime_type = ? WHERE id = ?').run(request.file.filename, request.file.mimetype, item.id);
  response.status(201).json({ itemId: item.id, uploaded: true });
});

app.get('/api/media/:contentId', authenticate, (request, response, next) => {
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(request.params.contentId);
  if (!item || !item.media_path) return response.status(404).json({ error: 'Media was not found.' });
  if (!hasContentAccess(request.user.id, item) && request.user.id !== item.performer_id && request.user.role !== 'admin') return response.status(403).json({ error: 'This media requires an active entitlement.' });
  const mediaPath = path.resolve(mediaDirectory, item.media_path);
  if (!mediaPath.startsWith(`${mediaDirectory}${path.sep}`) || !fs.existsSync(mediaPath)) return response.status(404).json({ error: 'Media was not found.' });
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Disposition', 'inline');
  response.setHeader('Content-Type', item.media_mime_type);
  const stream = fs.createReadStream(mediaPath);
  stream.on('error', next);
  stream.pipe(response);
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
  if (error instanceof multer.MulterError) return response.status(400).json({ error: 'Upload failed. Files may be up to 100 MB.' });
  if (error.message && error.message.includes('Only JPEG')) return response.status(400).json({ error: error.message });
  console.error('[emberfans] unhandled request error', error);
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(port, () => console.log(`EmberFans service is listening on http://127.0.0.1:${port}`));
