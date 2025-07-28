const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const db = require('./database.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Middleware
app.use(session({
    store: new SQLiteStore({ db: 'site.db', dir: './' }),
    secret: 'a-very-strong-secret-key-change-it',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// --- Helper Functions for Permissions ---

const isAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    res.status(401).redirect('/login.html');
};

const isSuperAdmin = (req) => req.session.user && req.session.user.id === 1;

// تابع دسترسی جدید: مالکیت دیگر معنی ندارد و همه چیز با جدول دسترسی‌ها چک می‌شود
const hasPermission = (roomId, userId) => {
    if (userId === 1) return true; // ادمین اصلی همیشه دسترسی دارد
    const permission = db.prepare('SELECT 1 FROM room_permissions WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    return !!permission;
};


// --- AUTHENTICATION ROUTES (بدون تغییر) ---
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (user && bcrypt.compareSync(password, user.password_hash)) {
        req.session.user = { id: user.id, username: user.username };
        res.redirect('/admin.html');
    } else {
        res.status(401).send('نام کاربری یا رمز عبور اشتباه است. <a href="/login.html">دوباره تلاش کنید</a>');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login.html'));
});


// --- PROTECTED API ROUTES (تغییرات اساسی) ---

app.get('/api/admin/data', isAuthenticated, (req, res) => {
    const currentUserId = req.session.user.id;
    let rooms;
    let users = [];

    if (isSuperAdmin(req)) {
        rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all();
        users = db.prepare('SELECT id, username FROM users WHERE id != 1').all();
    } else {
        // کاربران عادی فقط اتاق‌هایی را می‌بینند که در جدول دسترسی‌ها هستند
        const query = `SELECT r.* FROM rooms r JOIN room_permissions p ON r.id = p.room_id WHERE p.user_id = @userId ORDER BY name`;
        rooms = db.prepare(query).all({ userId: currentUserId });
    }

    const roomsWithData = rooms.map(room => ({
        ...room,
        links: db.prepare('SELECT * FROM links WHERE room_id = ? ORDER BY id').all(room.id),
        permittedUsers: db.prepare('SELECT user_id FROM room_permissions WHERE room_id = ?').all(room.id).map(p => p.user_id)
    }));

    res.json({ rooms: roomsWithData, users, currentUserId, isSuperAdmin: isSuperAdmin(req) });
});


// ساخت اتاق جدید با تراکنش و دسترسی خودکار
const createRoomWithPermission = db.transaction((name, userId) => {
    const roomStmt = db.prepare('INSERT INTO rooms (name, user_id) VALUES (?, ?)');
    const info = roomStmt.run(name, userId);
    const newRoomId = info.lastInsertRowid;

    const permStmt = db.prepare('INSERT INTO room_permissions (user_id, room_id) VALUES (?, ?)');
    permStmt.run(userId, newRoomId);
    
    return { id: newRoomId, name, user_id: userId, links: [], permittedUsers: [userId] };
});

app.post('/api/rooms', isAuthenticated, (req, res) => {
    try {
        const newRoom = createRoomWithPermission(req.body.name.toLowerCase(), req.session.user.id);
        
        // ارسال پیام ریل-تایم به ادمین اصلی
        io.to('admin-1').emit('room_added', newRoom);
        if (req.session.user.id !== 1) {
            // اگر سازنده ادمین اصلی نبود، به خودش هم پیام بده (برای هماهنگی تب‌ها)
            io.to(`admin-${req.session.user.id}`).emit('room_added', newRoom);
        }
        
        res.status(201).json(newRoom);
    } catch (err) {
        console.error("Error creating room:", err);
        res.status(400).json({ error: 'نام اتاق تکراری است یا خطای دیگری رخ داده.' });
    }
});

// قابلیت جدید: حذف اتاق
app.delete('/api/rooms/:id', isAuthenticated, (req, res) => {
    const roomId = parseInt(req.params.id, 10);
    const userId = req.session.user.id;

    if (!hasPermission(roomId, userId)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    // قبل از حذف، لیست تمام کاربران دارای دسترسی را پیدا کن
    const permittedUsers = db.prepare('SELECT user_id FROM room_permissions WHERE room_id = ?').all(roomId);

    // حذف اتاق (که لینک‌ها و دسترسی‌ها را هم به صورت آبشاری حذف می‌کند)
    const info = db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    
    if (info.changes > 0) {
        // به تمام کاربران مرتبط پیام بده که اتاق حذف شده
        permittedUsers.forEach(user => {
            io.to(`admin-${user.user_id}`).emit('room_deleted', { roomId });
        });
        res.status(200).json({ message: 'Room deleted successfully' });
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});


// دادن دسترسی (با قابلیت ریل-تایم)
app.post('/api/permissions', isAuthenticated, (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    
    const { userId, roomId } = req.body;
    try {
        db.prepare('INSERT INTO room_permissions (user_id, room_id) VALUES (?, ?)')
          .run(userId, roomId);
        
        // پیدا کردن اطلاعات کامل اتاق برای ارسال به کاربر
        const roomData = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
        if (roomData) {
            const fullRoomData = {
                ...roomData,
                links: db.prepare('SELECT * FROM links WHERE room_id = ?').all(roomId),
                permittedUsers: db.prepare('SELECT user_id FROM room_permissions WHERE room_id = ?').all(roomId).map(p => p.user_id)
            };
            io.to(`admin-${userId}`).emit('room_added', fullRoomData);
        }
        
        res.status(201).json({ message: 'Permission granted' });
    } catch (err) {
        res.status(200).json({ message: 'Permission likely already exists' });
    }
});

// گرفتن دسترسی (با قابلیت ریل-تایم)
app.delete('/api/permissions', isAuthenticated, (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    
    const { userId, roomId } = req.body;
    db.prepare('DELETE FROM room_permissions WHERE user_id = ? AND room_id = ?')
      .run(userId, roomId);
    
    io.to(`admin-${userId}`).emit('room_deleted', { roomId });
    
    res.status(200).json({ message: 'Permission revoked' });
});

// تمام API های مربوط به لینک‌ها حالا از hasPermission جدید استفاده می‌کنند و صحیح کار می‌کنند
app.post('/api/links', isAuthenticated, (req, res) => {
    const { roomId, url } = req.body;
    if (!hasPermission(roomId, req.session.user.id)) return res.status(403).json({ error: 'Forbidden' });
    // ... بقیه کد
    const stmt = db.prepare('INSERT INTO links (room_id, url) VALUES (?, ?)');
    const info = stmt.run(roomId, url);
    const newLink = db.prepare('SELECT * FROM links WHERE id = ?').get(info.lastInsertRowid);
    const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId);
    io.to(room.name).emit('link_added', newLink);
    res.status(201).json(newLink);
});

app.put('/api/links/:id', isAuthenticated, (req, res) => {
    const link = db.prepare('SELECT room_id FROM links WHERE id = ?').get(req.params.id);
    if (!link || !hasPermission(link.room_id, req.session.user.id)) return res.status(403).json({ error: 'Forbidden' });
    // ... بقیه کد
    const { url, status } = req.body;
    if (url) db.prepare('UPDATE links SET url = ? WHERE id = ?').run(url, req.params.id);
    if (status) db.prepare('UPDATE links SET status = ? WHERE id = ?').run(status, req.params.id);
    const updatedLink = db.prepare('SELECT l.*, r.name as room_name FROM links l JOIN rooms r ON l.room_id = r.id WHERE l.id = ?').get(req.params.id);
    io.to(updatedLink.room_name).emit('link_updated', updatedLink);
    res.json(updatedLink);
});

app.delete('/api/links/:id', isAuthenticated, (req, res) => {
    const link = db.prepare('SELECT room_id, name as room_name FROM links JOIN rooms ON rooms.id = links.room_id WHERE links.id = ?').get(req.params.id);
    if (!link || !hasPermission(link.room_id, req.session.user.id)) return res.status(403).json({ error: 'Forbidden' });
    // ... بقیه کد
    db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
    io.to(link.room_name).emit('link_deleted', { id: parseInt(req.params.id) });
    res.status(200).json({ message: 'Link deleted' });
});


// --- PUBLIC ROUTES (بدون تغییر) ---
app.get('/api/rooms/:roomName/links', (req, res) => {
    const links = db.prepare(`SELECT l.* FROM links l JOIN rooms r ON l.room_id = r.id WHERE r.name = ? ORDER BY id`).all(req.params.roomName.toLowerCase());
    res.json(links);
});

app.get('/:roomName', (req, res) => {
    const roomName = req.params.roomName.toLowerCase();
    if (['admin', 'login'].includes(roomName.replace('.html', ''))) return res.redirect('/admin.html');
    const room = db.prepare('SELECT * FROM rooms WHERE name = ?').get(roomName);
    if (room) {
        res.sendFile(path.join(__dirname, 'public', 'room.html'));
    } else {
        res.status(404).send('404: Room Not Found');
    }
});


// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    // اتصال کاربر به روم عمومی
    socket.on('join_room', (roomName) => socket.join(roomName));
    
    // اتصال ادمین به روم شخصی خودش
    socket.on('admin_join', (userId) => socket.join(`admin-${userId}`));
});


// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`🚀 Server is running at http://localhost:${PORT}`);
    console.log(`🔐 Admin login is at http://localhost:${PORT}/login.html`);
});