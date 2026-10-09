const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const res = await pool.query("SELECT * FROM ayarlar");
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}

check();
