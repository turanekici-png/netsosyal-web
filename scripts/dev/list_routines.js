const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const res = await pool.query("SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public'");
  console.log(res.rows.map(r => r.routine_name).join('\n'));
  process.exit(0);
}

check();
