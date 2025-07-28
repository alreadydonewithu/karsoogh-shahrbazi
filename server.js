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

const hasPermission = (roomId, userId) => {
    if (userId === 1) return true;
    const permission = db.prepare('SELECT 1 FROM room_permissions WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    return !!permission;
};

// Helper to get all users with permission to a room
const getPermittedUsers = (roomId) => {
    return db.prepare('SELECT user_id FROM room_permissions WHERE room_id = ?').all(roomId);
};

// Helper to get full room data for broadcasting
const getFullRoomData = (roomId) => {
    const roomData = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    if (!roomData) return null;
    return {
        ...roomData,
        links: db.prepare('SELECT * FROM links WHERE room_id = ? ORDER BY id').all(roomId),
        permittedUsers: getPermittedUsers(roomId).map(p => p.user_id)
    };
};

// --- AUTHENTICATION ROUTES ---
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (user && bcrypt.compareSync(password, user.password_hash)) {
        req.session.user = { id: user.id, username: user.username };
        res.redirect('/admin.html');
    } else {
        res.status(401).send('نام کاربری یا رمز عبور اشتباه است.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login.html'));
});

// --- PROTECTED API ROUTES ---
app.get('/api/admin/data', isAuthenticated, (req, res) => {
    const currentUserId = req.session.user.id;
    let rooms;
    let users = [];
    if (isSuperAdmin(req)) {
        rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all();
        users = db.prepare('SELECT id, username FROM users WHERE id != 1').all();
    } else {
        const query = `SELECT r.* FROM rooms r JOIN room_permissions p ON r.id = p.room_id WHERE p.user_id = @userId ORDER BY name`;
        rooms = db.prepare(query).all({ userId: currentUserId });
    }
    const roomsWithData = rooms.map(room => getFullRoomData(room.id));
    res.json({ rooms: roomsWithData, users, currentUserId, isSuperAdmin: isSuperAdmin(req) });
});

const createRoomWithPermission = db.transaction((name, userId) => {
    const roomStmt = db.prepare('INSERT INTO rooms (name, user_id) VALUES (?, ?)');
    const info = roomStmt.run(name, userId);
    const newRoomId = info.lastInsertRowid;
    const permStmt = db.prepare('INSERT INTO room_permissions (user_id, room_id) VALUES (?, ?)');
    permStmt.run(userId, newRoomId);
    return getFullRoomData(newRoomId);
});

app.post('/api/rooms', isAuthenticated, (req, res) => {
    try {
        const newRoom = createRoomWithPermission(req.body.name.toLowerCase(), req.session.user.id);
        io.to('admin-1').emit('room_updated', newRoom);
        if (req.session.user.id !== 1) {
            io.to(`admin-${req.session.user.id}`).emit('room_updated', newRoom);
        }
        res.status(201).json(newRoom);
    } catch (err) {
        res.status(400).json({ error: 'نام اتاق تکراری است.' });
    }
});

app.delete('/api/rooms/:id', isAuthenticated, (req, res) => {
    const roomId = parseInt(req.params.id, 10);
    if (!hasPermission(roomId, req.session.user.id)) return res.status(403).json({ error: 'Forbidden' });
    
    const permittedUsers = getPermittedUsers(roomId);
    const info = db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);

    if (info.changes > 0) {
        permittedUsers.forEach(user => {
            io.to(`admin-${user.user_id}`).emit('room_deleted', { roomId });
        });
        res.status(200).json({ message: 'Room deleted' });
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

app.post('/api/permissions', isAuthenticated, (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { userId, roomId } = req.body;
    try {
        db.prepare('INSERT OR IGNORE INTO room_permissions (user_id, room_id) VALUES (?, ?)').run(userId, roomId);
        const updatedRoom = getFullRoomData(roomId);
        getPermittedUsers(roomId).forEach(user => {
            io.to(`admin-${user.user_id}`).emit('room_updated', updatedRoom);
        });
        res.status(201).json({ message: 'Permission granted' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/permissions', isAuthenticated, (req, res) => {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { userId, roomId } = req.body;
    
    const permittedUsers = getPermittedUsers(roomId);
    db.prepare('DELETE FROM room_permissions WHERE user_id = ? AND room_id = ?').run(userId, roomId);
    
    io.to(`admin-${userId}`).emit('room_deleted', { roomId });
    const updatedRoom = getFullRoomData(roomId);
    if (updatedRoom) {
        permittedUsers.filter(u => u.user_id != userId).forEach(user => {
            io.to(`admin-${user.user_id}`).emit('room_updated', updatedRoom);
        });
    }
    res.status(200).json({ message: 'Permission revoked' });
});

app.post('/api/links', isAuthenticated, (req, res) => {
    const { roomId, url } = req.body;
    if (!hasPermission(roomId, req.session.user.id)) return res.status(403).json({ error: 'Forbidden' });
    
    const stmt = db.prepare('INSERT INTO links (room_id, url) VALUES (?, ?)');
    stmt.run(roomId, url);

    const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId);
    io.to(room.name).emit('link_added', db.prepare('SELECT * FROM links WHERE room_id = ? ORDER BY id DESC LIMIT 1').get(roomId));
    
    const updatedRoom = getFullRoomData(roomId);
    getPermittedUsers(roomId).forEach(user => {
        io.to(`admin-${user.user_id}`).emit('room_updated', updatedRoom);
    });
    
    res.status(201).json(updatedRoom.links.slice(-1)[0]);
});

app.delete('/api/links/:id', isAuthenticated, (req, res) => {
    const linkId = parseInt(req.params.id);
    const link = db.prepare('SELECT room_id FROM links WHERE id = ?').get(linkId);
    if (!link || !hasPermission(link.room_id, req.session.user.id)) return res.status(403).json({ error: 'Forbidden' });
    
    const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(link.room_id);
    db.prepare('DELETE FROM links WHERE id = ?').run(linkId);
    
    io.to(room.name).emit('link_deleted', { id: linkId });

    const updatedRoom = getFullRoomData(link.room_id);
    getPermittedUsers(link.room_id).forEach(user => {
        io.to(`admin-${user.user_id}`).emit('room_updated', updatedRoom);
    });

    res.status(200).json({ message: 'Link deleted' });
});

app.put('/api/links/:id', isAuthenticated, (req, res) => {
    const linkId = parseInt(req.params.id);
    const link = db.prepare('SELECT room_id FROM links WHERE id = ?').get(linkId);
    if (!link || !hasPermission(link.room_id, req.session.user.id)) return res.status(403).json({ error: 'Forbidden' });

    const { url, status } = req.body;
    if (url) db.prepare('UPDATE links SET url = ? WHERE id = ?').run(url, linkId);
    if (status) db.prepare('UPDATE links SET status = ? WHERE id = ?').run(status, linkId);

    const updatedLink = db.prepare('SELECT l.*, r.name as room_name FROM links l JOIN rooms r ON l.room_id = r.id WHERE l.id = ?').get(linkId);
    io.to(updatedLink.room_name).emit('link_updated', updatedLink);

    const updatedRoom = getFullRoomData(link.room_id);
    getPermittedUsers(link.room_id).forEach(user => {
        io.to(`admin-${user.user_id}`).emit('room_updated', updatedRoom);
    });
    
    res.json(updatedLink);
});

// --- PUBLIC ROUTES ---
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
    socket.on('join_room', (roomName) => socket.join(roomName));
    socket.on('admin_join', (userId) => socket.join(`admin-${userId}`));
});

// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`🚀 Server is running at http://localhost:${PORT}`);
    console.log(`🔐 Admin login is at http://localhost:${PORT}/login.html`);
});