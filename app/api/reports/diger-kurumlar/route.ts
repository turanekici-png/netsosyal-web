import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { buildFilterCondition, prepareSqlSearchTerm } from '@/lib/utils'
import { userService } from '@/lib/services'

const TABLE_NAME = 'yrd_digerkrmalyrdm'

// Kullanici istegi/hata raporu ("invalid input syntax for type date:
// '46260'"): Excel'de gercek tarih olarak girilen bir hucre, .xlsx
// dosyasinda Excel'in KENDI ic tarih sayisi (30 Aralik 1899'dan bu yana
// gecen gun sayisi) olarak saklanir. Bu artik lib/utils/xlsxImport.ts'te
// (hucrenin STIL bilgisine bakilarak) DOGRU sekilde taninip metne
// cevriliyor - ama BURADA da (sadece "tarih" sutununa ozel, "miktar" gibi
// GERCEKTEN sayisal kalmasi gereken sutunlara DOKUNMADAN) ayni donusum
// ikinci bir guvenlik agi olarak uygulanir - ör. CSV ile veya baska bir
// yoldan ham bir Excel seri numarasi buraya kadar gelirse import yine de
// hataya dusmeden dogru tarihi kaydeder.
function excelSerialToIsoDateString(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  const epochMs = Date.UTC(1899, 11, 30)
  const date = new Date(epochMs + serial * 86400000)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Excel'in gercekci tarih araligi (1950-2100 arasi) - bu araligin disindaki
// sayisal "tarih" degerleri (ör. yanlislikla baska bir sutundan kaymis bir
// deger) sessizce/yanlis bir tarihe CEVRILMEZ, oldugu gibi birakilir
// (mevcut ::date hata mesaji zaten personelin sorunu fark etmesini saglar).
function looksLikeExcelDateSerial(value: string) {
  if (!/^\d+(\.\d+)?$/.test(value)) return false
  const numeric = Number(value)
  return numeric >= 18262 && numeric <= 73050 // ~1950-01-01 .. ~2100-01-01
}

type ImportRow = Record<string, unknown>
type DeletePayload = {
  ids?: Array<string | number>
  mode?: 'selected' | 'filtered'
  filters?: Record<string, string>
  limit?: number
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
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

export async function GET() {
  try {
    const columns = await getTableColumns()
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
    const accessDenied = await requireApiAccess({ action: 'assistance.create', page: '/reports/diger-kurumlar' })
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

        if (typeof value === 'string' && value.trim() === '') {
          normalized[column.column_name] = null
          return
        }

        if (column.column_name === 'tarih' && typeof value === 'string' && looksLikeExcelDateSerial(value.trim())) {
          normalized[column.column_name] = excelSerialToIsoDateString(Number(value.trim())) ?? value
          return
        }

        normalized[column.column_name] = value
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

    // Kullanici istegi: Excel sablonu artik "dosyaid" gibi teknik alanlari
    // ICERMIYOR - kisinin dosyasi, satirdaki TC Kimlik No'ya gore bireyler
    // tablosundan OTOMATIK bulunup baglanir. Once, aktarilacak satirlardaki
    // TUM tckimlikno degerleri TEK bir sorguyla (N+1 sorgudan kacinmak
        // icin) bireyler tablosunda aranir.
    const tckimliklerinSeti = Array.from(new Set(
      normalizedRows
        .map((row) => (typeof row.tckimlikno === 'string' ? row.tckimlikno.trim() : String(row.tckimlikno ?? '').trim()))
        .filter((value) => value.length > 0),
    ))

    const bireyEslesmeleri = new Map<string, { dosyaid: number | null; uyrugu: string | null }>()
    if (tckimliklerinSeti.length > 0) {
      const bireyResult = await pool.query<{ tckimlikno: string; dosyaid: number | null; uyrugu: string | null }>(
        `
          SELECT DISTINCT ON (tckimlikno) tckimlikno, dosyaid, uyrugu
          FROM bireyler
          WHERE tckimlikno = ANY($1::text[])
            AND dosyaid IS NOT NULL
          ORDER BY tckimlikno, id DESC
        `,
        [tckimliklerinSeti],
      )
      bireyResult.rows.forEach((row) => {
        bireyEslesmeleri.set(row.tckimlikno, { dosyaid: row.dosyaid, uyrugu: row.uyrugu })
      })
    }

    const currentUser = await userService.getCurrent()
    const currentUserId = currentUser?.id ? Number(currentUser.id) : null
    const now = new Date()
    let dosyaBulunamayan = 0

    const enrichedRows = normalizedRows.map((row) => {
      const enriched: ImportRow = { ...row }
      const tckimlikno = typeof row.tckimlikno === 'string' ? row.tckimlikno.trim() : String(row.tckimlikno ?? '').trim()
      const eslesenBirey = tckimlikno ? bireyEslesmeleri.get(tckimlikno) : undefined

      if (insertableSet.has('dosyaid') && enriched.dosyaid === undefined) {
        enriched.dosyaid = eslesenBirey?.dosyaid ?? null
        if (!eslesenBirey?.dosyaid) dosyaBulunamayan += 1
      }
      if (insertableSet.has('uyrugu') && (enriched.uyrugu === undefined || enriched.uyrugu === null)) {
        enriched.uyrugu = eslesenBirey?.uyrugu ?? 'TC'
      }
      if (insertableSet.has('kullaniciid') && enriched.kullaniciid === undefined) {
        enriched.kullaniciid = currentUserId
      }
      if (insertableSet.has('ilkkullaniciid') && enriched.ilkkullaniciid === undefined) {
        enriched.ilkkullaniciid = currentUserId
      }
      if (insertableSet.has('islemtarihi') && enriched.islemtarihi === undefined) {
        enriched.islemtarihi = now
      }
      if (insertableSet.has('ilkislemtarihi') && enriched.ilkislemtarihi === undefined) {
        enriched.ilkislemtarihi = now
      }

      return enriched
    })

    let inserted = 0

    await withAuditedPoolWrite(pool, async (client) => {
      for (const row of enrichedRows) {
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
        // Kullanici istegi: dosyasi otomatik bulunamayan (ör. TC kimlik no
        // sistemde kayitli degil/yazim hatasi) satir sayisi ayrica
        // raporlanir - kayit yine de EKLENIR (dosyaid bos kalir), boylece
        // veri kaybolmaz ama personel hangi satirlarin elle kontrol
        // edilmesi gerektigini bilir.
        dosyaBulunamayan,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Excel aktarımı yapılamadı.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.delete', page: '/reports/diger-kurumlar' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as DeletePayload
    const pool = getSqlMonitorPool()

    if (payload.mode === 'filtered') {
      const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {}
      const searchTerm = filters.search?.trim() || ''
      const hasActiveFilter = Boolean(searchTerm) || Object.keys(filters).some((key) => key.startsWith('f_') && filters[key])

      if (!hasActiveFilter) {
        return NextResponse.json(
          { success: false, error: 'Filtreli toplu silme için önce arama veya filtre uygulayın.' },
          { status: 400 },
        )
      }

      const safeSearchTerm = prepareSqlSearchTerm(searchTerm)
      const filterCondition = buildFilterCondition(filters, 't')
      // ONEMLI DUZELTME: "t.muracaateden" ve "t.etiket" yrd_digerkrmalyrdm
      // tablosunda HIC YOK - gercek sutunlarla (adisoyadi, tckimlikno)
      // degistirildi (bkz. sayfadaki (page.tsx) AYNI duzeltme notu).
      const searchCondition = safeSearchTerm
        ? ` AND (t.adisoyadi ILIKE '%${safeSearchTerm}%' OR t.aciklama ILIKE '%${safeSearchTerm}%' OR t.tckimlikno ILIKE '%${safeSearchTerm}%' OR d.dosyano ILIKE '%${safeSearchTerm}%')`
        : ''
      const limit = Number.isInteger(Number(payload.limit))
        ? Math.max(1, Math.min(1000, Number(payload.limit)))
        : 0
      const limitClause = limit > 0 ? `LIMIT ${limit}` : ''
      const matchingRowsSql = `
        SELECT t.id
        FROM public.${quoteIdentifier(TABLE_NAME)} t
        LEFT JOIN dosyalar d ON t.dosyaid = d.id
        WHERE 1=1 ${filterCondition} ${searchCondition}
      `
      const result = await withAuditedPoolWrite(pool, (client) => client.query(`
        DELETE FROM public.${quoteIdentifier(TABLE_NAME)}
        WHERE id IN (
          ${matchingRowsSql}
          ${limitClause}
        );
      `), getAuditMetaFromRequest(request))
      const remainingResult = limit > 0
        ? await pool.query(`SELECT COUNT(*)::int AS remaining FROM (${matchingRowsSql}) remaining_rows;`)
        : null

      return NextResponse.json({
        success: true,
        data: {
          mode: 'filtered',
          deleted: result.rowCount || 0,
          remaining: remainingResult ? Number(remainingResult.rows[0]?.remaining || 0) : 0,
        },
      })
    }

    const ids = Array.isArray(payload.ids)
      ? Array.from(new Set(payload.ids.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id))))
      : []

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek kayıt seçilmedi.' }, { status: 400 })
    }

    const result = await withAuditedPoolWrite(
      pool,
      (client) => client.query(`DELETE FROM public.${quoteIdentifier(TABLE_NAME)} WHERE id = ANY($1::bigint[]);`, [ids]),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      data: {
        requested: ids.length,
        deleted: result.rowCount || 0,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayıtlar silinemedi.' },
      { status: 500 },
    )
  }
}
