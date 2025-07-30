// database.js

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(__dirname, 'site.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

module.exports = db;