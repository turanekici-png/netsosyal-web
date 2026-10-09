import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, prepareSqlSearchTerm } from '@/lib/utils'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { OTOMATIK_RED_STAGE } from '@/lib/services/cashAutoReject.service'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-09-28): "online islemlerdeki kaydı nakit
// yardımları tablosuna taşırken kayıt sırasında alınan adres bilgisini
// taşıyalım ve nakit yardımları listesinde bu adres bilgisinide görelim" -
// yrd_ayninakti tablosunda ayri bir "adres" kolonu YOKTU (adres bilgisi
// eskiden sadece muracaatnotu icine gomulu metin olarak aktariliyordu,
// listede AYRI bir sutun olarak gorunmuyordu). "yrd_destekpaketi.odemegunu"
// icin kullanilan AYNI "kendi kendini onaran" desen (bkz.
// assistancePeriod.service.ts - ensureDestekPaketiOdemegunuColumn).
let yrdAyninaktiAdresColumnEnsured = false

async function ensureYrdAyninaktiAdresColumn(pool: ReturnType<typeof getSqlMonitorPool>) {
  if (yrdAyninaktiAdresColumnEnsured) return

  const columnResult = await pool.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'yrd_ayninakti'
      AND column_name = 'adres';
  `)

  if (columnResult.rows.length === 0) {
    await pool.query(`ALTER TABLE public.yrd_ayninakti ADD COLUMN adres TEXT;`)
  }

  yrdAyninaktiAdresColumnEnsured = true
}

type TransferPayload = {
  mode?: 'selected' | 'filtered'
  ids?: Array<string | number>
  filters?: Record<string, string>
}

const fullNameSql = `
  COALESCE(
    NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(t.ad, ''), NULLIF(t.soyad, ''))), ''),
    NULLIF(t.answers->>'fullName', ''),
    NULLIF(t.answers->>'f_name', '')
  )
`

const phoneSql = `COALESCE(NULLIF(t.answers->>'phone', ''), NULLIF(t.answers->>'f_phone', ''), NULLIF(t.answers->>'telefon', ''))`
const incomeSql = `COALESCE(NULLIF(t.answers->>'income', ''), NULLIF(t.answers->>'f_income', ''))`
const vehicleStatusSql = `COALESCE(NULLIF(t.answers->>'vehicleStatus', ''), NULLIF(t.answers->>'f_1783585922150', ''))`
const vehicleModelYearSql = `COALESCE(NULLIF(t.answers->>'vehicleModelYear', ''), NULLIF(t.answers->>'f_1783665438908', ''))`
const ibanSql = `COALESCE(NULLIF(t.answers->>'iban', ''), NULLIF(t.answers->>'f_1783668607481', ''))`
const propertySql = `COALESCE(NULLIF(t.answers->>'propertyInfo', ''), NULLIF(t.answers->>'property', ''), NULLIF(t.answers->>'mulkiyet', ''), NULLIF(t.answers->>'mulkiyetBilgisi', ''))`
const amountSql = `COALESCE(NULLIF(t.answers->>'amount', ''), NULLIF(t.answers->>'miktar', ''), NULLIF(t.answers->>'assistanceAmount', ''), NULLIF(t.answers->>'yardimMiktari', ''), NULLIF(t.answers->>'yardim_miktari', ''), NULLIF(t.answers->>'f_amount', ''))`
const periodSql = `COALESCE(NULLIF(t.donem, ''), NULLIF(t.answers->>'period', ''), NULLIF(t.answers->>'donem', ''))`

const FILTER_COLUMN_MAP: Record<string, string> = {
  id: 't.id',
  basvuru_tarihi: 't.created_at',
  tc: 't.tckimlikno',
  ad_soyad: fullNameSql,
  dogum_tarihi: 't.dogumtarihi',
  telefon: phoneSql,
  aylik_gelir: incomeSql,
  arac_durumu: vehicleStatusSql,
  arac_modeli: vehicleModelYearSql,
  iban: ibanSql,
  miktar: amountSql,
  mulkiyet_bilgisi: propertySql,
  yardim_turu: 't.yardim_turu',
  mahalle: 't.mahalleadi',
  adres: 't.adres',
  durum: 't.status',
  donem: periodSql,
  etiket: 't.etiket',
  asama: 't.asama',
  aciklama: 't.aciklama',
  basvuru_yili: 't.basvuru_yili',
  donem_grubu: 't.donem_grubu',
}

function normalizeIds(ids: TransferPayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

function hasActiveFilter(filters: Record<string, string>) {
  return Boolean(String(filters.search || '').trim()) || Object.entries(filters).some(([key, value]) => key.startsWith('f_') && value)
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'online.forms.manage', page: '/online' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as TransferPayload
  const mode = payload.mode === 'selected' ? 'selected' : 'filtered'
  const ids = normalizeIds(payload.ids)
  const filters = payload.filters || {}

  if (mode === 'selected' && ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Aktarilacak kayit secilmedi.' }, { status: 400 })
  }

  if (mode === 'filtered' && !hasActiveFilter(filters)) {
    return NextResponse.json({ success: false, error: 'Filtreli aktarim icin once arama veya filtre uygulayin.' }, { status: 400 })
  }

  const params: Array<string | string[]> = []
  let whereCondition = ''

  if (mode === 'selected') {
    params.push(ids)
    whereCondition = `t.id::text = ANY($${params.length}::text[])`
  } else {
    const safeSearchTerm = prepareSqlSearchTerm(String(filters.search || '').trim())
    const filterCondition = buildMappedFilterCondition(filters, FILTER_COLUMN_MAP)
    const searchCondition = safeSearchTerm
      ? ` AND (
          t.tckimlikno ILIKE '%${safeSearchTerm}%'
          OR ${fullNameSql} ILIKE '%${safeSearchTerm}%'
          OR ${phoneSql} ILIKE '%${safeSearchTerm}%'
          OR ${incomeSql} ILIKE '%${safeSearchTerm}%'
          OR ${vehicleStatusSql} ILIKE '%${safeSearchTerm}%'
          OR ${vehicleModelYearSql} ILIKE '%${safeSearchTerm}%'
          OR ${ibanSql} ILIKE '%${safeSearchTerm}%'
          OR ${amountSql} ILIKE '%${safeSearchTerm}%'
          OR ${propertySql} ILIKE '%${safeSearchTerm}%'
          OR t.yardim_turu ILIKE '%${safeSearchTerm}%'
          OR t.mahalleadi ILIKE '%${safeSearchTerm}%'
          OR t.adres ILIKE '%${safeSearchTerm}%'
          OR t.status ILIKE '%${safeSearchTerm}%'
          OR t.aciklama ILIKE '%${safeSearchTerm}%'
          OR t.answers::text ILIKE '%${safeSearchTerm}%'
        )`
      : ''

    whereCondition = `1=1 ${filterCondition} ${searchCondition}`
  }

  try {
    const pool = getSqlMonitorPool()
    await ensureYrdAyninaktiAdresColumn(pool)
    const result = await withAuditedPoolWrite(pool, (client) => client.query(
      `
        WITH candidates AS (
          SELECT
            t.id AS online_id,
            t.created_at,
            NULLIF(BTRIM(t.tckimlikno), '') AS tc,
            ${fullNameSql} AS ad_soyad,
            NULLIF(t.dogumtarihi, '') AS dogum_tarihi,
            ${phoneSql} AS telefon,
            ${ibanSql} AS iban,
            ${incomeSql} AS aylik_gelir,
            ${vehicleStatusSql} AS arac_durumu,
            ${vehicleModelYearSql} AS arac_modeli,
            ${amountSql} AS miktar,
            ${propertySql} AS mulkiyet_bilgisi,
            NULLIF(t.adres, '') AS adres,
            NULLIF(t.adresno, '') AS adresno,
            ${periodSql} AS donem,
            NULLIF(t.etiket, '') AS etiket,
            COALESCE(NULLIF(t.asama, ''), 'Online Basvuru') AS asama,
            NULLIF(t.aciklama, '') AS aciklama
          FROM public.online_basvurular t
          WHERE ${whereCondition}
        ),
        source_rows AS (
          SELECT
            c.*,
            b.dosyaid,
            CASE
              WHEN NULLIF(c.mulkiyet_bilgisi, '') IS NOT NULL THEN c.mulkiyet_bilgisi
              WHEN d.mulkiyetdurumu = 1 THEN 'Kendi Evi'
              WHEN d.mulkiyetdurumu = 2 THEN 'Kira'
              WHEN d.mulkiyetdurumu IN (3, 4) THEN 'Yakınının Evi'
              WHEN d.mulkiyetdurumu = 5 THEN 'Lojman'
              WHEN d.mulkiyetdurumu = 6 THEN 'Diğer'
              ELSE NULL
            END AS resolved_mulkiyet_bilgisi,
            NULLIF(REGEXP_REPLACE(COALESCE(c.aylik_gelir, ''), '[^0-9]', '', 'g'), '')::int AS resolved_aylik_gelir,
            CASE
              WHEN c.arac_modeli IS NOT NULL THEN CONCAT('Evet - ', REGEXP_REPLACE(c.arac_modeli, '[^0-9]', '', 'g'))
              WHEN LOWER(COALESCE(c.arac_durumu, '')) IN ('var', 'evet') THEN 'Evet'
              WHEN LOWER(COALESCE(c.arac_durumu, '')) IN ('yok', 'hayır', 'hayir') THEN 'Hayır'
              ELSE NULLIF(c.arac_durumu, '')
            END AS resolved_arac_bilgisi,
            NULLIF(REGEXP_REPLACE(REPLACE(COALESCE(c.miktar, ''), ',', '.'), '[^0-9]', '', 'g'), '')::int AS resolved_miktar,
            ROW_NUMBER() OVER (
              PARTITION BY c.tc, COALESCE(c.donem, '')
              ORDER BY c.created_at DESC NULLS LAST, c.online_id DESC
            ) AS transfer_rank,
            CONCAT('ONLINE:', c.online_id::text) AS online_key
          FROM candidates c
          LEFT JOIN public.bireyler b ON b.tckimlikno = c.tc
          LEFT JOIN public.dosyalar d ON d.id = b.dosyaid
          WHERE c.tc IS NOT NULL
            AND c.ad_soyad IS NOT NULL
        ),
        same_period_duplicates AS (
          SELECT s.online_id
          FROM source_rows s
          WHERE s.transfer_rank = 1
            AND EXISTS (
              SELECT 1
              FROM public.yrd_ayninakti y
              WHERE BTRIM(COALESCE(y.tckimlikno, '')) = s.tc
                AND COALESCE(NULLIF(BTRIM(y.donem), ''), '') = COALESCE(NULLIF(BTRIM(s.donem), ''), '')
            )
        ),
        insert_rows AS (
          SELECT s.*
          FROM source_rows s
          WHERE s.transfer_rank = 1
            AND NOT EXISTS (
              SELECT 1
              FROM same_period_duplicates dup
              WHERE dup.online_id = s.online_id
            )
        ),
        inserted AS (
          INSERT INTO public.yrd_ayninakti (
            dosyaid,
            muracaateden,
            muracaattarihi,
            muracaatnotu,
            durumu,
            durumutarih,
            durumuaciklama,
            donem,
            tckimlikno,
            ceptel,
            asama,
            miktar,
            aylikgelir,
            iban,
            etiket,
            dogumtarihi,
            mulkiyetbilgisi,
            aracbilgisi,
            asamaozelkod,
            ilkislemtarihi,
            islemtarihi,
            adres
          )
          SELECT
            s.dosyaid,
            LEFT(s.ad_soyad, 100),
            COALESCE(s.created_at::date, CURRENT_DATE),
            CONCAT(
              'Online basvuru ID: ', s.online_id::text,
              '; Adres No: ', COALESCE(s.adresno, '-'),
              '; Adres: ', COALESCE(s.adres, '-'),
              CASE WHEN s.aciklama IS NULL THEN '' ELSE CONCAT('; Aciklama: ', s.aciklama) END
            ),
            0,
            CURRENT_DATE,
            -- Kullanici istegi (2026-09-29): "otomatik red açıklaması aynı
            -- zamanda nakit yardımları tablosunda da görünsün" - online
            -- basvuru asamasi "Otomatik Red" ise (bkz. online-applications/
            -- route.ts - applicationStage), o basvurunun aciklamasi (gercek
            -- red sebebi metni) buraya, GENEL "Online basvurudan aktarildi"
            -- mesaji YERINE yazilir - boylece personel listede aktarim
            -- sonrasi da NEDEN reddedildigini gorebilir.
            CASE
              WHEN s.asama = '${OTOMATIK_RED_STAGE}' AND NULLIF(s.aciklama, '') IS NOT NULL THEN LEFT(s.aciklama, 100)
              ELSE 'Online basvurudan aktarildi'
            END,
            LEFT(s.donem, 50),
            LEFT(s.tc, 20),
            LEFT(s.telefon, 20),
            LEFT(s.asama, 50),
            s.resolved_miktar,
            s.resolved_aylik_gelir,
            LEFT(s.iban, 45),
            LEFT(s.etiket, 100),
            CASE
              WHEN s.dogum_tarihi ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN s.dogum_tarihi::date
              ELSE NULL
            END,
            LEFT(s.resolved_mulkiyet_bilgisi, 20),
            LEFT(s.resolved_arac_bilgisi, 30),
            s.online_key,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            s.adres
          FROM insert_rows s
          RETURNING id, dosyaid
        ),
        deleted_online AS (
          -- Kullanici istegi (2026-09-28): "aktarılan online müracatların
          -- online başvurulardaki kaydını sil, aynı anda hem nakit
          -- yardımları tablosunda hemde online müracaatlar tablosunda
          -- olmasın" - basariyla yrd_ayninakti'ye AKTARILAN (insert_rows)
          -- kayitlar, online_basvurular'dan silinir. Aktarilmayan (mukerrer
          -- oldugu icin atlanan same_period_duplicates/source_duplicates)
          -- kayitlar BILEREK silinmez - onlar bu islemde HICBIR YERE
          -- aktarilmadi, online_basvurular'da tek kayitlari onlar.
          DELETE FROM public.online_basvurular
          WHERE id IN (SELECT online_id FROM insert_rows)
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*)::int FROM candidates) AS examined,
          (SELECT COUNT(*)::int FROM inserted) AS inserted,
          0::int AS updated,
          (SELECT COUNT(*)::int FROM inserted WHERE dosyaid IS NOT NULL) AS linked,
          (SELECT COUNT(*)::int FROM same_period_duplicates) AS same_period_duplicates,
          (SELECT COUNT(*)::int FROM source_rows WHERE transfer_rank > 1) AS source_duplicates,
          (SELECT COUNT(*)::int FROM deleted_online) AS deleted_from_online
      `,
      params,
    ), getAuditMetaFromRequest(request))

    const row = result.rows[0] as {
      examined?: number
      inserted?: number
      updated?: number
      linked?: number
      same_period_duplicates?: number
      source_duplicates?: number
      deleted_from_online?: number
    } | undefined
    const examined = Number(row?.examined || 0)
    const inserted = Number(row?.inserted || 0)
    const updated = Number(row?.updated || 0)
    const linked = Number(row?.linked || 0)
    const samePeriodDuplicates = Number(row?.same_period_duplicates || 0)
    const sourceDuplicates = Number(row?.source_duplicates || 0)
    const deletedFromOnline = Number(row?.deleted_from_online || 0)

    return NextResponse.json({
      success: true,
      data: {
        examined,
        inserted,
        updated,
        linked,
        samePeriodDuplicates,
        sourceDuplicates,
        deletedFromOnline,
        skipped: Math.max(0, examined - inserted - updated),
        mode,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayitlar nakit muracaatlara aktarilamadi.' },
      { status: 500 },
    )
  }
}
