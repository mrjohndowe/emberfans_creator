require('dotenv').config();

const path = require('node:path');
const Database = require('better-sqlite3');

const [email, role] = process.argv.slice(2);
const roles = ['viewer', 'performer', 'moderator', 'admin'];
if (!email || !roles.includes(role)) {
  console.error('Usage: node scripts/promote-user.js user@example.com performer|moderator|admin|viewer');
  process.exit(1);
}

const databasePath = path.resolve(process.env.EMBERFANS_DB_PATH || './data/emberfans.db');
const db = new Database(databasePath);
const result = db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, email.trim().toLowerCase());
if (result.changes !== 1) {
  console.error('No account was updated. Confirm that the user has registered first.');
  process.exit(1);
}
console.log(`Updated ${email} to ${role}.`);
