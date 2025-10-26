console.log("📡 DATABASE_URL =", process.env.DATABASE_URL);

// db.js
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // ✅ NeonはSSL必須
  },
});

pool.connect()
  .then(() => console.log("✅ Connected to Neon PostgreSQL"))
  .catch(err => console.error("❌ Database connection error:", err));

module.exports = pool;
