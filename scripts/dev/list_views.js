const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const res = await pool.query("SELECT table_name FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name");
  console.log(res.rows.map(r => r.table_name).join('\n'));
  process.exit(0);
}

check();
