const db = require('./database.js');
const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const saltRounds = 10;

rl.question('Enter admin username: ', (username) => {
  rl.question('Enter admin password: ', async (password) => {
    try {
      const hash = await bcrypt.hash(password, saltRounds);
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      stmt.run(username, hash);
      console.log(`✅ Admin user '${username}' created successfully!`);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        console.error(`❌ Error: Username '${username}' already exists.`);
      } else {
        console.error('❌ Error creating admin user:', err.message);
      }
    } finally {
      rl.close();
      db.close();
    }
  });
});