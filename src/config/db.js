/**
 * DATABASE CONNECTION POOL
 * ============================================================
 * Uses mysql2 connection pool for high concurrency.
 *
 * WHY POOL (not single connection)?
 *  - Single connection: 1 query at a time → crashes at 10+ users
 *  - Pool: 50 simultaneous DB connections → handles 1000+ users
 *  - Pool reuses connections → no overhead of creating new ones
 *
 * Settings tuned for 1000+ concurrent users on Hostinger VPS.
 * ============================================================
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASS     || '',
  database: process.env.DB_NAME     || 'anton_craftex',

  // ── Pool Size (tuned for 1000+ users) ──
  connectionLimit:  50,    // max 50 simultaneous DB connections
  queueLimit:       200,   // queue up to 200 waiting requests (don't drop them)
  waitForConnections: true, // wait if pool full instead of throwing error

  // ── Connection Health ──
  enableKeepAlive:       true,
  keepAliveInitialDelay: 0,

  // ── Encoding (Tamil Unicode support) ──
  charset: 'utf8mb4',

  // ── Timezone (IST) ──
  timezone: '+05:30',

  // ── Performance ──
  dateStrings: false,
  namedPlaceholders: false,
});

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL Pool connected (50 connections ready)');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL Pool connection failed:', err.message);
    console.error('   Check DB_HOST, DB_USER, DB_PASS in your .env file');
  });

module.exports = pool;
