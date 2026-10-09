const { Client } = require('pg');
require('dotenv').config();

async function checkLegacyDesigns() {
  const client = new Client({
connectionString: process.env.SOSYALYARDIMDKM_DATABASE_URL,
  });

  try {
    await client.connect();
    
    // Check table structure
    const schemaQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'dizayn';
    `;
    const schemaRes = await client.query(schemaQuery);
    console.log("--- dizayn Table Schema ---");
    console.table(schemaRes.rows);

    // Get a few sample rows
    const dataQuery = `SELECT * FROM dizayn LIMIT 3;`;
    const dataRes = await client.query(dataQuery);
    console.log("\n--- Sample dizayn Records ---");
    console.log(JSON.stringify(dataRes.rows, null, 2));

  } catch (error) {
    console.error("Database connection or query error:", error);
  } finally {
    await client.end();
  }
}

checkLegacyDesigns();
