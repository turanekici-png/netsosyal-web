const { Pool } = require('pg')
require('dotenv').config()

// Kullanici istegi: Dosya Yonetimi > Belgeler ekraninda ONCEDEN eklenmis bir
// belgenin Aciklama alani duzenlenip yeniden kaydedilirken
// "value too long for type character varying(255)" hatasi aliniyordu.
// "belge" tablosu (sosyalyardimdkm veritabani - eski masaustu uygulamadan
// kalma) su daraltilmis kolonlarla olusturulmus:
//   baslik  character varying(100)
//   icerik  character varying(255)   <- Aciklama alani burada tutuluyor
// Aciklama'ya 255 karakterden uzun metin girilince UPDATE patliyordu.
// Bu betik ilgili kolonlari TEXT'e genisletir (veri kaybi YOK - varchar->text
// donusumu Postgres'te tablo taramasi gerektirmez, aninda calisir).
//
// gelir/arac_modeli/tapu_bilgisi/vergi_mukellefiyeti kolonlari da buraya dahil:
// ensure-belge-extra-columns.js bunlari "text" olarak eklemeyi amacliyor ama bu
// veritabaninda daraltilmis varchar olarak var - ayni "value too long" hatasini
// (farkli sinirlarla) verebilirler, bu yuzden onlar da text'e cekiliyor.
const COLUMNS_TO_WIDEN = [
  'baslik',
  'icerik',
  'gelir',
  'arac_modeli',
  'tapu_bilgisi',
  'vergi_mukellefiyeti',
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
      `SELECT column_name, data_type, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'belge'
         AND column_name = ANY($1)`,
      [COLUMNS_TO_WIDEN],
    )
    const byName = new Map(rows.map((row) => [row.column_name, row]))

    for (const name of COLUMNS_TO_WIDEN) {
      const info = byName.get(name)
      if (!info) {
        console.log(`Kolon bulunamadi, atlaniyor: ${name}`)
        continue
      }
      if (info.data_type === 'text') {
        console.log(`Kolon zaten text: ${name}`)
        continue
      }
      await pool.query(`ALTER TABLE public.belge ALTER COLUMN ${name} TYPE text`)
      console.log(`Kolon genisletildi: ${name} (${info.data_type}(${info.character_maximum_length}) -> text)`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
