import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { buildFriendlyAuditDescription } from '@/lib/reports/friendlyAuditDescription'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CountValue = bigint | number | string | null

type UserPerformanceRow = {
  user_name: string | null
  total_count: CountValue
  daily_count: CountValue
  weekly_count: CountValue
  monthly_count: CountValue
  last_activity: Date | string | null
}

type BreakdownRow = {
  user_name: string | null
  label: string | null
  count: CountValue
}

type RecentActivityRow = {
  user_name: string | null
  operation_type: string | null
  table_name: string | null
  record_id: string | null
  description: string | null
  old_value: unknown
  new_value: unknown
  activity_date: Date | string | null
}

function toNumber(value: CountValue) {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value) || 0
  return 0
}

function toDateString(value: Date | string | null) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

// ÖNEMLİ: Daha önce burada kaydin ait oldugu dosya/yardim satirinin GUNCEL
// "kullaniciid" (sahip/atanan kullanici) alanina LATERAL join ile bakip
// islemi kimin yaptigini tahmin eden bir "recordUserJoin" vardi. Bu
// yanlisti: bir dosya "A" kullanicisina atanmis olsa bile o dosyada
// degisiklik yapan farkli bir "B" kullanicisi olabilir; boyle durumlarda
// islem A'ya mal ediliyor, B'nin gercek islem sayisi (ör. gunluk raporu)
// hatali sekilde dusuk gorunuyordu. sistem_hareket_log.kullanici_adi zaten
// audit trigger'i tarafindan o anki oturum kullanicisindan dogrudan
// yaziliyor (bkz. lib/db/auditContext.ts) - bu ISLEMI GERCEKTEN YAPAN
// kisinin login adidir. Tam adi bulmak icin sadece bu login adiyla
// kullanicilar tablosuna eslestirmek yeterlidir; kaydin sahibiyle ilgisi
// yoktur.
function actorUserJoin(alias: 'h' | 'a') {
  return `LEFT JOIN kullanicilar k ON k.kullaniciadi = ${alias}.kullanici_adi`
}

function userNameExpression(alias: 'h' | 'a') {
  return `COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(${alias}.kullanici_adi, ''), 'Bilinmeyen')`
}

function monthlyEventsCte(extraColumns: string) {
  return `
    WITH events AS (
      SELECT
        ${userNameExpression('h')} AS user_name,
        h.tarih,
        ${extraColumns}
      FROM sistem_hareket_log h
      ${actorUserJoin('h')}
      WHERE h.tarih >= date_trunc('month', now())
      UNION ALL
      SELECT
        ${userNameExpression('a')} AS user_name,
        a.tarih,
        ${extraColumns.replaceAll('h.', 'a.')}
      FROM sistem_audit_revizyonlar a
      ${actorUserJoin('a')}
      WHERE a.tarih >= date_trunc('month', now())
    )
  `
}

export async function GET() {
  try {
    const usersSql = `
      ${monthlyEventsCte('NULL::text AS table_name, NULL::text AS operation_type')}
      SELECT
        user_name,
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE tarih >= current_date) AS daily_count,
        COUNT(*) FILTER (WHERE tarih >= date_trunc('week', now())) AS weekly_count,
        COUNT(*) FILTER (WHERE tarih >= date_trunc('month', now())) AS monthly_count,
        MAX(tarih) AS last_activity
      FROM events
      GROUP BY user_name
      ORDER BY user_name ASC
    `

    const categoriesSql = `
      ${monthlyEventsCte("COALESCE(NULLIF(h.tablo_adi, ''), 'bilinmeyen') AS table_name, NULL::text AS operation_type")}
      SELECT
        user_name,
        CASE
          WHEN table_name ILIKE 'dosya%' OR table_name ILIKE 'beklenen_evrak%' THEN 'Dosyalar'
          WHEN table_name ILIKE 'birey%' THEN 'Bireyler'
          WHEN table_name ILIKE 'yrd_%' THEN 'Yardımlar ve Müracaatlar'
          WHEN table_name ILIKE 'rapor%' OR table_name ILIKE 'tahkikat%' THEN 'Raporlar'
          WHEN table_name ILIKE 'sistem_%' OR table_name ILIKE 'app_%' OR table_name ILIKE 'ayar%' THEN 'Sistem'
          ELSE 'Diğer'
        END AS label,
        COUNT(*) AS count
      FROM events
      GROUP BY user_name, label
      ORDER BY user_name ASC, count DESC
    `

    const operationsSql = `
      ${monthlyEventsCte("NULL::text AS table_name, COALESCE(NULLIF(h.islem_tipi, ''), 'İşlem') AS operation_type")}
      SELECT user_name, operation_type AS label, COUNT(*) AS count
      FROM events
      GROUP BY user_name, operation_type
      ORDER BY user_name ASC, count DESC
    `

    const fieldsSql = `
      SELECT
        ${userNameExpression('a')} AS user_name,
        field_name AS label,
        COUNT(*) AS count
      FROM sistem_audit_revizyonlar a
      ${actorUserJoin('a')}
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(a.degisen_alanlar::jsonb) = 'array' THEN a.degisen_alanlar::jsonb
          ELSE '[]'::jsonb
        END
      ) AS field_name
      WHERE a.tarih >= date_trunc('month', now())
      GROUP BY user_name, field_name
      ORDER BY user_name ASC, count DESC
      LIMIT 200
    `

    // Performans notu: bu CTE'nin iki dalinda da (h/a) tarih filtresi
    // KASITLI olarak icerde tutuluyor - disaridaki "WHERE activity_date >=
    // ..." (asagida, ayni ay icin) zaten AYNI sonucu verir, ama filtre
    // SADECE disarida olsaydi PostgreSQL (surum 9.4, CTE'ler her zaman
    // "optimization fence" ile materialize edilir) sistem_hareket_log'un
    // TAMAMINI (yuz binlerce satir) tarih sinirlamasi OLMADAN okur, ROI
    // (bu satiri) sonradan filtrelerdi - canli olcumde bu tek fark 600ms+
    // sure kaybina yol aciyordu. Burada bir onceki aya kadar (haftalik/
    // gunluk periyotlari da rahatlikla kapsayacak, cok cömert) bir on-
    // filtre ekleyerek ayni sonucu COK daha az satir okuyarak elde ediyoruz.
    const recentSql = `
      WITH events AS (
        SELECT
          ${userNameExpression('h')} AS user_name,
          h.islem_tipi AS operation_type,
          h.tablo_adi AS table_name,
          h.kayit_id AS record_id,
          h.aciklama AS description,
          h.eski_deger::jsonb AS old_value,
          h.yeni_deger::jsonb AS new_value,
          h.tarih AS activity_date
        FROM sistem_hareket_log h
        ${actorUserJoin('h')}
        WHERE h.tarih >= date_trunc('month', now()) - interval '1 month'
        UNION ALL
        SELECT
          ${userNameExpression('a')} AS user_name,
          a.islem_tipi AS operation_type,
          a.tablo_adi AS table_name,
          a.kayit_id AS record_id,
          a.aciklama AS description,
          a.eski_deger::jsonb AS old_value,
          a.yeni_deger::jsonb AS new_value,
          a.tarih AS activity_date
        FROM sistem_audit_revizyonlar a
        ${actorUserJoin('a')}
        WHERE a.tarih >= date_trunc('month', now()) - interval '1 month'
      )
      SELECT user_name, operation_type, table_name, record_id, description, old_value, new_value, activity_date
      FROM events
      WHERE activity_date >= date_trunc('month', now())
      ORDER BY activity_date DESC NULLS LAST
      LIMIT 50
    `

    const [users, categories, operations, fields, recent] = await Promise.all([
      prisma.$queryRawUnsafe<UserPerformanceRow[]>(usersSql),
      prisma.$queryRawUnsafe<BreakdownRow[]>(categoriesSql),
      prisma.$queryRawUnsafe<BreakdownRow[]>(operationsSql),
      prisma.$queryRawUnsafe<BreakdownRow[]>(fieldsSql),
      prisma.$queryRawUnsafe<RecentActivityRow[]>(recentSql),
    ])

    return NextResponse.json({
      success: true,
      data: {
        users: users.map((row) => ({
          userName: row.user_name || 'Bilinmeyen',
          total: toNumber(row.total_count),
          daily: toNumber(row.daily_count),
          weekly: toNumber(row.weekly_count),
          monthly: toNumber(row.monthly_count),
          lastActivity: toDateString(row.last_activity),
        })),
        categories: categories.map((row) => ({
          userName: row.user_name || 'Bilinmeyen',
          label: row.label || 'Diğer',
          count: toNumber(row.count),
        })),
        operations: operations.map((row) => ({
          userName: row.user_name || 'Bilinmeyen',
          label: row.label || 'İşlem',
          count: toNumber(row.count),
        })),
        fields: fields.map((row) => ({
          userName: row.user_name || 'Bilinmeyen',
          label: row.label || 'Alan',
          count: toNumber(row.count),
        })),
        recent: recent.map((row) => ({
          userName: row.user_name || 'Bilinmeyen',
          operationType: row.operation_type || 'İşlem',
          tableName: row.table_name || '-',
          recordId: row.record_id || '-',
          description: buildFriendlyAuditDescription({
            tableName: row.table_name || '',
            operationType: row.operation_type || '',
            recordId: row.record_id,
            oldValue: row.old_value,
            newValue: row.new_value,
            fallbackDescription: row.description,
          }),
          activityDate: toDateString(row.activity_date),
        })),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    )
  }
}
