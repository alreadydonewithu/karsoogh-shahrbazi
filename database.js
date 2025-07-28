const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'site.db'));

// فعال کردن حالت Write-Ahead Logging برای بهبود همزمانی و جلوگیری از قفل شدن
db.pragma('journal_mode = WAL');

// ساخت جداول در صورت عدم وجود
function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        );
    `);
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'available', -- available, filling, full
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        );
    `);
    console.log('Database initialized successfully.');
}

initDb();

module.exports = db;