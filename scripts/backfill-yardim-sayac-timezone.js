// Kullanici istegi (14 Eylul 2026): "yardim_sayac... gercek Turkiye
// saatinden 3 saat geride kaydediliyor - kalici duzelt".
//
// BU SCRIPT SADECE BIR KEZ, YENI KOD (app/api/documents/yardim-sayac/route.ts
// + app/(modules)/reports/yardim-sayac/page.tsx, bkz. lib/db/naiveIstanbulTime.ts)
// CANLIYA DEPLOY EDILIP SERVIS YENIDEN BASLATILDIKTAN HEMEN SONRA calistirilmalidir.
//
// NEDEN BU SIRA ONEMLI: Yeni kod devreye girmeden ONCE calistirilirsa, o ana
// kadar gelen YENI kayitlar da (hala eski/UTC yaziyor) +3 saat kaydirilip
// BOZULUR. Yeni kod devreye girdikten SONRA calistirilirsa, sadece ESKI
// (UTC olarak yazilmis) kayitlar +3 saat kaydirilir, YENI kayitlara (zaten
// dogru Istanbul duvar-saati ile yazilmislardir) DOKUNULMAZ - bu script bir
// "cutoff" (ID sinirlama) parametresi ILE calistirilmalidir.
//
// KULLANIM:
//   1) Deploy + servis restart YAPILDIKTAN SONRA, once bu sorguyla en son
//      "eski" (duzeltme ONCESI) kaydin id'sini belirleyin:
//        SELECT MAX(id) FROM yardim_sayac;  -- deploy ANINDAN hemen once
//      (Bu id'yi deploy'dan hemen ONCE, ayri bir sorguyla not edin.)
//   2) node scripts/backfill-yardim-sayac-timezone.js --max-id=<O_ID> --confirm
//
// GUVENLIK: --confirm verilmeden hicbir UPDATE calistirmaz (sadece "dry run"
// olarak neyin degisecegini listeler). --max-id verilmeden calismayi REDDEDER.

require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

function getArg(name) {
  const prefix = `--${name}=`
  const found = process.argv.find((a) => a.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

async function main() {
  const maxIdArg = getArg('max-id')
  const confirm = process.argv.includes('--confirm')

  if (!maxIdArg || !/^\d+$/.test(maxIdArg)) {
    console.error('HATA: --max-id=<id> parametresi zorunludur (deploy ANINDAN hemen once SELECT MAX(id) FROM yardim_sayac; ile alinan id).')
    console.error('Ornek: node scripts/backfill-yardim-sayac-timezone.js --max-id=105 --confirm')
    process.exit(1)
  }
  const maxId = BigInt(maxIdArg)

  const affected = await pool.query(
    `SELECT id, to_char(islem_tarihi, 'YYYY-MM-DD HH24:MI:SS') AS islem_tarihi_oncesi,
            to_char(islem_tarihi + INTERVAL '3 hours', 'YYYY-MM-DD HH24:MI:SS') AS islem_tarihi_sonrasi,
            yardim_turu, gonderen_kullanici
     FROM yardim_sayac
     WHERE id <= $1
     ORDER BY id;`,
    [maxId],
  )

  console.log(`Etkilenecek kayit sayisi: ${affected.rows.length} (id <= ${maxId})`)
  console.table(affected.rows)

  if (!confirm) {
    console.log('\n--confirm verilmedi, hicbir UPDATE calistirilmadi (dry run).')
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Once yedek: etkilenecek satirlarin TAMAMINI ayri bir tabloya kopyala
    // (geri alma icin).
    await client.query(`
      CREATE TABLE IF NOT EXISTS yardim_sayac_tz_backfill_backup_20260914 AS
      SELECT * FROM yardim_sayac WHERE false;
    `)
    await client.query(
      `INSERT INTO yardim_sayac_tz_backfill_backup_20260914 SELECT * FROM yardim_sayac WHERE id <= $1;`,
      [maxId],
    )

    const result = await client.query(
      `UPDATE yardim_sayac
       SET islem_tarihi = islem_tarihi + INTERVAL '3 hours',
           olusturma_tarihi = olusturma_tarihi + INTERVAL '3 hours'
       WHERE id <= $1;`,
      [maxId],
    )

    await client.query('COMMIT')
    console.log(`\nTAMAMLANDI: ${result.rowCount} satir +3 saat kaydirildi.`)
    console.log('Yedek tablo: yardim_sayac_tz_backfill_backup_20260914 (geri almak icin kullanilabilir).')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('HATA, geri alindi:', err)
    process.exit(1)
  } finally {
    client.release()
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
