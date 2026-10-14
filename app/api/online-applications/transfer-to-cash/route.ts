import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import {
  amountSql,
  buildOnlineApplicationsWhere,
  ensureOnlineApplicationsAuditTrigger,
  fullNameSql,
  hasActiveOnlineFilter,
  ibanSql,
  incomeSql,
  periodSql,
  phoneSql,
  propertySql,
  vehicleModelYearSql,
  vehicleStatusSql,
} from '@/lib/onlineApplications/listQuery'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { OTOMATIK_RED_STAGE } from '@/lib/services/cashAutoReject.service'
import { ensureCashReasonColumnWidth } from '@/lib/services/cashReasonColumn'
import { mulkiyetDurumuEtiketleri } from '@/lib/services/mulkiyetDurumu.service'

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

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'online.forms.manage', page: '/online' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as TransferPayload
  const mode = payload.mode === 'selected' ? 'selected' : 'filtered'
  const ids = normalizeIds(payload.ids)
  const filters = payload.filters || {}

  if (mode === 'selected' && ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Aktarılacak kayıt seçilmedi.' }, { status: 400 })
  }

  if (mode === 'filtered' && !hasActiveOnlineFilter(filters)) {
    return NextResponse.json({ success: false, error: 'Filtreli aktarım için önce arama veya filtre uygulayın.' }, { status: 400 })
  }

  const params: Array<string | string[]> = []
  let whereCondition = ''

  if (mode === 'selected') {
    params.push(ids)
    whereCondition = `t.id::text = ANY($${params.length}::text[])`
  } else {
    // 2026-10-14: listenin KENDİ arama/filtre koşulu (bkz.
    // lib/onlineApplications/listQuery.ts) - eskiden burada ayrı, Türkçe-
    // duyarsız olmayan bir arama vardı; "Filtrelenenleri Aktar" ekranda
    // görünenden farklı kayıtları aktarabiliyordu.
    whereCondition = buildOnlineApplicationsWhere(filters)
  }

  try {
    // Mülkiyet kodu -> ad eslemesi Hazır Değerler'den (bkz. mulkiyetDurumu.service)
    params.push(JSON.stringify(await mulkiyetDurumuEtiketleri()))
    const mulkiyetParam = params.length
    const pool = getSqlMonitorPool()
    await ensureYrdAyninaktiAdresColumn(pool)
    await ensureOnlineApplicationsAuditTrigger(pool)
    // durumuaciklama 100 -> 500 (bkz. lib/services/cashReasonColumn.ts);
    // otomatik red açıklaması artık kesilmeden aktarılır.
    const reasonMaxLength = await ensureCashReasonColumnWidth()
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
            -- 2026-10-14: kod karsiligi Hazır Değerler > mulkiyetdurumu listesinden
            -- (koda gomulu eski eslesme 3/5/6'da yeni listeyle celisiyordu)
            COALESCE(NULLIF(c.mulkiyet_bilgisi, ''), ($${mulkiyetParam}::jsonb ->> d.mulkiyetdurumu::text)) AS resolved_mulkiyet_bilgisi,
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
              WHEN s.asama = '${OTOMATIK_RED_STAGE}' AND NULLIF(s.aciklama, '') IS NOT NULL THEN LEFT(s.aciklama, ${reasonMaxLength})
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
      { success: false, error: error instanceof Error ? error.message : 'Kayıtlar nakit müracaatlara aktarılamadı.' },
      { status: 500 },
    )
  }
}
