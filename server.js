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
    channel_id INTEGER REFERENCES channels(id),
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
  CREATE TABLE IF NOT EXISTS community_member_roles (
    community_id INTEGER NOT NULL REFERENCES communities(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('administrator', 'moderator', 'creator', 'subscriber', 'member')),
    assigned_by INTEGER NOT NULL REFERENCES users(id),
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (community_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL REFERENCES communities(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text', 'forum', 'voice', 'auditorium')),
    display_mode TEXT NOT NULL DEFAULT 'standard',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (community_id, name)
  );
  CREATE TABLE IF NOT EXISTS channel_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL REFERENCES communities(id),
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS community_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL REFERENCES communities(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  CREATE TABLE IF NOT EXISTS forum_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 140),
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS forum_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES forum_posts(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS live_channel_participants (
    channel_id INTEGER NOT NULL REFERENCES channels(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channel_id, user_id)
  );
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique ON users(display_name COLLATE NOCASE)');

const contentColumns = db.prepare('PRAGMA table_info(content_items)').all().map(column => column.name);
if (!contentColumns.includes('media_path')) db.exec('ALTER TABLE content_items ADD COLUMN media_path TEXT');
if (!contentColumns.includes('media_mime_type')) db.exec('ALTER TABLE content_items ADD COLUMN media_mime_type TEXT');
if (!contentColumns.includes('channel_id')) db.exec('ALTER TABLE content_items ADD COLUMN channel_id INTEGER REFERENCES channels(id)');
const channelColumns = db.prepare('PRAGMA table_info(channels)').all().map(column => column.name);
if (!channelColumns.includes('type')) db.exec("ALTER TABLE channels ADD COLUMN type TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text', 'forum', 'voice', 'auditorium'))");
if (!channelColumns.includes('description')) db.exec("ALTER TABLE channels ADD COLUMN description TEXT NOT NULL DEFAULT ''");
if (!channelColumns.includes('category_id')) db.exec('ALTER TABLE channels ADD COLUMN category_id INTEGER REFERENCES channel_categories(id)');
if (!channelColumns.includes('position')) db.exec('ALTER TABLE channels ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
if (!channelColumns.includes('display_mode')) db.exec("ALTER TABLE channels ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'standard'");
db.prepare('SELECT id FROM communities').all().forEach(community => {
  let category = db.prepare('SELECT id FROM channel_categories WHERE community_id = ? ORDER BY position, id LIMIT 1').get(community.id);
  if (!category) {
    const result = db.prepare('INSERT INTO channel_categories (community_id, name, position) VALUES (?, ?, ?)').run(community.id, 'GENERAL', 0);
    category = { id: result.lastInsertRowid };
  }
  db.prepare('UPDATE channels SET category_id = ? WHERE community_id = ? AND category_id IS NULL').run(category.id, community.id);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, mediaDirectory),
    filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
    callback(allowed.includes(file.mimetype) ? null : new Error('Only JPEG, PNG, WebP, GIF, MP4, and WebM files are accepted.'), allowed.includes(file.mimetype));
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

function communityRole(communityId, userId) {
  const membership = communityMembership(communityId, userId);
  if (!membership) return null;
  return db.prepare('SELECT role FROM community_member_roles WHERE community_id = ? AND user_id = ?').get(communityId, userId)?.role || membership.role;
}

function communityModerator(communityId, user) {
  const role = communityRole(communityId, user.id);
  return user.role === 'admin' || ['owner', 'administrator', 'moderator'].includes(role);
}

function communityRoleManager(communityId, user) {
  return user.role === 'admin' || communityRole(communityId, user.id) === 'owner';
}

function communityCreator(communityId, user) {
  return ['admin', 'performer'].includes(user.role) || ['owner', 'administrator', 'moderator', 'creator'].includes(communityRole(communityId, user.id));
}

function communityAudit(communityId, actorId, action, details = {}) {
  db.prepare('INSERT INTO community_audit_log (community_id, actor_id, action, details) VALUES (?, ?, ?, ?)').run(communityId, actorId, action, JSON.stringify(details));
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
  const communities = db.prepare(`SELECT communities.*, COALESCE(community_member_roles.role, community_members.role) AS member_role, (SELECT count(*) FROM community_members WHERE community_id = communities.id) AS member_count FROM communities JOIN community_members ON community_members.community_id = communities.id LEFT JOIN community_member_roles ON community_member_roles.community_id = community_members.community_id AND community_member_roles.user_id = community_members.user_id WHERE community_members.user_id = ? ORDER BY communities.name`).all(request.user.id);
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
      const category = db.prepare('INSERT INTO channel_categories (community_id, name, position) VALUES (?, ?, ?)').run(created.lastInsertRowid, 'GENERAL', 0);
      db.prepare('INSERT INTO channels (community_id, name, category_id, position) VALUES (?, ?, ?, ?), (?, ?, ?, ?)').run(created.lastInsertRowid, 'welcome', category.lastInsertRowid, 0, created.lastInsertRowid, 'general', category.lastInsertRowid, 1);
      communityAudit(created.lastInsertRowid, request.user.id, 'community_created', { name: name.trim(), slug });
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
  response.json({ categories: db.prepare('SELECT * FROM channel_categories WHERE community_id = ? ORDER BY position, id').all(request.params.id), channels: db.prepare('SELECT * FROM channels WHERE community_id = ? ORDER BY category_id, position, id').all(request.params.id) });
});

app.get('/api/communities/:id/audit-log', authenticate, (request, response) => {
  if (!communityModerator(request.params.id, request.user)) return response.status(403).json({ error: 'Only community moderators can view the audit log.' });
  const entries = db.prepare(`SELECT community_audit_log.*, users.display_name, users.role
    FROM community_audit_log JOIN users ON users.id = community_audit_log.actor_id
    WHERE community_audit_log.community_id = ? ORDER BY community_audit_log.id DESC LIMIT 250`).all(request.params.id)
    .map(entry => ({ id: entry.id, action: entry.action, details: JSON.parse(entry.details), createdAt: entry.created_at, actor: { id: entry.actor_id, username: entry.display_name, role: entry.role } }));
  response.json({ entries });
});

app.get('/api/communities/:id/members', authenticate, (request, response) => {
  if (!communityModerator(request.params.id, request.user)) return response.status(403).json({ error: 'Only community moderators can view member roles.' });
  const members = db.prepare(`SELECT users.id, users.display_name, users.role AS account_role, community_members.role AS membership_role, COALESCE(community_member_roles.role, community_members.role) AS community_role
    FROM community_members JOIN users ON users.id = community_members.user_id
    LEFT JOIN community_member_roles ON community_member_roles.community_id = community_members.community_id AND community_member_roles.user_id = community_members.user_id
    WHERE community_members.community_id = ? ORDER BY CASE WHEN community_members.role = 'owner' THEN 0 ELSE 1 END, users.display_name COLLATE NOCASE`).all(request.params.id);
  response.json({ members, canManageRoles: communityRoleManager(request.params.id, request.user) });
});

app.put('/api/communities/:id/members/:userId/role', authenticate, (request, response) => {
  if (!communityRoleManager(request.params.id, request.user)) return response.status(403).json({ error: 'Only the community owner or an administrator can assign roles.' });
  const member = communityMembership(request.params.id, request.params.userId);
  const role = String(request.body?.role || '');
  if (!member) return response.status(404).json({ error: 'Community member was not found.' });
  if (member.role === 'owner') return response.status(400).json({ error: 'The community owner role cannot be changed here.' });
  if (!['administrator', 'moderator', 'creator', 'subscriber', 'member'].includes(role)) return response.status(400).json({ error: 'Choose a valid community role.' });
  db.transaction(() => {
    if (role === 'member') db.prepare('DELETE FROM community_member_roles WHERE community_id = ? AND user_id = ?').run(request.params.id, member.user_id);
    else db.prepare('INSERT INTO community_member_roles (community_id, user_id, role, assigned_by) VALUES (?, ?, ?, ?) ON CONFLICT(community_id, user_id) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = CURRENT_TIMESTAMP').run(request.params.id, member.user_id, role, request.user.id);
    communityAudit(request.params.id, request.user.id, 'member_role_changed', { memberId: member.user_id, role });
  })();
  response.json({ role });
});

app.post('/api/communities/:id/categories', authenticate, (request, response) => {
  if (!communityModerator(request.params.id, request.user)) return response.status(403).json({ error: 'Only community moderators can create categories.' });
  const name = String(request.body?.name || '').trim().toUpperCase();
  if (name.length < 2 || name.length > 48) return response.status(400).json({ error: 'Category names must be 2 to 48 characters.' });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) AS value FROM channel_categories WHERE community_id = ?').get(request.params.id).value + 1;
  const result = db.prepare('INSERT INTO channel_categories (community_id, name, position) VALUES (?, ?, ?)').run(request.params.id, name, position);
  const category = db.prepare('SELECT * FROM channel_categories WHERE id = ?').get(result.lastInsertRowid);
  communityAudit(request.params.id, request.user.id, 'category_created', { categoryId: category.id, name: category.name });
  response.status(201).json({ category });
});

app.delete('/api/communities/:communityId/categories/:categoryId', authenticate, (request, response) => {
  const communityId = Number(request.params.communityId);
  const categoryId = Number(request.params.categoryId);
  if (!communityModerator(communityId, request.user)) return response.status(403).json({ error: 'Only community moderators can delete categories.' });
  const category = db.prepare('SELECT * FROM channel_categories WHERE id = ? AND community_id = ?').get(categoryId, communityId);
  if (!category) return response.status(404).json({ error: 'Category was not found.' });
  const result = db.transaction(() => {
    let fallback = db.prepare('SELECT * FROM channel_categories WHERE community_id = ? AND id != ? ORDER BY position, id LIMIT 1').get(communityId, categoryId);
    if (!fallback) {
      const created = db.prepare('INSERT INTO channel_categories (community_id, name, position) VALUES (?, ?, 0)').run(communityId, 'GENERAL');
      fallback = db.prepare('SELECT * FROM channel_categories WHERE id = ?').get(created.lastInsertRowid);
    }
    const movedChannels = db.prepare('SELECT id FROM channels WHERE community_id = ? AND category_id = ? ORDER BY position, id').all(communityId, categoryId);
    let nextPosition = db.prepare('SELECT COALESCE(MAX(position), -1) AS value FROM channels WHERE community_id = ? AND category_id = ?').get(communityId, fallback.id).value + 1;
    const moveChannel = db.prepare('UPDATE channels SET category_id = ?, position = ? WHERE id = ?');
    movedChannels.forEach(item => moveChannel.run(fallback.id, nextPosition++, item.id));
    db.prepare('DELETE FROM channel_categories WHERE id = ?').run(categoryId);
    db.prepare('SELECT id FROM channel_categories WHERE community_id = ? ORDER BY position, id').all(communityId).forEach((item, position) => db.prepare('UPDATE channel_categories SET position = ? WHERE id = ?').run(position, item.id));
    communityAudit(communityId, request.user.id, 'category_deleted', { categoryId: category.id, name: category.name, fallbackCategory: fallback.name, movedChannelCount: movedChannels.length });
    return { fallbackCategory: fallback.name, movedChannelCount: movedChannels.length };
  })();
  response.json(result);
});

app.put('/api/communities/:id/sidebar', authenticate, (request, response) => {
  if (!communityModerator(request.params.id, request.user)) return response.status(403).json({ error: 'Only community moderators can reorder the sidebar.' });
  const categories = Array.isArray(request.body?.categories) ? request.body.categories : [];
  const channels = Array.isArray(request.body?.channels) ? request.body.channels : [];
  db.transaction(() => {
    const updateCategory = db.prepare('UPDATE channel_categories SET position = ? WHERE id = ? AND community_id = ?');
    const updateChannel = db.prepare('UPDATE channels SET category_id = ?, position = ? WHERE id = ? AND community_id = ?');
    categories.forEach((category, position) => updateCategory.run(position, Number(category.id), request.params.id));
    channels.forEach(channel => updateChannel.run(channel.categoryId ? Number(channel.categoryId) : null, Number(channel.position), Number(channel.id), request.params.id));
    communityAudit(request.params.id, request.user.id, 'sidebar_reordered', { categoryCount: categories.length, channelCount: channels.length });
  })();
  response.sendStatus(204);
});

app.post('/api/communities/:id/channels', authenticate, (request, response) => {
  if (!communityModerator(request.params.id, request.user)) return response.status(403).json({ error: 'Only community moderators can create channels.' });
  const name = String(request.body?.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '');
  const type = String(request.body?.type || 'text');
  const displayMode = String(request.body?.displayMode || 'standard');
  const description = String(request.body?.description || '').trim();
  if (name.length < 2 || name.length > 48) return response.status(400).json({ error: 'Channel names must be 2 to 48 lowercase characters.' });
  if (!['text', 'forum', 'voice', 'auditorium'].includes(type)) return response.status(400).json({ error: 'Choose a valid channel type.' });
  if (!['standard', 'gallery'].includes(displayMode)) return response.status(400).json({ error: 'Choose a valid channel display mode.' });
  const categoryId = request.body?.categoryId ? Number(request.body.categoryId) : null;
  if (categoryId && !db.prepare('SELECT id FROM channel_categories WHERE id = ? AND community_id = ?').get(categoryId, request.params.id)) return response.status(400).json({ error: 'Choose a category in this community.' });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) AS value FROM channels WHERE community_id = ? AND category_id IS ?').get(request.params.id, categoryId).value + 1;
  try { const result = db.prepare('INSERT INTO channels (community_id, name, type, display_mode, description, category_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)').run(request.params.id, name, type, displayMode, description.slice(0, 240), categoryId, position); const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(result.lastInsertRowid); communityAudit(request.params.id, request.user.id, 'channel_created', { channelId: channel.id, name: channel.name, type: channel.type, displayMode: channel.display_mode, categoryId: channel.category_id }); response.status(201).json({ channel }); }
  catch (error) { if (String(error.message).includes('UNIQUE')) return response.status(409).json({ error: 'That channel already exists.' }); throw error; }
});

app.delete('/api/channels/:id', authenticate, (request, response) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(request.params.id);
  if (!channel) return response.status(404).json({ error: 'Channel was not found.' });
  if (!communityModerator(channel.community_id, request.user)) return response.status(403).json({ error: 'Only community moderators can delete channels.' });
  const mediaFiles = [];
  db.transaction(() => {
    const mediaItems = db.prepare('SELECT id, media_path FROM content_items WHERE channel_id = ?').all(channel.id);
    mediaItems.forEach(item => {
      db.prepare('DELETE FROM entitlements WHERE content_id = ?').run(item.id);
      db.prepare('DELETE FROM content_items WHERE id = ?').run(item.id);
      if (item.media_path) mediaFiles.push(item.media_path);
    });
    db.prepare('DELETE FROM live_channel_participants WHERE channel_id = ?').run(channel.id);
    db.prepare('DELETE FROM channel_messages WHERE channel_id = ?').run(channel.id);
    db.prepare('DELETE FROM forum_replies WHERE post_id IN (SELECT id FROM forum_posts WHERE channel_id = ?)').run(channel.id);
    db.prepare('DELETE FROM forum_posts WHERE channel_id = ?').run(channel.id);
    db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
    communityAudit(channel.community_id, request.user.id, 'channel_deleted', { channelId: channel.id, name: channel.name, type: channel.type });
  })();
  mediaFiles.forEach(file => fs.rmSync(path.join(mediaDirectory, file), { force: true }));
  response.sendStatus(204);
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
  if (channel.type !== 'text' || channel.display_mode === 'gallery') return response.status(400).json({ error: 'This channel does not accept text messages.' });
  if (!communityMembership(channel.community_id, request.user.id)) return response.status(403).json({ error: 'Join this community before posting.' });
  if (!body || body.length > 2000) return response.status(400).json({ error: 'Messages must be 1 to 2,000 characters.' });
  const result = db.prepare('INSERT INTO channel_messages (channel_id, author_id, body) VALUES (?, ?, ?)').run(channel.id, request.user.id, body);
  const message = db.prepare(`SELECT channel_messages.*, users.display_name, users.role FROM channel_messages JOIN users ON users.id = channel_messages.author_id WHERE channel_messages.id = ?`).get(result.lastInsertRowid);
  response.status(201).json({ message: messagePayload(message) });
});

app.get('/api/channels/:id/forum-posts', authenticate, (request, response) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(request.params.id);
  if (!channel) return response.status(404).json({ error: 'Channel was not found.' });
  if (channel.type !== 'forum') return response.status(400).json({ error: 'This channel is not a forum.' });
  if (!communityMembership(channel.community_id, request.user.id)) return response.status(403).json({ error: 'Join this community before viewing posts.' });
  const posts = db.prepare(`SELECT forum_posts.*, users.display_name, users.role, (SELECT count(*) FROM forum_replies WHERE post_id = forum_posts.id) AS reply_count FROM forum_posts JOIN users ON users.id = forum_posts.author_id WHERE channel_id = ? ORDER BY forum_posts.id DESC LIMIT 100`).all(channel.id).map(post => ({ id: post.id, title: post.title, body: post.body, replyCount: post.reply_count, createdAt: post.created_at, author: { id: post.author_id, username: post.display_name, role: post.role } }));
  response.json({ posts });
});

app.post('/api/channels/:id/forum-posts', authenticate, (request, response) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(request.params.id);
  const title = String(request.body?.title || '').trim();
  const body = String(request.body?.body || '').trim();
  if (!channel) return response.status(404).json({ error: 'Channel was not found.' });
  if (channel.type !== 'forum') return response.status(400).json({ error: 'This channel is not a forum.' });
  if (!communityMembership(channel.community_id, request.user.id)) return response.status(403).json({ error: 'Join this community before posting.' });
  if (title.length < 2 || title.length > 140 || body.length < 1 || body.length > 4000) return response.status(400).json({ error: 'Forum posts need a 2 to 140 character title and a message up to 4,000 characters.' });
  const result = db.prepare('INSERT INTO forum_posts (channel_id, author_id, title, body) VALUES (?, ?, ?, ?)').run(channel.id, request.user.id, title, body);
  response.status(201).json({ post: db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(result.lastInsertRowid) });
});

app.get('/api/forum-posts/:id/replies', authenticate, (request, response) => {
  const post = db.prepare('SELECT forum_posts.*, channels.community_id FROM forum_posts JOIN channels ON channels.id = forum_posts.channel_id WHERE forum_posts.id = ?').get(request.params.id);
  if (!post || !communityMembership(post.community_id, request.user.id)) return response.status(404).json({ error: 'Forum thread was not found.' });
  const replies = db.prepare(`SELECT forum_replies.*, users.display_name, users.role FROM forum_replies JOIN users ON users.id = forum_replies.author_id WHERE post_id = ? ORDER BY forum_replies.id`).all(post.id).map(reply => ({ id: reply.id, body: reply.body, createdAt: reply.created_at, author: { id: reply.author_id, username: reply.display_name, role: reply.role } }));
  response.json({ post: { id: post.id, title: post.title, body: post.body, createdAt: post.created_at, authorId: post.author_id }, replies });
});

app.post('/api/forum-posts/:id/replies', authenticate, (request, response) => {
  const post = db.prepare('SELECT forum_posts.*, channels.community_id FROM forum_posts JOIN channels ON channels.id = forum_posts.channel_id WHERE forum_posts.id = ?').get(request.params.id);
  const body = String(request.body?.body || '').trim();
  if (!post || !communityMembership(post.community_id, request.user.id)) return response.status(404).json({ error: 'Forum thread was not found.' });
  if (!body || body.length > 4000) return response.status(400).json({ error: 'Replies must be 1 to 4,000 characters.' });
  const result = db.prepare('INSERT INTO forum_replies (post_id, author_id, body) VALUES (?, ?, ?)').run(post.id, request.user.id, body);
  response.status(201).json({ reply: { id: result.lastInsertRowid } });
});

app.delete('/api/forum-replies/:id', authenticate, (request, response) => {
  const reply = db.prepare('SELECT forum_replies.*, forum_posts.channel_id, channels.community_id FROM forum_replies JOIN forum_posts ON forum_posts.id = forum_replies.post_id JOIN channels ON channels.id = forum_posts.channel_id WHERE forum_replies.id = ?').get(request.params.id);
  if (!reply) return response.status(404).json({ error: 'Forum reply was not found.' });
  const isModeratorAction = communityModerator(reply.community_id, request.user);
  if (reply.author_id !== request.user.id && !isModeratorAction) return response.status(403).json({ error: 'Only the author or a moderator can delete this reply.' });
  db.prepare('DELETE FROM forum_replies WHERE id = ?').run(reply.id);
  if (isModeratorAction) communityAudit(reply.community_id, request.user.id, 'forum_reply_removed', { replyId: reply.id, channelId: reply.channel_id, authorId: reply.author_id });
  response.sendStatus(204);
});

app.delete('/api/forum-posts/:id', authenticate, (request, response) => {
  const post = db.prepare('SELECT forum_posts.*, channels.community_id FROM forum_posts JOIN channels ON channels.id = forum_posts.channel_id WHERE forum_posts.id = ?').get(request.params.id);
  if (!post) return response.status(404).json({ error: 'Forum post was not found.' });
  const isModeratorAction = communityModerator(post.community_id, request.user);
  if (post.author_id !== request.user.id && !isModeratorAction) return response.status(403).json({ error: 'Only the author or a moderator can delete this forum post.' });
  db.prepare('DELETE FROM forum_replies WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM forum_posts WHERE id = ?').run(post.id);
  if (isModeratorAction) communityAudit(post.community_id, request.user.id, 'forum_post_removed', { postId: post.id, channelId: post.channel_id, authorId: post.author_id });
  response.sendStatus(204);
});

app.get('/api/channels/:id/participants', authenticate, (request, response) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(request.params.id);
  if (!channel) return response.status(404).json({ error: 'Channel was not found.' });
  if (!['voice', 'auditorium'].includes(channel.type)) return response.status(400).json({ error: 'Participants are available only for voice and auditorium channels.' });
  if (!communityMembership(channel.community_id, request.user.id)) return response.status(403).json({ error: 'Join this community before entering the room.' });
  const participants = db.prepare('SELECT users.id, users.display_name, users.role, live_channel_participants.joined_at FROM live_channel_participants JOIN users ON users.id = live_channel_participants.user_id WHERE channel_id = ? ORDER BY joined_at').all(channel.id);
  response.json({ participants });
});

app.post('/api/channels/:id/join', authenticate, (request, response) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(request.params.id);
  if (!channel) return response.status(404).json({ error: 'Channel was not found.' });
  if (!['voice', 'auditorium'].includes(channel.type)) return response.status(400).json({ error: 'Only voice and auditorium channels can be joined as rooms.' });
  if (!communityMembership(channel.community_id, request.user.id)) return response.status(403).json({ error: 'Join this community before entering the room.' });
  db.prepare('INSERT OR IGNORE INTO live_channel_participants (channel_id, user_id) VALUES (?, ?)').run(channel.id, request.user.id);
  response.status(201).json({ joined: true });
});

app.delete('/api/channels/:id/join', authenticate, (request, response) => {
  db.prepare('DELETE FROM live_channel_participants WHERE channel_id = ? AND user_id = ?').run(request.params.id, request.user.id);
  response.sendStatus(204);
});

app.delete('/api/channel-messages/:id', authenticate, (request, response) => {
  const message = db.prepare('SELECT channel_messages.*, channels.community_id FROM channel_messages JOIN channels ON channels.id = channel_messages.channel_id WHERE channel_messages.id = ?').get(request.params.id);
  if (!message) return response.status(404).json({ error: 'Message was not found.' });
  const isModeratorAction = communityModerator(message.community_id, request.user);
  if (message.author_id !== request.user.id && !isModeratorAction) return response.status(403).json({ error: 'Only the author or a moderator can remove this message.' });
  db.prepare('DELETE FROM channel_messages WHERE id = ?').run(message.id);
  if (isModeratorAction) communityAudit(message.community_id, request.user.id, 'message_removed', { messageId: message.id, channelId: message.channel_id, authorId: message.author_id });
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
  const channelId = request.query.channelId ? Number(request.query.channelId) : null;
  if (channelId) {
    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    if (!channel || channel.display_mode !== 'gallery' || !communityMembership(channel.community_id, request.user.id)) return response.status(404).json({ error: 'Media channel was not found.' });
  }
  const items = db.prepare(`SELECT content_items.*, users.display_name AS performer_name FROM content_items JOIN users ON users.id = content_items.performer_id WHERE published_at IS NOT NULL AND (? IS NULL OR content_items.channel_id = ?) ORDER BY published_at DESC`).all(channelId, channelId)
    .map(item => ({ ...item, hasAccess: hasContentAccess(request.user.id, item), mediaUrl: item.media_path && hasContentAccess(request.user.id, item) ? `/api/media/${item.id}` : null }));
  response.json({ items });
});

app.post('/api/content', authenticate, (request, response) => {
  const { title, summary = '', kind, accessType, channelId } = request.body || {};
  const validKinds = ['sfw_photo', 'nsfw_photo', 'video', 'live_event'];
  const validAccessTypes = ['free', 'subscriber', 'purchase'];
  if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 120) return response.status(400).json({ error: 'Title must be 2 to 120 characters.' });
  if (!validKinds.includes(kind) || !validAccessTypes.includes(accessType)) return response.status(400).json({ error: 'Choose a valid content type and access type.' });
  const mediaChannelId = channelId ? Number(channelId) : null;
  if (mediaChannelId) {
    const mediaChannel = db.prepare('SELECT * FROM channels WHERE id = ?').get(mediaChannelId);
    if (!mediaChannel || mediaChannel.display_mode !== 'gallery' || !communityCreator(mediaChannel.community_id, request.user)) return response.status(403).json({ error: 'Only community creators, moderators, or administrators can upload to this media channel.' });
  } else if (!['performer', 'admin'].includes(request.user.role)) {
    return response.status(403).json({ error: 'Only performers or administrators can create media outside a community gallery.' });
  }
  const result = db.prepare('INSERT INTO content_items (performer_id, channel_id, title, summary, kind, access_type, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(request.user.id, mediaChannelId, title.trim(), String(summary).trim(), kind, accessType, new Date().toISOString());
  response.status(201).json({ item: db.prepare('SELECT * FROM content_items WHERE id = ?').get(result.lastInsertRowid) });
});

app.post('/api/content/:id/media', authenticate, upload.single('media'), (request, response) => {
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(request.params.id);
  if (!item) return response.status(404).json({ error: 'Content item was not found.' });
  if (request.user.role !== 'admin' && item.performer_id !== request.user.id) return response.status(403).json({ error: 'Only the creator who made this item can upload media.' });
  if (!request.file) return response.status(400).json({ error: 'Select a supported image or video file.' });
  if (item.media_path) fs.rmSync(path.join(mediaDirectory, item.media_path), { force: true });
  db.prepare('UPDATE content_items SET media_path = ?, media_mime_type = ? WHERE id = ?').run(request.file.filename, request.file.mimetype, item.id);
  if (item.channel_id) {
    const mediaChannel = db.prepare('SELECT community_id FROM channels WHERE id = ?').get(item.channel_id);
    if (mediaChannel) communityAudit(mediaChannel.community_id, request.user.id, 'media_uploaded', { contentId: item.id, title: item.title, channelId: item.channel_id, mimeType: request.file.mimetype });
  }
  response.status(201).json({ itemId: item.id, uploaded: true });
});

app.delete('/api/content/:id', authenticate, (request, response) => {
  const item = db.prepare('SELECT * FROM content_items WHERE id = ?').get(request.params.id);
  if (!item) return response.status(404).json({ error: 'Media item was not found.' });
  if (request.user.role !== 'admin' && item.performer_id !== request.user.id) return response.status(403).json({ error: 'Only the performer who created this media can delete it.' });
  db.transaction(() => {
    db.prepare('DELETE FROM entitlements WHERE content_id = ?').run(item.id);
    db.prepare('DELETE FROM content_items WHERE id = ?').run(item.id);
    if (item.channel_id) {
      const mediaChannel = db.prepare('SELECT community_id FROM channels WHERE id = ?').get(item.channel_id);
      if (mediaChannel) communityAudit(mediaChannel.community_id, request.user.id, 'media_deleted', { contentId: item.id, title: item.title, channelId: item.channel_id });
    }
  })();
  if (item.media_path) fs.rmSync(path.join(mediaDirectory, item.media_path), { force: true });
  response.sendStatus(204);
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
