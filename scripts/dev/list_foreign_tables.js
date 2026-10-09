const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const res = await pool.query("SELECT foreign_table_name FROM information_schema.foreign_tables");
  console.log(res.rows.map(r => r.foreign_table_name).join('\n'));
  process.exit(0);
}

check();
