// database.js

const path = require('path');
const Database = require('better-sqlite3');

// ساخت مسیر مطلق به فایل دیتابیس برای جلوگیری از هرگونه ابهام
const dbPath = path.resolve(__dirname, 'site.db');

// ایجاد یک نمونه جدید از دیتابیس
const db = new Database(dbPath);

// فعال کردن حالت WAL برای عملکرد بهتر
db.pragma('journal_mode = WAL');

// صادر کردن نمونه دیتابیس برای استفاده در کل پروژه
module.exports = db;