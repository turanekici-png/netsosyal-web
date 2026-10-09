const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.query("SELECT yardim_turu, etiket FROM etiket_dizayn"))
  .then(res => { console.table(res.rows); client.end(); });
