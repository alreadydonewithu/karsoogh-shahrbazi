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
    secret: 'a-very-strong-secret-key-change-it', // این کلید را حتما عوض کنید
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week
}));

// Middleware to protect admin routes
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    res.status(401).redirect('/login.html');
};

// --- AUTHENTICATION ROUTES ---
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
    req.session.destroy(err => {
        if (err) return res.status(500).send('Could not log out.');
        res.redirect('/login.html');
    });
});

// --- PROTECTED API ROUTES ---
app.get('/api/admin/data', isAuthenticated, (req, res) => {
    const rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all();
    const roomsWithLinks = rooms.map(room => {
        const links = db.prepare('SELECT * FROM links WHERE room_id = ? ORDER BY id').all(room.id);
        return { ...room, links };
    });
    res.json(roomsWithLinks);
});

app.post('/api/rooms', isAuthenticated, (req, res) => {
    try {
        const { name } = req.body;
        const stmt = db.prepare('INSERT INTO rooms (name) VALUES (?)');
        const info = stmt.run(name.toLowerCase());
        res.status(201).json({ id: info.lastInsertRowid, name, links: [] });
    } catch (err) {
        res.status(400).json({ error: 'نام اتاق تکراری است.' });
    }
});

app.post('/api/links', isAuthenticated, (req, res) => {
    const { roomId, url } = req.body;
    const stmt = db.prepare('INSERT INTO links (room_id, url) VALUES (?, ?)');
    const info = stmt.run(roomId, url);
    const newLink = db.prepare('SELECT * FROM links WHERE id = ?').get(info.lastInsertRowid);
    
    const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId);
    io.to(room.name).emit('link_added', newLink);
    
    res.status(201).json(newLink);
});

app.put('/api/links/:id', isAuthenticated, (req, res) => {
    const { url, status } = req.body;
    const { id } = req.params;
    if (url) db.prepare('UPDATE links SET url = ? WHERE id = ?').run(url, id);
    if (status) db.prepare('UPDATE links SET status = ? WHERE id = ?').run(status, id);

    const updatedLink = db.prepare('SELECT l.*, r.name as room_name FROM links l JOIN rooms r ON l.room_id = r.id WHERE l.id = ?').get(id);
    io.to(updatedLink.room_name).emit('link_updated', updatedLink);
    res.json(updatedLink);
});

app.delete('/api/links/:id', isAuthenticated, (req, res) => {
    const { id } = req.params;
    const link = db.prepare('SELECT l.*, r.name as room_name FROM links l JOIN rooms r ON l.room_id = r.id WHERE l.id = ?').get(id);
    if (link) {
        db.prepare('DELETE FROM links WHERE id = ?').run(id);
        io.to(link.room_name).emit('link_deleted', { id: parseInt(id) });
        res.status(200).json({ message: 'Link deleted' });
    } else {
        res.status(404).json({ error: 'Link not found' });
    }
});

// --- PUBLIC ROUTES ---
app.get('/api/rooms/:roomName/links', (req, res) => {
    const links = db.prepare(`SELECT l.* FROM links l JOIN rooms r ON l.room_id = r.id WHERE r.name = ? ORDER BY id`).all(req.params.roomName.toLowerCase());
    res.json(links);
});

app.get('/:roomName', (req, res) => {
    const roomName = req.params.roomName.toLowerCase();
    // Prevent admin pages from being treated as rooms
    if (['admin', 'login'].includes(roomName.replace('.html', ''))) {
        return res.redirect('/admin.html');
    }
    const room = db.prepare('SELECT * FROM rooms WHERE name = ?').get(roomName);
    if (room) {
        res.sendFile(path.join(__dirname, 'public', 'room.html'));
    } else {
        res.status(404).send('404: Room Not Found');
    }
});

// --- SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_room', (roomName) => {
        socket.join(roomName);
    });
});

// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`🚀 Server is running at http://localhost:${PORT}`);
    console.log(`🔐 Admin login is at http://localhost:${PORT}/login.html`);
});