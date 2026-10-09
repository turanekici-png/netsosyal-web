const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  try {
    const res1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'dosyalar'");
    console.log('--- dosyalar columns ---');
    console.log(res1.rows.map(r => r.column_name).join(', '));

    const res2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'sistem_hareket_log'");
    console.log('--- sistem_hareket_log columns ---');
    console.log(res2.rows.map(r => r.column_name).join(', '));
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
