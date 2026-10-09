const { Pool } = require('pg')
require('dotenv').config()

const REQUIRED_COLUMNS = [
  ['konum_enlem', 'double precision'],
  ['konum_boylam', 'double precision'],
  ['konum_kaynagi', 'character varying(40)'],
  ['konum_durumu', 'character varying(40)'],
  ['konum_guven', 'double precision'],
  ['konum_adres_hash', 'character varying(80)'],
  ['konum_hata', 'text'],
  ['konum_tarihi', 'timestamp(6) without time zone'],
]

const REQUIRED_INDEXES = [
  {
    name: 'ind_dosyalar_konum',
    sql: 'CREATE INDEX ind_dosyalar_konum ON public.dosyalar (konum_enlem, konum_boylam)',
  },
  {
    name: 'ind_dosyalar_konum_durumu',
    sql: 'CREATE INDEX ind_dosyalar_konum_durumu ON public.dosyalar (konum_durumu)',
  },
]

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL tanimli degil.')
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  try {
    const columnsResult = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'dosyalar'
      `
    )
    const existingColumns = new Set(columnsResult.rows.map((row) => row.column_name))

    for (const [columnName, columnType] of REQUIRED_COLUMNS) {
      if (!existingColumns.has(columnName)) {
        await pool.query(`ALTER TABLE public.dosyalar ADD COLUMN ${columnName} ${columnType}`)
        console.log(`Kolon eklendi: ${columnName}`)
      } else {
        console.log(`Kolon zaten var: ${columnName}`)
      }
    }

    const indexesResult = await pool.query(
      `
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'i'
        AND n.nspname = 'public'
        AND c.relname = ANY($1)
      `,
      [REQUIRED_INDEXES.map((index) => index.name)]
    )
    const existingIndexes = new Set(indexesResult.rows.map((row) => row.relname))

    for (const index of REQUIRED_INDEXES) {
      if (!existingIndexes.has(index.name)) {
        await pool.query(index.sql)
        console.log(`Indeks eklendi: ${index.name}`)
      } else {
        console.log(`Indeks zaten var: ${index.name}`)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
