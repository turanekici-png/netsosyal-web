import { NextRequest, NextResponse } from 'next/server'
import type { Pool } from 'pg'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { requireDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'
import { buildGulkartListWhereClause, quoteIdentifier } from '@/lib/gulkart/listeFilters'

const TABLE_NAME = 'nakitkart'

type ImportRow = Record<string, unknown>

type DeletePayload = { ids?: Array<string | number> }

function normalizeIds(ids: DeletePayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

async function getTableColumns() {
  const pool = getSqlMonitorPool()
  const result = await pool.query<{
    column_name: string
    is_nullable: string
    column_default: string | null
    data_type: string
  }>(
    `
      SELECT column_name, is_nullable, column_default, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position;
    `,
    [TABLE_NAME],
  )

  if (result.rows.length === 0) {
    throw new Error(`${TABLE_NAME} tablosu bulunamadı.`)
  }

  return result.rows
}

type BireyTcMatch = {
  tckimlikno: string
  dosyaid: string | null
  bireyid: string
  dogumtarihi: string | null
  ceptel: string | null
}

type NakitTcMatch = {
  tckimlikno: string
  ceptel: string | null
}

// Kullanici istegi: Excel/CSV sablonu artik sadece tckimlikno, adisoadi,
// kartno alanlarini icerir - "uygulama otomatik olarak bu tckimlikno
// bilgisiyla diğer alanları doldursun" (dosyaid, bireyid, dogumtarihi,
// ceptel). Telefon icin oncelik SIRASI acikca belirtildi: "ilk olarak
// ilgili kaydın durumu 0 olan nakit yardımı müracaatlarına baksın ve
// oradan alsın" - yani once yrd_ayninakti.durumu=0 (Yeni Müracaat) kaydinin
// KENDI ceptel'i denenir, orada yoksa bireyin kendi kayitli telefonuna
// (bireyler.ceptel) dusulur. "Dosya sahibi" secimi (tipi=1 > yakinligi=0 >
// diger) diger senkron butonlariyla (bkz. sync-phone-numbers/route.ts)
// AYNI oncelik sirasidir - ancak burada tckimlikno zaten TEKIL oldugundan
// (bireyler.tckimlikno UNIQUE) pratikte tek satirla eslesir.
async function fetchTcEnrichment(pool: Pool, tcNumbers: string[]) {
  const bireyMap = new Map<string, BireyTcMatch>()
  const nakitMap = new Map<string, NakitTcMatch>()
  if (tcNumbers.length === 0) return { bireyMap, nakitMap }

  const bireyResult = await pool.query<BireyTcMatch>(
    `
      SELECT DISTINCT ON (b.tckimlikno)
        b.tckimlikno AS tckimlikno,
        b.dosyaid::text AS dosyaid,
        b.id::text AS bireyid,
        to_char(b.dogumtarihi, 'DD.MM.YYYY') AS dogumtarihi,
        NULLIF(BTRIM(b.ceptel), '') AS ceptel
      FROM public.bireyler b
      WHERE b.tckimlikno = ANY($1::text[])
      ORDER BY b.tckimlikno,
        CASE WHEN b.tipi = 1 THEN 0 WHEN b.yakinligi = 0 THEN 1 ELSE 2 END,
        b.id DESC
    `,
    [tcNumbers],
  )
  bireyResult.rows.forEach((row) => bireyMap.set(row.tckimlikno, row))

  const nakitResult = await pool.query<NakitTcMatch>(
    `
      SELECT DISTINCT ON (n.tckimlikno)
        n.tckimlikno AS tckimlikno,
        NULLIF(BTRIM(n.ceptel), '') AS ceptel
      FROM public.yrd_ayninakti n
      WHERE n.tckimlikno = ANY($1::text[])
        AND n.durumu = 0
        AND n.ceptel IS NOT NULL
        AND BTRIM(n.ceptel) <> ''
      ORDER BY n.tckimlikno, n.muracaattarihi DESC NULLS LAST, n.id DESC
    `,
    [tcNumbers],
  )
  nakitResult.rows.forEach((row) => nakitMap.set(row.tckimlikno, row))

  return { bireyMap, nakitMap }
}

export async function GET(request: NextRequest) {
  try {
    const columns = await getTableColumns()

    // Kullanici istegi: "1 ya da birden çok veya tüm kayıtları seçip
    // silebilelim" - "Tümünü Seç" (filtrelenen TÜM kayitlar, sadece o an
    // ekrandaki sayfa degil) icin, sayfada GORUNMEYEN diger sayfalardaki
    // kayitlarin id'lerine de ihtiyac var. Bu mod, sayfanin kendi SSR veri
    // sorgusuyla (bkz. app/(modules)/gulkart/liste/page.tsx) AYNI ortak
    // filtre fonksiyonunu (buildGulkartListWhereClause) kullanir, boylece
    // "Tümünü Seç" ekranda o an gorunen filtreyle HER ZAMAN tutarlidir.
    const { searchParams } = new URL(request.url)
    if (searchParams.get('idsOnly') === '1') {
      const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/gulkart/liste' })
      if (accessDenied) return accessDenied

      const params = Object.fromEntries(searchParams.entries())
      const searchTerm = searchParams.get('search')?.trim() || ''
      const columnNames = columns.map((column) => column.column_name)
      const whereClause = buildGulkartListWhereClause(params, columnNames, searchTerm)

      const pool = getSqlMonitorPool()
      const result = await pool.query<{ id: string }>(
        `
          SELECT t.id::text AS id
          FROM public.${quoteIdentifier(TABLE_NAME)} t
          LEFT JOIN public.dosyalar d ON d.id = t.dosyaid
          WHERE 1=1 ${whereClause}
        `,
      )

      return NextResponse.json({ success: true, data: { ids: result.rows.map((row) => row.id) } })
    }

    return NextResponse.json({
      success: true,
      data: columns.map((column) => ({
        name: column.column_name,
        nullable: column.is_nullable === 'YES',
        dataType: column.data_type,
        generated: Boolean(column.column_default),
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kolonlar alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/gulkart/liste' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as { rows?: ImportRow[] }
    const rows = Array.isArray(payload.rows) ? payload.rows : []

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Aktarılacak satır bulunamadı.' }, { status: 400 })
    }

    const columns = await getTableColumns()
    const columnByName = new Map(columns.map((column) => [column.column_name.toLocaleLowerCase('tr-TR'), column]))
    const insertableColumnNames = columns
      .filter((column) => !column.column_default?.toLowerCase().includes('nextval'))
      .map((column) => column.column_name)
    const insertableSet = new Set(insertableColumnNames.map((columnName) => columnName.toLocaleLowerCase('tr-TR')))

    const normalizedRows = rows.map((row) => {
      const normalized: ImportRow = {}
      Object.entries(row).forEach(([key, value]) => {
        const cleanKey = key.trim()
        const column = columnByName.get(cleanKey.toLocaleLowerCase('tr-TR'))
        if (!column || !insertableSet.has(column.column_name.toLocaleLowerCase('tr-TR'))) return

        normalized[column.column_name] = typeof value === 'string' && value.trim() === ''
          ? null
          : value
      })
      return normalized
    }).filter((row) => Object.keys(row).length > 0)

    if (normalizedRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dosyadaki başlıklar tablo kolonları ile eşleşmedi.' },
        { status: 400 },
      )
    }

    const pool = getSqlMonitorPool()

    // Kullanici istegi: sadece tckimlikno/adisoadi/kartno yuklenir, geri
    // kalan alanlar (dosyaid, bireyid, dogumtarihi, ceptel) TC kimlik no
    // uzerinden OTOMATIK doldurulur - bkz. fetchTcEnrichment. Satirda
    // ZATEN o alan icin bir deger girilmisse (kullanici bilerek doldurmus
    // veya baska bir sablonla yuklemis) UZERINE YAZILMAZ, sadece BOS/eksik
    // olan alanlar tamamlanir.
    const tcNumbers = Array.from(new Set(
      normalizedRows
        .map((row) => (typeof row.tckimlikno === 'string' || typeof row.tckimlikno === 'number') ? String(row.tckimlikno).trim() : '')
        .filter((tc) => /^\d{5,11}$/.test(tc)),
    ))
    const { bireyMap, nakitMap } = await fetchTcEnrichment(pool, tcNumbers)
    let enrichedFromTc = 0

    normalizedRows.forEach((row) => {
      const tc = (typeof row.tckimlikno === 'string' || typeof row.tckimlikno === 'number') ? String(row.tckimlikno).trim() : ''
      if (!tc) return

      const birey = bireyMap.get(tc)
      const nakit = nakitMap.get(tc)
      let touched = false

      if (birey) {
        if ((row.dosyaid === undefined || row.dosyaid === null) && birey.dosyaid) {
          row.dosyaid = birey.dosyaid
          touched = true
        }
        if ((row.bireyid === undefined || row.bireyid === null) && birey.bireyid) {
          row.bireyid = birey.bireyid
          touched = true
        }
        if ((row.dogumtarihi === undefined || row.dogumtarihi === null) && birey.dogumtarihi) {
          row.dogumtarihi = birey.dogumtarihi
          touched = true
        }
      }

      if (row.ceptel === undefined || row.ceptel === null) {
        // Oncelik: durumu=0 (Yeni Müracaat) nakit yardimi kaydinin telefonu,
        // yoksa bireyin kendi kayitli telefonu.
        const phone = nakit?.ceptel || birey?.ceptel || null
        if (phone) {
          row.ceptel = phone
          touched = true
        }
      }

      if (touched) enrichedFromTc += 1
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
        skipped: rows.length - normalizedRows.length,
        enrichedFromTc,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Excel aktarımı yapılamadı.' },
      { status: 500 },
    )
  }
}

// Kullanici istegi: "1 ya da birden çok veya tüm kayıtları seçip ilgili
// kayıtları veritabanından silebilelim" - tek/coklu/"Tümünü Seç" ile
// secilen Gülkart (nakitkart) kayitlarini kalici olarak siler. Diger
// kalici silme uc noktalariyla (bkz. app/api/documents/route.ts DELETE)
// AYNI guvenlik deseni: normal islem yetkisi + sifre ile "destructive
// authorization" (kisa omurlu, tek kullanimlik token) ikisi birden gerekir.
export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/gulkart/liste' })
    if (accessDenied) return accessDenied

    const destructiveDenied = await requireDestructiveAuthorization(request)
    if (destructiveDenied) return destructiveDenied

    const payload = await request.json().catch(() => ({})) as DeletePayload
    const ids = normalizeIds(payload.ids)

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek Gülkart kaydı seçilmedi.' }, { status: 400 })
    }

    const pool = getSqlMonitorPool()
    const deleted = await withAuditedPoolWrite(pool, async (client) => {
      const result = await client.query(
        `DELETE FROM public.${quoteIdentifier(TABLE_NAME)} WHERE id = ANY($1::bigint[])`,
        [ids],
      )
      return result.rowCount || 0
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: { requested: ids.length, deleted } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gülkart kayıtları silinemedi.' },
      { status: 500 },
    )
  }
}
