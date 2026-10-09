const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const schemas = ['sosyalyardim', 'dkm'];
  for (const schema of schemas) {
    console.log(`--- Schema: ${schema} ---`);
    const res = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' ORDER BY table_name`);
    console.log(res.rows.map(r => r.table_name).join('\n'));
  }
  process.exit(0);
}

check();
