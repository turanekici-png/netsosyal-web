// Kullanici istegi (Eylul 2026): "tum telefon numaralari 0 ile baslasin,
// aralarinda bosluk / ozel karakter olmasin - mevcut kayitlarda sorun varsa
// onlari da duzelt".
//
// Bu script, kayit ekranlarina uygulanan normalizasyonun (lib/phone.ts) AYNISINI
// mevcut veritabani kayitlarina tek seferlik uygular.
//
// Kullanim (proje kokunden):
//   node scripts/fix-phone-format.mjs            -> SADECE RAPOR (hicbir sey yazmaz)
//   node scripts/fix-phone-format.mjs --apply    -> gercek guncelleme
//
// Guvenli: sadece FORMATI degistirir (rakamlari korur, basa tek 0 koyar),
// zaten dogru formatta (^0\d+$) olan kayitlara DOKUNMAZ.

import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const CONN = process.env.DATABASE_URL || 'postgresql://postgres:11@localhost:5432/sosyalyardim'

// lib/phone.ts ile BIREBIR ayni mantik.
function normalizeTrPhone(raw) {
  let digits = String(raw ?? '').replace(/\D+/g, '')
  if (!digits) return ''
  if (digits.startsWith('0090')) digits = digits.slice(4)
  else if (digits.startsWith('90') && digits.length >= 12) digits = digits.slice(2)
  else digits = digits.replace(/^0+/, '')
  if (!digits) return ''
  return `0${digits}`
}

// (tablo, sutun) ciftleri - kullaniciya gorunen telefon alanlari.
const TARGETS = [
  ['bireyler', 'ceptel'],
  ['dosyalar', 'telefon'],
  ['yrd_ayninakti', 'ceptel'],
  ['yrd_ayninakti', 'mur_telefon'],
  ['yrd_aceze', 'ceptel'],
  ['yrd_aceze', 'mur_telefon'],
  ['yrd_ddgidadosyali', 'ceptel'],
  ['yrd_ddgidadosyali', 'mur_telefon'],
]

const client = new pg.Client({ connectionString: CONN })

async function columnExists(table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  )
  return rows.length > 0
}

async function run() {
  await client.connect()
  console.log(`\n=== Telefon formati duzeltme ${APPLY ? '(GERCEK GUNCELLEME)' : '(SADECE RAPOR)'} ===`)
  console.log(`DB: ${CONN.replace(/:[^:@/]*@/, ':***@')}\n`)

  let grandTotalChecked = 0
  let grandTotalToFix = 0

  for (const [table, column] of TARGETS) {
    if (!(await columnExists(table, column))) {
      console.log(`- ${table}.${column}: sutun yok, atlandi`)
      continue
    }

    const { rows } = await client.query(
      `SELECT id, ${column} AS val FROM ${table}
       WHERE ${column} IS NOT NULL AND ${column} <> '' AND ${column} !~ '^0[0-9]+$'`,
    )

    grandTotalChecked += rows.length
    const changes = []
    for (const row of rows) {
      const next = normalizeTrPhone(row.val)
      if (next && next !== row.val) changes.push({ id: row.id, from: row.val, to: next })
    }
    grandTotalToFix += changes.length

    console.log(`- ${table}.${column}: format disi ${rows.length} kayit, ${changes.length} tanesi duzeltilecek`)
    for (const c of changes.slice(0, 5)) {
      console.log(`    ${String(c.id).padEnd(10)} "${c.from}"  ->  "${c.to}"`)
    }
    if (changes.length > 5) console.log(`    ... (+${changes.length - 5} kayit daha)`)

    if (APPLY && changes.length > 0) {
      // Tek tek degil, tek sorguda (VALUES listesi) - hizli ve atomik.
      const valuesSql = changes.map((_, i) => `($${i * 2 + 1}::bigint, $${i * 2 + 2}::text)`).join(', ')
      const params = changes.flatMap((c) => [c.id, c.to])
      const res = await client.query(
        `UPDATE ${table} AS t SET ${column} = v.val
         FROM (VALUES ${valuesSql}) AS v(id, val)
         WHERE t.id = v.id`,
        params,
      )
      console.log(`    -> ${res.rowCount} kayit guncellendi`)
    }
  }

  console.log(`\n=== TOPLAM: format disi ${grandTotalChecked} kayit tarandi, ${grandTotalToFix} tanesi ${APPLY ? 'GUNCELLENDI' : 'duzeltilecek (--apply ile calistirin)'} ===\n`)
  await client.end()
}

run().catch((err) => {
  console.error('HATA:', err.message)
  process.exit(1)
})
