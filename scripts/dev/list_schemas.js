const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const res = await pool.query("SELECT schema_name FROM information_schema.schemata");
  console.log(res.rows.map(r => r.schema_name).join('\n'));
  process.exit(0);
}

check();
