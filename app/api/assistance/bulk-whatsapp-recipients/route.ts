import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, buildTextSearchClause, formatDate } from '@/lib/utils'
import { computeNeighborhoodPaymentWindow } from '@/lib/utils/paymentWindow'
import type { MessageTemplateTokenValues } from '@/lib/messageTemplateTokens'

export const dynamic = 'force-dynamic'

// POST - "Filtrelenen Tümünü Seç" ile TÜM sayfalardaki (sadece o an ekranda
// görünen 50 kayıt değil) EŞLEŞEN kayıtların WhatsApp/SMS alıcı bilgilerini
// (telefon, isim, dosya no, IBAN, alışveriş günleri) döner - bkz.
// components/shared/ManagedReportTablePage.tsx (bulkWhatsappAllFilteredConfig).
//
// ÖNEMLİ (Eylül 2026 - hata düzeltmesi): eskiden bu uç nokta SADECE 3 tabloyu
// (Gıda Bankası / Destek Paketi / Nakit) tanıyordu VE filtre eşlemesi
// (filterColumnMap) liste sayfasınınkinin (AssistanceListPage) EKSİK bir
// kopyasıydı - "Dosya Durumu", "Cep Telefonu", "Son Mesaj *", "Gülkart" gibi
// JOIN'li sütunlara göre filtrelendiğinde bu koşullar buildMappedFilterCondition
// tarafından SESSİZCE yok sayılıyor, sonuç: "Filtrelenen Tümünü Seç" filtreyi
// dikkate almadan TÜM tabloya (50.000 tavana kadar) SMS göndermeye çalışıyordu.
// Artık: (1) TÜM yardım tabloları (yrd_*) desteklenir, (2) filterColumnMap ve
// JOIN'ler AssistanceListPage'inkiyle BİREBİR aynı.

// "Filtrelenen Tumunu Sec" ile cozulen alici sayisi ust siniri.
const MAX_RECIPIENTS = 50000

// Bilinen yardim tablolari - fazladan guvenlik (yine de asagida "dosyaid"
// sutunu ZORUNLU kontrol edilir, whitelist olmayan bir yrd_* tablosu da
// ayni sekle uyuyorsa calisir).
const KNOWN_ASSISTANCE_TABLES = new Set([
  'yrd_ayninakti', 'yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_ddgidadosyali',
  'yrd_ekmek', 'yrd_giyim', 'yrd_haziryemek',
])

// Sadece bu 2 tabloda mahalle "Ödeme Günü"nden hesaplanan gercek alisveris
// penceresi (abaslangic/abitis kisayollari) vardir.
const PAYMENT_WINDOW_TABLES = new Set(['yrd_gidabankasi', 'yrd_destekpaketi'])

function isSafeIdentifier(value: string) {
  return /^[a-zA-Z0-9_]+$/.test(value)
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

// Client'tan gelen "whereClause" HAM SQL olarak GUVENILMEZ - yalnizca
// "t.durumu" uzerinde sayisal karsilastirmalardan (=, !=, <>, IN(...)) ve
// AND/OR baglaclarindan olusuyorsa kullanilir (gercek liste config'lerinin
// hepsi bu kalibla uyumlu: "t.durumu = 6", "t.durumu != 0",
// "t.durumu != 0 AND t.durumu != 2" ...). Uymuyorsa istek reddedilir -
// BILEREK: gecersiz bir kosulu "1=1"e cevirip herkese gondermek tehlikeli.
function isSafeStatusWhereClause(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v) return false
  const atom = /t\.durumu\s*(=|!=|<>)\s*\d+|t\.durumu\s+IN\s*\(\s*\d+(\s*,\s*\d+)*\s*\)/i
  const full = new RegExp(`^\\s*(${atom.source})(\\s+(AND|OR)\\s+(${atom.source}))*\\s*$`, 'i')
  return full.test(v)
}

interface RecipientRow {
  id: string
  dosyaid: string | null
  dosyano: string | null
  resolved_phone: string | null
  own_iban: string | null
  muracaateden: string | null
  donemint: number | string | null
  mahalle_odeme_gunu: number | string | null
  mahalle_odeme_gunu_bitis: number | string | null
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'documents.sms' })
  if (accessDenied) return accessDenied

  const body = await request.json().catch(() => null)
  const tableName = typeof body?.tableName === 'string' ? body.tableName : ''
  const filters = (body?.filters && typeof body.filters === 'object') ? body.filters as Record<string, string> : {}

  if (!isSafeIdentifier(tableName) || (!KNOWN_ASSISTANCE_TABLES.has(tableName) && !tableName.startsWith('yrd_'))) {
    return NextResponse.json({ success: false, error: 'Geçersiz veya desteklenmeyen tablo.' }, { status: 400 })
  }

  if (!isSafeStatusWhereClause(body?.whereClause)) {
    return NextResponse.json({ success: false, error: 'Geçersiz filtre koşulu.' }, { status: 400 })
  }
  const whereClause = (body.whereClause as string).trim()

  try {
    const columnsResult = await sqlMonitorService.executeQuery(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${sqlString(tableName)}
    `)
    const columnNames = new Set((columnsResult.rows as { column_name: string }[]).map((row) => row.column_name))

    if (!columnNames.has('dosyaid')) {
      return NextResponse.json({ success: false, error: 'Bu tablo için toplu alıcı çözümü desteklenmiyor.' }, { status: 400 })
    }

    const hasOwnCeptel = columnNames.has('ceptel')
    const hasIban = columnNames.has('iban')
    const hasTc = columnNames.has('tckimlikno')
    const hasPaymentWindow = PAYMENT_WINDOW_TABLES.has(tableName) && columnNames.has('donemint')

    // filterColumnMap - AssistanceListPage.tsx'teki ile BIREBIR AYNI olmali,
    // aksi halde JOIN'li sutun filtreleri sessizce yok sayilir.
    const filterColumnMap: Record<string, string> = Object.fromEntries(
      Array.from(columnNames).filter(isSafeIdentifier).map((name) => [name, `t.${quoteIdentifier(name)}`]),
    )
    filterColumnMap.dosyano = 'd.dosyano'
    filterColumnMap.inceleme_puani = 'd.inceleme_puani'
    filterColumnMap.dosya_durumu = 'd.durumu'
    filterColumnMap.mahalle = 'd.mahalleadi'
    filterColumnMap.dosya_adresi = 'd.adres'
    filterColumnMap.dosya_telefonu = 'd.telefon'
    filterColumnMap.ceptel = 'owner_ceptel.ceptel'
    filterColumnMap.son_mesaj_tarihi = 'sm.created_at'
    filterColumnMap.son_mesaj_kanali = "CASE sm.kanal WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'sms' THEN 'SMS' ELSE sm.kanal END"
    filterColumnMap.son_mesaj_durumu = 'sm.durum'
    filterColumnMap.son_mesaj_alici = 'sm.telefon'
    filterColumnMap.gulkart = 'gk.kartno'

    const filterCondition = buildMappedFilterCondition(filters, filterColumnMap)
    const searchColumns = [
      't.muracaateden',
      ...(hasTc ? ['t.tckimlikno'] : []),
      ...(hasIban ? ['t.iban'] : []),
      'd.dosyano', 'd.mahalleadi', 'd.adres',
    ]
    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause(searchColumns, (filters.search || '').trim())

    // JOIN'ler - AssistanceListPage ile ayni kosullu mantik.
    const needsMessageLogJoin = /\bsm\./.test(filterCondition) || /\bsm\./.test(searchCondition)
    const needsGulkartJoin = tableName === 'yrd_ayninakti' && /\bgk\./.test(filterCondition + searchCondition)

    const phoneExpr = `COALESCE(${[
      ...(hasOwnCeptel ? ["NULLIF(BTRIM(t.ceptel), '')"] : []),
      "NULLIF(BTRIM(owner_ceptel.ceptel), '')",
      "NULLIF(BTRIM(d.telefon), '')",
    ].join(', ')})`

    const dataQuery = `
      SELECT
        t.id::text AS id,
        d.id::text AS dosyaid,
        d.dosyano,
        ${phoneExpr} AS resolved_phone,
        t.muracaateden,
        ${hasIban ? 't.iban AS own_iban,' : 'NULL::text AS own_iban,'}
        ${hasPaymentWindow ? 't.donemint, mh.mahalle_odeme_gunu, mh.mahalle_odeme_gunu_bitis' : 'NULL::int AS donemint, NULL::int AS mahalle_odeme_gunu, NULL::int AS mahalle_odeme_gunu_bitis'}
      FROM ${tableName} t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      LEFT JOIN LATERAL (
        SELECT NULLIF(BTRIM(b.ceptel), '') AS ceptel
        FROM bireyler b
        WHERE b.dosyaid = d.id
        ORDER BY CASE WHEN b.tipi = 1 THEN 0 WHEN b.yakinligi = 0 THEN 1 ELSE 2 END, b.id ASC
        LIMIT 1
      ) owner_ceptel ON TRUE
      ${needsMessageLogJoin ? `
      LEFT JOIN LATERAL (
        SELECT durum, telefon, created_at, kanal
        FROM sms_gonderim_log
        WHERE dosyaid = d.id::text
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1
      ) sm ON TRUE` : ''}
      ${needsGulkartJoin ? `
      LEFT JOIN LATERAL (
        SELECT nk.kartno FROM nakitkart nk WHERE nk.tckimlikno = t.tckimlikno ORDER BY nk.id DESC LIMIT 1
      ) gk ON TRUE` : ''}
      ${hasPaymentWindow ? `
      LEFT JOIN LATERAL (
        SELECT m.odemegunu AS mahalle_odeme_gunu, m.odemegunubitis AS mahalle_odeme_gunu_bitis
        FROM mahalleler m
        WHERE m.id = d.mahalleid OR lower(trim(m.mahalleadi)) = lower(trim(d.mahalleadi))
        ORDER BY CASE WHEN m.id = d.mahalleid THEN 0 ELSE 1 END
        LIMIT 1
      ) mh ON TRUE` : ''}
      WHERE ${whereClause} ${filterCondition} ${searchCondition}
      ORDER BY t.id DESC
      LIMIT ${MAX_RECIPIENTS}
    `

    const result = await sqlMonitorService.executeQuery(dataQuery)
    const rows = result.rows as unknown as RecipientRow[]

    const recipients = rows.map((row) => {
      const donemint = Number(row.donemint)
      let paymentStart: string | null = null
      let paymentEnd: string | null = null

      if (Number.isInteger(donemint) && donemint >= 100001) {
        const year = Math.floor(donemint / 100)
        const month = donemint % 100
        if (month >= 1 && month <= 12) {
          const startDay = row.mahalle_odeme_gunu === null || row.mahalle_odeme_gunu === undefined ? null : Number(row.mahalle_odeme_gunu)
          const endDay = row.mahalle_odeme_gunu_bitis === null || row.mahalle_odeme_gunu_bitis === undefined ? null : Number(row.mahalle_odeme_gunu_bitis)
          const window = computeNeighborhoodPaymentWindow(startDay, endDay, year, month)
          paymentStart = window.startDate
          paymentEnd = window.endDate
        }
      }

      const formattedStart = paymentStart ? formatDate(paymentStart) : null
      const formattedEnd = paymentEnd ? formatDate(paymentEnd) : null
      const validStart = formattedStart && formattedStart !== '-' ? formattedStart : null
      const validEnd = formattedEnd && formattedEnd !== '-' ? formattedEnd : null
      const rangeText = validStart && validEnd ? `${validStart} - ${validEnd}` : (validStart || validEnd || null)

      const dosyano = row.dosyano ? String(row.dosyano) : null
      const name = row.muracaateden ? String(row.muracaateden) : null
      const phone = row.resolved_phone ? String(row.resolved_phone) : null
      const ibanValue = row.own_iban ? String(row.own_iban) : null

      const tokens: MessageTemplateTokenValues = {
        isim: name,
        telefon: phone,
        dosyano,
        iban: ibanValue,
        abaslangic: validStart,
        abitis: validEnd,
        abaslangicbitis: rangeText,
      }

      return { id: row.id, phone, label: name, tokens, dosyaNo: dosyano, dosyaId: row.dosyaid ? String(row.dosyaid) : null }
    })

    return NextResponse.json({ success: true, data: recipients })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Alıcılar alınamadı.' },
      { status: 500 },
    )
  }
}
