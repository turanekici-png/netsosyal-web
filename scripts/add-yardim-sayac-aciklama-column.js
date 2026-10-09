// Kullanici istegi (Ekim 2026): "giyim yardimi gonderirken o yardim icin
// girilmis aciklama bilgisini de yardim_sayac tablosuna kaydedelim" - bu
// tek-seferlik script, yeni "aciklama" kolonunu CANLI veritabanina ekler
// (psql.exe bu sunucuda calismiyor, bkz. memory "db-url-use-localhost" /
// PG16 psql.exe 0-byte/broken - bu yuzden dogrudan `pg` ile baglanilir).
require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  await pool.query(`ALTER TABLE public.yardim_sayac ADD COLUMN IF NOT EXISTS aciklama varchar(500);`)
  await pool.query(`COMMENT ON COLUMN public.yardim_sayac.aciklama IS 'Yardim icin girilmis aciklama (orn. Giyim yardiminin muracaat/yardim aciklamasi)';`)
  console.log('TAMAMLANDI: yardim_sayac.aciklama kolonu eklendi (veya zaten vardi).')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
