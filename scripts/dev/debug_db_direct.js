const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  const tables = ['yrd_ekmek', 'yrd_gidabankasi', 'yrd_haziryemek', 'yrd_destekpaketi'];
  
  for (const table of tables) {
    const res = await client.query(`SELECT durumu, COUNT(*) FROM ${table} GROUP BY durumu`);
    console.log(`--- ${table} Durum Dağılımı ---`);
    console.table(res.rows);
    
    const sample = await client.query(`SELECT dosyaid, muracaateden FROM ${table} WHERE durumu = 2 LIMIT 1`);
    console.log(`${table} Durumu 2 olan Örnek:`, sample.rows[0]);
    console.log('\n');
  }

  await client.end();
}

main().catch(console.error);
