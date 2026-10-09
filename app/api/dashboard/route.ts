import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { updateExpiredAssistanceStatuses } from '@/lib/services/assistanceExpiry.service'
import { requireApiAccess } from '@/lib/apiAuth'
import {
  getAssistanceStatusLabel,
  getDgnAssistanceStatusLabel,
} from '@/lib/services/assistanceStatusLabels.service'
import { getFileStatusLabel } from '@/lib/services/fileStatusLabels.service'
import { ensureKurbanCountsTable } from '@/lib/services/kurbanCounts.service'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import type { PredefinedValueTitlesMap, PredefinedValuesMap } from '@/lib/constants/predefinedValues'

export const dynamic = 'force-dynamic'

type CountRow = { count: bigint | number | string | null }
type StatusRow = { status: number | null; count: bigint | number | string | null }
type TypeRow = { type: string | null; count: bigint | number | string | null; amount: bigint | number | string | null }
type AssistanceFileReportRow = { label: string; count: bigint | number | string | null }
type InvestigationStaffReportRow = { label: string; count: bigint | number | string | null; amount: bigint | number | string | null }
type InvestigationStaffStageRow = { label: string; stage: string; count: bigint | number | string | null }
type PeriodAmountReportRow = { label: string; count: bigint | number | string | null; amount: bigint | number | string | null }
type AidPaymentPeriodReportRow = {
  year_label: string
  period_label: string
  aid_type: string
  count: bigint | number | string | null
  amount: bigint | number | string | null
  // Kullanici istegi: "Yardım Türü Ödeme Raporu"nda kartan odenen tutarin
  // yaninda GERCEKTEN fatura kesilen (alisveris) tutar da gorunsun - Gida,
  // Destek Paketi, Donem Disi Gida ve Giyim'in HEPSININ kendi
  // "alisverismiktari" sutunu var (bkz. asagidaki payment_rows CTE).
  shopping_amount: bigint | number | string | null
}
type AidCountPeriodReportRow = {
  year_label: string
  period_label: string
  aid_type: string
  count: bigint | number | string | null
}
type CashPeriodAidReportRow = {
  year_label: string
  period_label: string
  aid_type: string
  person_count: bigint | number | string | null
  amount: bigint | number | string | null
}
type DailyAssistanceMovementRow = {
  date: Date | string
  label: string
  group_label: string
  amount: bigint | number | string | null
}
type RequestedDocumentRow = {
  id: bigint | number | string
  file_id: bigint | number | string | null
  requested_date: Date | string | null
  file_no: string | null
  name: string | null
  document_title: string | null
  requested_by: string | null
}
type AssistanceAlertRow = {
  source_type: string
  record_id: bigint | number | string
  dosyano: string | null
  muracaateden: string | null
  tckimlikno: string | null
  bastarih: Date | string | null
  bittarih: Date | string | null
  miktar: bigint | number | string | null
  durumu: number | null
}
type ActiveTenderSummaryRow = {
  yil: number
  ihale_turu: string
  ihale_miktari: bigint | number | string | null
  teslim_alinan_miktar: bigint | number | string | null
  kalan_miktar: bigint | number | string | null
  gerceklesme_yuzdesi: bigint | number | string | null
  ihale_baslangic_tarihi: Date | string | null
  ihale_bitis_tarihi: Date | string | null
}
const dashboardCacheTtlMs = 30_000
const globalForDashboard = globalThis as unknown as {
  dashboardCache?: {
    cacheKey: string
    expiresAt: number
    payload: unknown
  }
}

function toNumber(value: bigint | number | string | null | undefined) {
  return Number(value ?? 0)
}

function toDateString(value: Date | string | null | undefined) {
  if (!value) return null
  return new Date(value).toISOString().slice(0, 10)
}

function isInputDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function getDefaultMovementRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 29)

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

function usesDgnAssistanceStatus(type: string | null | undefined) {
  const normalizedType = String(type ?? '').toLocaleLowerCase('tr-TR')
  return normalizedType.includes('dönem') ||
    normalizedType.includes('donem') ||
    normalizedType.includes('giyim') ||
    normalizedType.includes('nakit')
}

function mapAssistanceAlert(
  row: AssistanceAlertRow,
  predefinedValues: PredefinedValuesMap,
  predefinedTitles: PredefinedValueTitlesMap,
) {
  const usesDgnStatus = usesDgnAssistanceStatus(row.source_type)

  return {
    id: `${row.source_type}-${String(row.record_id)}`,
    type: row.source_type,
    fileNo: row.dosyano ?? '-',
    applicant: row.muracaateden ?? '-',
    identityNumber: row.tckimlikno ?? '-',
    startDate: toDateString(row.bastarih),
    endDate: toDateString(row.bittarih),
    amount: row.miktar === null ? '-' : String(row.miktar),
    statusCode: row.durumu === null ? '' : String(row.durumu),
    statusVariant: usesDgnStatus ? 'dgn' : 'default',
    status: usesDgnStatus
      ? getDgnAssistanceStatusLabel(predefinedValues, predefinedTitles, row.durumu)
      : getAssistanceStatusLabel(predefinedValues, row.durumu),
  }
}

function mapRequestedDocument(row: RequestedDocumentRow) {
  return {
    id: String(row.id),
    fileId: row.file_id === null ? null : String(row.file_id),
    requestedDate: toDateString(row.requested_date),
    fileNo: row.file_no ?? '-',
    name: row.name ?? '-',
    documentTitle: row.document_title ?? '-',
    requestedBy: row.requested_by ?? '-',
  }
}

export async function GET(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ page: '/dashboard' })
    if (accessDenied) return accessDenied

    await updateExpiredAssistanceStatuses()
    await ensureKurbanCountsTable()

    const { searchParams } = new URL(request.url)
    const defaultMovementRange = getDefaultMovementRange()
    let movementStartDate = isInputDate(searchParams.get('movementStartDate'))
      ? String(searchParams.get('movementStartDate'))
      : defaultMovementRange.startDate
    let movementEndDate = isInputDate(searchParams.get('movementEndDate'))
      ? String(searchParams.get('movementEndDate'))
      : defaultMovementRange.endDate

    if (movementStartDate > movementEndDate) {
      const previousStartDate = movementStartDate
      movementStartDate = movementEndDate
      movementEndDate = previousStartDate
    }

    const bypassCache = searchParams.has('refresh')
    const cacheKey = `dashboard:${movementStartDate}:${movementEndDate}`
    const now = Date.now()
    if (
      !bypassCache &&
      globalForDashboard.dashboardCache &&
      globalForDashboard.dashboardCache.cacheKey === cacheKey &&
      globalForDashboard.dashboardCache.expiresAt > now
    ) {
      const cachedData = (globalForDashboard.dashboardCache.payload as { data?: { totals?: { assistedBeneficiaries?: unknown }, requestedDocuments?: unknown, fileStatusSummary?: unknown, cashPeriodMonthlyReports?: unknown, cashPeriodYearlyReports?: unknown, cashPeriodAidReports?: unknown, activeTenderSummary?: unknown } })?.data
      if (
        typeof cachedData?.totals?.assistedBeneficiaries === 'number' &&
        Array.isArray(cachedData.requestedDocuments) &&
        Array.isArray(cachedData.fileStatusSummary) &&
        Array.isArray(cachedData.cashPeriodMonthlyReports) &&
        Array.isArray(cachedData.cashPeriodYearlyReports) &&
        Array.isArray(cachedData.cashPeriodAidReports) &&
        Array.isArray(cachedData.activeTenderSummary)
      ) {
        return NextResponse.json(globalForDashboard.dashboardCache.payload)
      }
    }

    const [
      fileCount,
      beneficiaryCount,
      assistanceCount,
      documentCount,
      totalAssistanceAmount,
      fileStatusRows,
      assistanceStatusRows,
      assistanceTypeRows,
      assistanceFileReportRows,
      investigationStaffReportRows,
      investigationStaffStageRows,
      dailyAssistanceMovementRows,
      requestedDocumentRows,
      fileStatusSummaryRows,
      cashPeriodMonthlyRows,
      cashPeriodYearlyRows,
      cashPeriodAidRows,
      aidPaymentPeriodRows,
      aidCountPeriodRows,
      activeTenderSummaryRows,
      predefinedSettings,
    ] = await Promise.all([
      prisma.request.count(),
      prisma.beneficiary.count(),
      prisma.assistance.count(),
      prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM beklenen_evraklar
        WHERE COALESCE(NULLIF(BTRIM(durum), ''), 'bekliyor') NOT IN ('tamamlandi', 'goruldu');
      `,
      prisma.assistance.aggregate({ _sum: { amount: true } }),
      prisma.$queryRaw<StatusRow[]>`
        SELECT durumu::int AS status, COUNT(*)::bigint AS count
        FROM dosyalar
        GROUP BY durumu
        ORDER BY count DESC
        LIMIT 6;
      `,
      prisma.$queryRaw<StatusRow[]>`
        SELECT durumu::int AS status, COUNT(*)::bigint AS count
        FROM yrd_ayninakti
        GROUP BY durumu
        ORDER BY count DESC
        LIMIT 6;
      `,
      prisma.$queryRaw<TypeRow[]>`
        SELECT COALESCE(NULLIF(asama, ''), 'Belirtilmedi') AS type,
               COUNT(*)::bigint AS count,
               COALESCE(SUM(miktar), 0)::bigint AS amount
        FROM yrd_ayninakti
        GROUP BY COALESCE(NULLIF(asama, ''), 'Belirtilmedi')
        ORDER BY count DESC
        LIMIT 6;
      `,
      prisma.$queryRaw<AssistanceFileReportRow[]>`
        WITH desired_reports(label, sort_order) AS (
          VALUES
            ('Gida'::text, 1),
            ('Ekmek'::text, 2),
            ('Destek Paketi'::text, 3),
            ('Hazir Yemek'::text, 4),
            ('Giyim'::text, 5)
        ),
        report_files AS (
          SELECT label, dosyaid
          FROM (
            SELECT 'Gida'::text AS label, t.dosyaid
            FROM yrd_gidabankasi t
            INNER JOIN dosyalar d ON d.id = t.dosyaid
            WHERE t.dosyaid IS NOT NULL AND t.durumu = 2 AND d.durumu = 3
            UNION ALL
            SELECT 'Ekmek'::text AS label, t.dosyaid
            FROM yrd_ekmek t
            INNER JOIN dosyalar d ON d.id = t.dosyaid
            WHERE t.dosyaid IS NOT NULL AND t.durumu = 2 AND d.durumu = 3
            UNION ALL
            SELECT 'Destek Paketi'::text AS label, t.dosyaid
            FROM yrd_destekpaketi t
            INNER JOIN dosyalar d ON d.id = t.dosyaid
            WHERE t.dosyaid IS NOT NULL AND t.durumu = 2 AND d.durumu = 3
            UNION ALL
            SELECT 'Hazir Yemek'::text AS label, t.dosyaid
            FROM yrd_haziryemek t
            INNER JOIN dosyalar d ON d.id = t.dosyaid
            WHERE t.dosyaid IS NOT NULL AND t.durumu = 2 AND d.durumu = 3
            UNION ALL
            SELECT 'Giyim'::text AS label, t.dosyaid
            FROM yrd_giyim t
            INNER JOIN dosyalar d ON d.id = t.dosyaid
            WHERE t.dosyaid IS NOT NULL AND t.durumu = 6 AND d.durumu = 3
          ) source_reports
        )
        SELECT desired_reports.label,
               COUNT(DISTINCT report_files.dosyaid)::bigint AS count
        FROM desired_reports
        LEFT JOIN report_files ON report_files.label = desired_reports.label
        GROUP BY desired_reports.label, desired_reports.sort_order
        ORDER BY desired_reports.sort_order ASC;
      `,
      prisma.$queryRaw<InvestigationStaffReportRow[]>`
        SELECT COALESCE(NULLIF(TRIM(tahkikatpers), ''), 'Belirtilmedi') AS label,
               COUNT(*)::bigint AS count,
               COALESCE(SUM(miktar), 0)::bigint AS amount
        FROM yrd_ayninakti
        WHERE durumu = 0
        GROUP BY COALESCE(NULLIF(TRIM(tahkikatpers), ''), 'Belirtilmedi')
        ORDER BY count DESC, label ASC;
      `,
      prisma.$queryRaw<InvestigationStaffStageRow[]>`
        SELECT COALESCE(NULLIF(TRIM(tahkikatpers), ''), 'Belirtilmedi') AS label,
               COALESCE(NULLIF(TRIM(asama), ''), 'Belirtilmedi') AS stage,
               COUNT(*)::bigint AS count
        FROM yrd_ayninakti
        WHERE durumu = 0
        GROUP BY
          COALESCE(NULLIF(TRIM(tahkikatpers), ''), 'Belirtilmedi'),
          COALESCE(NULLIF(TRIM(asama), ''), 'Belirtilmedi')
        ORDER BY count DESC, stage ASC;
      `,
      prisma.$queryRaw<DailyAssistanceMovementRow[]>`
        WITH days AS (
          SELECT generate_series(
            (${movementStartDate})::date,
            (${movementEndDate})::date,
            interval '1 day'
          )::date AS day
        ),
        groups AS (
          SELECT DISTINCT COALESCE(NULLIF(BTRIM(yardimtip), ''), 'Belirtilmeyen') AS group_label
          FROM yardim_hareketleri
          WHERE tarih >= (${movementStartDate})::date
            AND tarih < (${movementEndDate})::date + interval '1 day'
        ),
        totals AS (
          SELECT
            y.tarih::date AS day,
            COALESCE(NULLIF(BTRIM(y.yardimtip), ''), 'Belirtilmeyen') AS group_label,
            COALESCE(SUM(y.miktar), 0) AS amount
          FROM yardim_hareketleri y
          WHERE y.tarih >= (${movementStartDate})::date
            AND y.tarih < (${movementEndDate})::date + interval '1 day'
          GROUP BY y.tarih::date, COALESCE(NULLIF(BTRIM(y.yardimtip), ''), 'Belirtilmeyen')
        )
        SELECT
          days.day AS date,
          to_char(days.day, 'DD.MM') AS label,
          groups.group_label,
          COALESCE(totals.amount, 0) AS amount
        FROM days
        CROSS JOIN groups
        LEFT JOIN totals ON totals.day = days.day AND totals.group_label = groups.group_label
        ORDER BY days.day ASC, groups.group_label ASC;
      `,
      prisma.$queryRaw<RequestedDocumentRow[]>`
        SELECT
          e.id::bigint AS id,
          COALESCE(d_by_no.id, d_by_id.id, e.dosyaid)::bigint AS file_id,
          COALESCE(e.istenme_tarihi, e.created_at)::date AS requested_date,
          COALESCE(e.dosyano, d_by_no.dosyano, d_by_id.dosyano) AS file_no,
          e.adisoyadi AS name,
          e.evrak_adi AS document_title,
          e.isteyen_kullanici AS requested_by
        FROM beklenen_evraklar e
        LEFT JOIN LATERAL (
          SELECT d.id, d.dosyano
          FROM dosyalar d
          WHERE NULLIF(BTRIM(e.dosyano), '') IS NOT NULL
            AND BTRIM(d.dosyano) = BTRIM(e.dosyano)
          ORDER BY d.id DESC
          LIMIT 1
        ) d_by_no ON TRUE
        LEFT JOIN dosyalar d_by_id ON d_by_id.id = e.dosyaid
        WHERE COALESCE(NULLIF(BTRIM(e.durum), ''), 'bekliyor') NOT IN ('tamamlandi', 'goruldu')
        ORDER BY COALESCE(e.istenme_tarihi, e.created_at) DESC NULLS LAST, e.id DESC;
      `,
      prisma.$queryRaw<StatusRow[]>`
        WITH desired_statuses(status) AS (
          VALUES (0), (1), (2), (3), (4)
        ),
        status_counts AS (
          SELECT durumu::int AS status, COUNT(*)::bigint AS count
          FROM dosyalar
          WHERE durumu IN (0, 1, 2, 3, 4)
          GROUP BY durumu
        )
        SELECT desired_statuses.status,
               COALESCE(status_counts.count, 0)::bigint AS count
        FROM desired_statuses
        LEFT JOIN status_counts ON status_counts.status = desired_statuses.status
        ORDER BY desired_statuses.status ASC;
      `,
      prisma.$queryRaw<PeriodAmountReportRow[]>`
        SELECT COALESCE(NULLIF(TRIM(donem::text), ''), 'Belirtilmedi') AS label,
               COUNT(*)::bigint AS count,
               COALESCE(SUM(miktar), 0)::bigint AS amount
        FROM yrd_ayninakti
        WHERE durumu = 6
        GROUP BY COALESCE(NULLIF(TRIM(donem::text), ''), 'Belirtilmedi')
        ORDER BY label DESC;
      `,
      prisma.$queryRaw<PeriodAmountReportRow[]>`
        WITH cash_periods AS (
          SELECT
            CASE
              WHEN TRIM(donem::text) ~ '[0-9]{4}' THEN SUBSTRING(TRIM(donem::text) FROM '[0-9]{4}')
              ELSE 'Belirtilmedi'
            END AS label,
            miktar
          FROM yrd_ayninakti
          WHERE durumu = 6
        )
        SELECT label,
               COUNT(*)::bigint AS count,
               COALESCE(SUM(miktar), 0)::bigint AS amount
        FROM cash_periods
        GROUP BY label
        ORDER BY label DESC;
      `,
      prisma.$queryRaw<CashPeriodAidReportRow[]>`
        WITH cash_periods AS (
          SELECT
            CASE
              WHEN TRIM(donem::text) ~ '[0-9]{4}' THEN SUBSTRING(TRIM(donem::text) FROM '[0-9]{4}')
              ELSE 'Belirtilmedi'
            END AS year_label,
            COALESCE(NULLIF(TRIM(donem::text), ''), 'Belirtilmedi') AS period_label,
            COALESCE(NULLIF(TRIM(asama), ''), 'Belirtilmedi') AS aid_type,
            COALESCE(NULLIF(TRIM(tckimlikno), ''), NULLIF(TRIM(muracaateden), ''), id::text) AS person_key,
            miktar
          FROM yrd_ayninakti
          WHERE durumu = 6
        )
        SELECT year_label,
               period_label,
               aid_type,
               COUNT(DISTINCT person_key)::bigint AS person_count,
               COALESCE(SUM(miktar), 0)::bigint AS amount
        FROM cash_periods
        GROUP BY year_label, period_label, aid_type
        ORDER BY year_label DESC, period_label DESC, aid_type ASC;
      `,
      prisma.$queryRaw<AidPaymentPeriodReportRow[]>`
        WITH payment_rows AS (
          SELECT
            'Gida'::text AS aid_type,
            COALESCE(
              CASE
                WHEN TRIM(COALESCE(h.donemadi, '')) ~ '^[0-9]{2}-[0-9]{4}$'
                  THEN SUBSTRING(TRIM(h.donemadi) FROM '[0-9]{4}$')
                ELSE NULL
              END,
              to_char(h.islemtarihi, 'YYYY'),
              'Belirtilmedi'
            ) AS year_label,
            COALESCE(
              CASE
                WHEN TRIM(COALESCE(h.donemadi, '')) ~ '^[0-9]{2}-[0-9]{4}$'
                  THEN TRIM(h.donemadi)
                ELSE NULL
              END,
              to_char(h.islemtarihi, 'YYYY-MM'),
              'Belirtilmedi'
            ) AS period_label,
            h.miktar::numeric AS amount,
            h.alisverismiktari::numeric AS shopping_amount
          FROM yrd_gidabankasihrk h
          WHERE lower(trim(COALESCE(h.islemadi, ''))) IN (
            'ode', 'öde', 'Ã¶de',
            'odeme yapildi', 'ödeme yapıldı', 'Ã¶deme yapÄ±ldÄ±'
          )
          UNION ALL
          SELECT
            'Destek Paketi'::text AS aid_type,
            COALESCE(to_char(h.islemtarihi, 'YYYY'), 'Belirtilmedi') AS year_label,
            COALESCE(to_char(h.islemtarihi, 'YYYY-MM'), 'Belirtilmedi') AS period_label,
            h.miktar::numeric AS amount,
            h.alisverismiktari::numeric AS shopping_amount
          FROM yrd_destekpaketihrk h
          WHERE lower(trim(COALESCE(h.islemadi, ''))) IN (
            'ode', 'öde', 'Ã¶de',
            'odeme yapildi', 'ödeme yapıldı', 'Ã¶deme yapÄ±ldÄ±'
          )
          UNION ALL
          SELECT
            'Donem Disi Gida'::text AS aid_type,
            COALESCE(to_char(t.durumutarih, 'YYYY'), 'Belirtilmedi') AS year_label,
            COALESCE(to_char(t.durumutarih, 'YYYY-MM'), 'Belirtilmedi') AS period_label,
            t.miktar::numeric AS amount,
            t.alisverismiktari::numeric AS shopping_amount
          FROM yrd_ddgidadosyali t
          WHERE t.durumu = 6
          UNION ALL
          SELECT
            'Giyim'::text AS aid_type,
            COALESCE(to_char(t.durumutarih, 'YYYY'), 'Belirtilmedi') AS year_label,
            COALESCE(to_char(t.durumutarih, 'YYYY-MM'), 'Belirtilmedi') AS period_label,
            t.miktar::numeric AS amount,
            t.alisverismiktari::numeric AS shopping_amount
          FROM yrd_giyim t
          WHERE t.durumu = 6
        )
        SELECT
          year_label,
          period_label,
          aid_type,
          COUNT(*)::bigint AS count,
          COALESCE(SUM(amount), 0)::bigint AS amount,
          COALESCE(SUM(shopping_amount), 0)::bigint AS shopping_amount
        FROM payment_rows
        GROUP BY year_label, period_label, aid_type
        ORDER BY year_label DESC, period_label DESC, aid_type ASC;
      `,
      prisma.$queryRaw<AidCountPeriodReportRow[]>`
        WITH count_rows AS (
          SELECT
            'Aceze'::text AS aid_type,
            COALESCE(to_char(t.tarih, 'YYYY'), 'Belirtilmedi') AS year_label,
            COALESCE(to_char(t.tarih, 'YYYY-MM'), 'Belirtilmedi') AS period_label,
            1::numeric AS count_value
          FROM yrd_aceze t
          UNION ALL
          SELECT
            CONCAT(k.kurban_turu, ' / ', k.kurban_cinsi)::text AS aid_type,
            COALESCE(to_char(k.tarih, 'YYYY'), 'Belirtilmedi') AS year_label,
            COALESCE(to_char(k.tarih, 'YYYY-MM'), 'Belirtilmedi') AS period_label,
            k.adet::numeric AS count_value
          FROM yrd_kurban k
        )
        SELECT
          year_label,
          period_label,
          aid_type,
          COALESCE(SUM(count_value), 0)::bigint AS count
        FROM count_rows
        GROUP BY year_label, period_label, aid_type
        ORDER BY year_label DESC, period_label DESC, aid_type ASC;
      `,
      prisma.$queryRaw<ActiveTenderSummaryRow[]>`
        SELECT h.yil, h.ihale_turu, h.ihale_miktari,
               h.teslim_alinan_miktar,
               GREATEST(h.ihale_miktari - h.teslim_alinan_miktar, 0) AS kalan_miktar,
               CASE WHEN h.ihale_miktari > 0
                 THEN ROUND((h.teslim_alinan_miktar / h.ihale_miktari) * 100, 2)
                 ELSE 0 END AS gerceklesme_yuzdesi,
               h.ihale_baslangic_tarihi, h.ihale_bitis_tarihi
        FROM public."hakediş_rapor" h
        WHERE COALESCE(h.ihale_baslangic_tarihi, TO_DATE(h.yil::text || '-01-01', 'YYYY-MM-DD')) <= CURRENT_DATE
          AND COALESCE(h.ihale_bitis_tarihi, TO_DATE(h.yil::text || '-12-31', 'YYYY-MM-DD')) >= CURRENT_DATE
        ORDER BY CASE h.ihale_turu WHEN 'ekmek' THEN 1 WHEN 'hazir_yemek' THEN 2 WHEN 'kahvalti' THEN 3 ELSE 4 END,
                 h.id DESC;
      `,
      predefinedValuesService.getAll(),
    ])

    const activeFileRows = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM dosyalar
      WHERE durumu IS NULL OR durumu NOT IN (4, 5, 6);
    `

    const assistedFileRows = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM dosyalar
      WHERE durumu = 3;
    `

    const assistedBeneficiaryRows = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM bireyler b
      INNER JOIN dosyalar d ON d.id = b.dosyaid
      WHERE d.durumu = 3;
    `

    const assistanceAlertRows = await prisma.$queryRaw<AssistanceAlertRow[]>`
      SELECT * FROM (
        SELECT 'Ekmek'::text AS source_type, t.id::bigint AS record_id, d.dosyano, t.muracaateden,
               b.tckimlikno AS tckimlikno, t.bastarih, t.bittarih,
               t.miktar::text AS miktar, t.durumu::int AS durumu
        FROM yrd_ekmek t
        LEFT JOIN dosyalar d ON d.id = t.dosyaid
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden

        UNION ALL

        SELECT 'Gıda'::text AS source_type, t.id::bigint AS record_id, d.dosyano, t.muracaateden,
               b.tckimlikno AS tckimlikno, t.bastarih, t.bittarih,
               t.miktar::text AS miktar, t.durumu::int AS durumu
        FROM yrd_gidabankasi t
        LEFT JOIN dosyalar d ON d.id = t.dosyaid
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden

        UNION ALL

        SELECT 'Destek Paketi'::text AS source_type, t.id::bigint AS record_id, d.dosyano, t.muracaateden,
               b.tckimlikno AS tckimlikno, t.bastarih, t.bittarih,
               t.miktar::text AS miktar, t.durumu::int AS durumu
        FROM yrd_destekpaketi t
        LEFT JOIN dosyalar d ON d.id = t.dosyaid
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden

        UNION ALL

        SELECT 'Hazır Yemek'::text AS source_type, t.id::bigint AS record_id, d.dosyano, t.muracaateden,
               b.tckimlikno AS tckimlikno, t.bastarih, t.bittarih,
               COALESCE(t.miktar, t.kisisayisi, t.ekmekmiktari)::text AS miktar, t.durumu::int AS durumu
        FROM yrd_haziryemek t
        LEFT JOIN dosyalar d ON d.id = t.dosyaid
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden

        UNION ALL

        SELECT 'Dönem Dışı Gıda'::text AS source_type, t.id::bigint AS record_id, d.dosyano, t.muracaateden,
               b.tckimlikno AS tckimlikno, NULL::date AS bastarih, t.bittarih,
               t.miktar::text AS miktar, t.durumu::int AS durumu
        FROM yrd_ddgidadosyali t
        LEFT JOIN dosyalar d ON d.id = t.dosyaid
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
      ) alerts
      WHERE (bastarih BETWEEN CURRENT_DATE - interval '10 days' AND CURRENT_DATE)
         OR (bittarih BETWEEN CURRENT_DATE AND CURRENT_DATE + interval '10 days')
      ORDER BY COALESCE(bittarih, bastarih) ASC NULLS LAST, source_type ASC
    `

    const recentStarts = assistanceAlertRows
      .filter((row) => {
        if (!row.bastarih) return false
        const start = new Date(row.bastarih)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tenDaysAgo = new Date(today)
        tenDaysAgo.setDate(today.getDate() - 10)
        return start >= tenDaysAgo && start <= today
      })
      .map((row) => mapAssistanceAlert(row, predefinedSettings.values, predefinedSettings.titles))

    const endingSoon = assistanceAlertRows
      .filter((row) => {
        if (!row.bittarih) return false
        const end = new Date(row.bittarih)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tenDaysLater = new Date(today)
        tenDaysLater.setDate(today.getDate() + 10)
        return end >= today && end <= tenDaysLater
      })
      .map((row) => mapAssistanceAlert(row, predefinedSettings.values, predefinedSettings.titles))

    const payload = {
      success: true,
      data: {
        totals: {
          files: fileCount,
          activeFiles: toNumber(activeFileRows[0]?.count),
          statusTwoFiles: toNumber(assistedFileRows[0]?.count),
          beneficiaries: beneficiaryCount,
          assistedBeneficiaries: toNumber(assistedBeneficiaryRows[0]?.count),
          assistances: assistanceCount,
          documents: toNumber(documentCount[0]?.count),
          assistanceAmount: totalAssistanceAmount._sum.amount ?? 0,
        },
        fileStatuses: fileStatusRows.map((row) => ({
          label: getFileStatusLabel(predefinedSettings.values, row.status, 'Belirtilmedi'),
          value: toNumber(row.count),
        })),
        // Kullanici istegi: "Dosya Durum Bilgisi" widget'inda hangi ozete
        // tiklarsa tiklasin, digerleri gibi o durumdaki dosyalarin listesini
        // acsin - bunun icin frontend'in bir filtre linki kurabilmesi
        // gerekiyor, bu yuzden ham durum kodu ("code") da eklendi (etiket
        // TEK BASINA yeterli degil - /documents/all sayfasi durumu SAYISAL
        // koduyla filtreliyor, TR etiket metniyle degil).
        fileStatusSummary: fileStatusSummaryRows.map((row) => ({
          label: getFileStatusLabel(predefinedSettings.values, row.status, 'Belirtilmedi'),
          value: toNumber(row.count),
          code: row.status,
        })),
        assistanceStatuses: assistanceStatusRows.map((row) => ({
          label: getDgnAssistanceStatusLabel(predefinedSettings.values, predefinedSettings.titles, row.status, 'Belirtilmedi'),
          value: toNumber(row.count),
        })),
        assistanceTypes: assistanceTypeRows.map((row) => ({
          label: row.type ?? 'Belirtilmedi',
          value: toNumber(row.count),
          amount: toNumber(row.amount),
        })),
        assistanceFileReports: assistanceFileReportRows.map((row) => ({
          label: row.label,
          value: toNumber(row.count),
        })),
        investigationStaffReports: investigationStaffReportRows.map((row) => ({
          label: row.label,
          value: toNumber(row.count),
          amount: toNumber(row.amount),
          stages: investigationStaffStageRows
            .filter((stageRow) => stageRow.label === row.label)
            .map((stageRow) => ({
              label: stageRow.stage,
              value: toNumber(stageRow.count),
            })),
        })),
        cashPeriodMonthlyReports: cashPeriodMonthlyRows.map((row) => ({
          label: row.label,
          value: toNumber(row.count),
          amount: toNumber(row.amount),
        })),
        cashPeriodYearlyReports: cashPeriodYearlyRows.map((row) => ({
          label: row.label,
          value: toNumber(row.count),
          amount: toNumber(row.amount),
        })),
        cashPeriodAidReports: cashPeriodAidRows.map((row) => ({
          year: row.year_label,
          period: row.period_label,
          type: row.aid_type,
          people: toNumber(row.person_count),
          amount: toNumber(row.amount),
        })),
        aidPaymentPeriodReports: aidPaymentPeriodRows.map((row) => ({
          year: row.year_label,
          period: row.period_label,
          type: row.aid_type,
          count: toNumber(row.count),
          amount: toNumber(row.amount),
          shoppingAmount: toNumber(row.shopping_amount),
        })),
        aidCountPeriodReports: aidCountPeriodRows.map((row) => ({
          year: row.year_label,
          period: row.period_label,
          type: row.aid_type,
          count: toNumber(row.count),
        })),
        activeTenderSummary: activeTenderSummaryRows.map((row) => ({
          year: row.yil,
          type: row.ihale_turu,
          tenderAmount: toNumber(row.ihale_miktari),
          deliveredAmount: toNumber(row.teslim_alinan_miktar),
          remainingAmount: toNumber(row.kalan_miktar),
          progress: toNumber(row.gerceklesme_yuzdesi),
          startDate: toDateString(row.ihale_baslangic_tarihi),
          endDate: toDateString(row.ihale_bitis_tarihi),
        })),
        // Hata raporu duzeltmesi: "özet veriler gelmiyor/çok geç geliyor" -
        // getUserDailyActivityReport() (bu ay boyunca TUM sistem hareket/
        // denetim kayitlarini isleyen, canli veride 70+ SANIYE surebilen
        // AGIR bir sorgu) artik BURADAKI Promise.all'un parcasi DEGIL - ayri
        // bir uçtan (bkz. app/api/dashboard/user-performance) BAGIMSIZ
        // olarak cekiliyor, boylece basit "Toplam Dosya" gibi degerler bile
        // o agir sorgu bitene kadar bekletilmiyor. Bu alan geriye donuk
        // uyumluluk icin bos dizi olarak kalir.
        userDailyPerformance: [] as never[],
        dailyAssistanceMovements: dailyAssistanceMovementRows.map((row) => ({
          date: toDateString(row.date),
          label: row.label,
          group: row.group_label,
          amount: toNumber(row.amount),
        })),
        requestedDocuments: requestedDocumentRows.map(mapRequestedDocument),
        assistanceAlerts: {
          recentStarts,
          endingSoon,
        },
      },
    }

    globalForDashboard.dashboardCache = {
      cacheKey,
      expiresAt: now + dashboardCacheTtlMs,
      payload,
    }

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
