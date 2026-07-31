require('dotenv').config();
const mysql = require('mysql2/promise');

// Create the connection pool. The pool-specific settings are the defaults.
// Connection probe is deferred so importing modules (unit smoke) does not open sockets.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'takcakap',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

let probeStarted = false;
function probeConnectionOnce() {
  if (probeStarted) return;
  probeStarted = true;
  pool.getConnection()
    .then((conn) => {
      console.log('✅ Successfully connected to MariaDB/MySQL database!');
      conn.release();
    })
    .catch((err) => {
      console.error('❌ Database Connection Failed:', err.message);
      console.error('   Please check your .env configuration.');
    });
}

// Keep pool as default export for existing callers; attach optional probe for startServer.
pool.probeConnectionOnce = probeConnectionOnce;

module.exports = pool;
