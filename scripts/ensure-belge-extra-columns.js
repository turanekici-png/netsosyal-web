const { Pool } = require('pg')
require('dotenv').config()

// Kullanici istegi: Dosya Yonetimi > Belgeler ekraninda belge kaydedilirken
// "column gelir does not exist" hatasi aliniyordu - "belge" tablosuna
// (sosyalyardimdkm veritabani) sonradan eklenmesi gereken kolonlar bu
// ortamin veritabaninda hic olusturulmamis. Bu kolonlar OPSIYONELDIR
// (bos birakilirsa NULL kaydedilir); Nakit Yardimi Otomatik Red kontrolu
// bunlari kullanir ama dolu degilse dikkate almaz.
const REQUIRED_COLUMNS = [
  ['gelir', 'text'],
  ['arac_modeli', 'text'],
  ['tapu_bilgisi', 'text'],
  ['vergi_mukellefiyeti', 'text'],
]

function getDkmConnectionString() {
  if (process.env.SOSYALYARDIMDKM_DATABASE_URL) {
    return process.env.SOSYALYARDIMDKM_DATABASE_URL
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL tanimli degil.')
  }
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = '/sosyalyardimdkm'
  return url.toString()
}

async function main() {
  const pool = new Pool({ connectionString: getDkmConnectionString() })
  try {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'belge'`
    )
    const existing = new Set(rows.map((row) => row.column_name))

    for (const [name, type] of REQUIRED_COLUMNS) {
      if (existing.has(name)) {
        console.log(`Kolon zaten var: ${name}`)
        continue
      }
      await pool.query(`ALTER TABLE public.belge ADD COLUMN ${name} ${type}`)
      console.log(`Kolon eklendi: ${name} ${type}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
