import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'

const TABLE_NAME = 'yrd_ayninakti'

type ImportRow = Record<string, unknown>

// yrd_ayninakti tablosunun kolonlari - otomatik/denetim alanlari (id,
// kullaniciid, ilkkullaniciid, islemtarihi, ilkislemtarihi) ve dosyaid
// disarida; dosyaid ELLE girilmiyor, "tckimlikno" alanindan otomatik
// cozumleniyor (asagidaki aciklamaya bakin). "durumu", "durumutarih",
// "tahkikatpers", "topbirey", "medenihal" de KASITLI OLARAK disarida -
// kullanici istegiyle sablondan cikarildi. "durumu" hicbir zaman
// gonderilmedigi icin her satir otomatik 0 (Yeni Müracaat) olarak kaydedilir.
const IMPORTABLE_COLUMNS = new Set([
  'muracaateden', 'muracaattarihi', 'muracaatnotu', 'miktar', 'asamanotu',
  'durumuaciklama', 'donem', 'tckimlikno', 'ceptel', 'asama', 'muracaatozelkod',
  'aylikgelir', 'iban', 'etiket', 'dogumtarihi', 'mulkiyetbilgisi', 'aracbilgisi',
  'asamaozelkod',
])

const INTEGER_COLUMNS = new Set(['miktar', 'aylikgelir'])
const DATE_COLUMNS = new Set(['muracaattarihi', 'dogumtarihi'])

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

// Excel'in tarih sistemi: seri 1 = 1 Ocak 1900; epoch 30 Aralik 1899'dur
// (Excel'in unlu "1900 artik yil" hatasini da ustune eklemis olur, ama bu
// hata sadece 1900 subat sonunda etkili oldugundan gunumuz tarihleri icin
// sorun cikarmaz).
function excelSerialToIsoDate(serial: number) {
  const epochMs = Date.UTC(1899, 11, 30)
  return new Date(epochMs + serial * 86400000).toISOString().slice(0, 10)
}

function normalizeDate(value: string) {
  const trMatch = value.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/)
  if (trMatch) return `${trMatch[3]}-${trMatch[2].padStart(2, '0')}-${trMatch[1].padStart(2, '0')}`

  // Excel hucresi "Tarih" bicimindeyse deger sayisal bir seri olarak gelir
  // (ör. 45936) - metin degil.
  if (/^\d{1,6}$/.test(value)) {
    const serial = Number(value)
    if (serial > 1 && serial < 60000) return excelSerialToIsoDate(serial)
  }

  return value
}

function cleanValue(key: string, value: unknown) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return null
  if (INTEGER_COLUMNS.has(key)) {
    const numeric = trimmed.replace(/[^\d-]/g, '')
    return numeric ? Number(numeric) : null
  }
  if (DATE_COLUMNS.has(key)) return normalizeDate(trimmed)
  return trimmed
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.create', page: '/assistance/nakit/muracaatlar' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as { rows?: ImportRow[] }
    const rows = Array.isArray(payload.rows) ? payload.rows : []

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Aktarılacak satır bulunamadı.' }, { status: 400 })
    }

    const pool = getSqlMonitorPool()

    const normalizedRows: ImportRow[] = []
    rows.forEach((row) => {
      const normalized: ImportRow = {}
      Object.entries(row).forEach(([key, value]) => {
        const cleanKey = key.trim().toLocaleLowerCase('tr-TR')
        if (!IMPORTABLE_COLUMNS.has(cleanKey)) return
        normalized[cleanKey] = cleanValue(cleanKey, value)
      })
      if (normalized.durumu === undefined || normalized.durumu === null) normalized.durumu = 0
      if (Object.keys(normalized).length > 0) normalizedRows.push(normalized)
    })

    if (normalizedRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dosyadaki başlıklar tablo kolonları ile eşleşmedi.' },
        { status: 400 },
      )
    }

    // dosyaid ELLE girilmiyor - kullanici dosya numarasini bilmeyebilir
    // (ozellikle yeni muracaatlarda). Bunun yerine: TC kimlik no, sistemde
    // ZATEN kayitli bir bireyin TC'siyle eslesirse (yani bu kisinin daha
    // once acilmis bir dosyasi varsa), o dosyaya otomatik baglaniyor.
    // Eslesme yoksa (yeni muracaatci) dosyaid bos kalir - dosya acildiktan
    // sonra manuel baglanabilir.
    const tcNumbers = Array.from(new Set(
      normalizedRows
        .map((row) => (typeof row.tckimlikno === 'string' ? row.tckimlikno.trim() : ''))
        .filter(Boolean),
    ))

    const dosyaIdByTc = new Map<string, string>()
    if (tcNumbers.length > 0) {
      const bireyRows = await pool.query<{ tckimlikno: string; dosyaid: string }>(
        `
          SELECT DISTINCT ON (tckimlikno) tckimlikno, dosyaid
          FROM public.bireyler
          WHERE tckimlikno = ANY($1::text[]) AND dosyaid IS NOT NULL
          ORDER BY tckimlikno, id DESC
        `,
        [tcNumbers],
      )
      bireyRows.rows.forEach((row) => dosyaIdByTc.set(row.tckimlikno, row.dosyaid))
    }

    let matchedFile = 0
    normalizedRows.forEach((row) => {
      const tc = typeof row.tckimlikno === 'string' ? row.tckimlikno.trim() : ''
      const dosyaId = tc ? dosyaIdByTc.get(tc) : undefined
      if (dosyaId) {
        row.dosyaid = dosyaId
        matchedFile += 1
      }
    })

    let inserted = 0

    await withAuditedPoolWrite(pool, async (client) => {
      for (const row of normalizedRows) {
        const rowColumns = Object.keys(row)
        const values = rowColumns.map((columnName) => row[columnName])
        const columnSql = rowColumns.map(quoteIdentifier).join(', ')
        const paramSql = values.map((_value, index) => `$${index + 1}`).join(', ')

        await client.query(
          `INSERT INTO public.${quoteIdentifier(TABLE_NAME)} (${columnSql}) VALUES (${paramSql});`,
          values,
        )
        inserted += 1
      }
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({
      success: true,
      data: {
        inserted,
        skipped: rows.length - inserted,
        matchedFile,
        unmatchedFile: inserted - matchedFile,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Excel aktarımı yapılamadı.' },
      { status: 500 },
    )
  }
}
