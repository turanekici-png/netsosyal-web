import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { buildFriendlyAuditDescription } from '@/lib/reports/friendlyAuditDescription'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CountValue = bigint | number | string | null

type DetailRow = {
  user_name: string | null
  operation_type: string | null
  table_name: string | null
  record_id: string | null
  description: string | null
  old_value: unknown
  new_value: unknown
  activity_date: Date | string | null
}

type BreakdownRow = {
  label: string | null
  count: CountValue
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
// islem A'ya mal ediliyor, B'nin bu rapordaki islem listesi neredeyse bos
// kaliyordu (dashboard'daki toplam sayidan cok daha az). sistem_hareket_log.
// kullanici_adi zaten audit trigger'i tarafindan o anki oturum
// kullanicisindan dogrudan yaziliyor (bkz. lib/db/auditContext.ts) - bu
// ISLEMI GERCEKTEN YAPAN kisinin login adidir. Tam adi bulmak icin sadece
// bu login adiyla kullanicilar tablosuna eslestirmek yeterlidir; kaydin
// sahibiyle ilgisi yoktur.
function actorUserJoin(alias: 'h' | 'a') {
  return `LEFT JOIN kullanicilar k ON k.kullaniciadi = ${alias}.kullanici_adi`
}

function userNameExpression(alias: 'h' | 'a') {
  return `COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(${alias}.kullanici_adi, ''), 'Bilinmeyen')`
}

function periodFilter(period: string) {
  if (period === 'weekly') return "activity_date >= date_trunc('week', now())"
  if (period === 'monthly') return "activity_date >= date_trunc('month', now())"
  return 'activity_date >= current_date'
}

function periodLabel(period: string) {
  if (period === 'weekly') return 'Haftalik'
  if (period === 'monthly') return 'Aylik'
  return 'Gunluk'
}

export async function GET(request: NextRequest) {
  try {
    const userName = request.nextUrl.searchParams.get('user')?.trim()
    const requestedPeriod = request.nextUrl.searchParams.get('period') || 'daily'
    const period = ['daily', 'weekly', 'monthly'].includes(requestedPeriod) ? requestedPeriod : 'daily'

    if (!userName) {
      return NextResponse.json(
        { success: false, error: 'Kullanici bilgisi zorunludur.' },
        { status: 400 },
      )
    }

    // Performans notu: her iki daldaki "WHERE tarih >= ..." on-filtresi
    // (asagida, gunluk/haftalik/aylik butun periyotlari rahatca kapsayacak
    // sekilde bir onceki aya kadar cömertce genisletilmis) KASITLI olarak
    // burada, CTE'nin ICINDE tutuluyor - PostgreSQL 9.4'te CTE'ler her
    // zaman "optimization fence" ile materialize edildigi icin, bu filtre
    // SADECE disaridaki periodFilter(period)'a birakilsaydi
    // sistem_hareket_log'un TAMAMI (yuz binlerce satir, hicbir tarih
    // sinirlamasi olmadan) once okunup COK sonra filtrelenirdi - canli
    // olcumde bu farkin tek basina 600ms+ surdugu goruldu. Sonuc bu
    // degisiklikle AYNIDIR, sadece cok daha az satir taranarak elde edilir.
    const eventsCte = `
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
    `

    const detailsSql = `
      ${eventsCte}
      SELECT user_name, operation_type, table_name, record_id, description, old_value, new_value, activity_date
      FROM events
      WHERE user_name = $1 AND ${periodFilter(period)}
      ORDER BY activity_date DESC NULLS LAST
      LIMIT 500
    `

    const operationsSql = `
      ${eventsCte}
      SELECT COALESCE(NULLIF(operation_type, ''), 'Islem') AS label, COUNT(*) AS count
      FROM events
      WHERE user_name = $1 AND ${periodFilter(period)}
      GROUP BY label
      ORDER BY count DESC, label ASC
    `

    const tablesSql = `
      ${eventsCte}
      SELECT COALESCE(NULLIF(table_name, ''), 'bilinmeyen') AS label, COUNT(*) AS count
      FROM events
      WHERE user_name = $1 AND ${periodFilter(period)}
      GROUP BY label
      ORDER BY count DESC, label ASC
    `

    const [details, operations, tables] = await Promise.all([
      prisma.$queryRawUnsafe<DetailRow[]>(detailsSql, userName),
      prisma.$queryRawUnsafe<BreakdownRow[]>(operationsSql, userName),
      prisma.$queryRawUnsafe<BreakdownRow[]>(tablesSql, userName),
    ])

    return NextResponse.json({
      success: true,
      data: {
        userName,
        period,
        periodLabel: periodLabel(period),
        operations: details.map((row) => ({
          userName: row.user_name || 'Bilinmeyen',
          operationType: row.operation_type || 'Islem',
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
        operationSummary: operations.map((row) => ({
          label: row.label || 'Islem',
          count: toNumber(row.count),
        })),
        tableSummary: tables.map((row) => ({
          label: row.label || 'bilinmeyen',
          count: toNumber(row.count),
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
