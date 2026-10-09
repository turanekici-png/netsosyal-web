import { NextRequest, NextResponse } from 'next/server'
import type { PoolClient } from 'pg'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'

// Bu tabloda (dosyalar/bireyler/yrd_* tablolarinin aksine) veritabani
// denetim (audit) trigger'i KURULU DEGIL - "İnceleme Formları Raporu"
// (bkz. app/api/workflow/sonuc-raporu/route.ts) "islemi kim yapti" bilgisini
// sistem_hareket_log'dan OKUYAMAZ. Bu yuzden formu ilk olusturan oturum
// kullanicisini dogrudan bu tabloya (kullaniciid) yaziyoruz.
function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null
  return Number.isInteger(numericUserId) ? numericUserId : null
}

export const dynamic = 'force-dynamic'

type IncelemePayload = {
  id?: string
  dosyaid?: string
  formTarihi?: string
  basvuruNo?: string
  adSoyad?: string
  tcKimlik?: string
  telefon?: string
  ilceMahalle?: string
  adres?: string
  haneKisiSayisi?: string | number
  toplamGelir?: string | number
  kisiBasiGelir?: string | number
  onKontrol?: Record<string, boolean>
  secimler?: Record<string, string | string[]>
  puanlar?: Record<string, number>
  toplamPuan?: string | number
  otomatikSonuc?: string
  sahaIncelemeOzeti?: string
  ozelDurumGerekce?: string
  komisyonKarari?: string
  yardimTurleri?: string[]
  yardimMiktarlari?: Record<string, string | number | null>
  yardimSuresi?: string
  inceleyenAdSoyad?: string
  komisyonRaporu?: string
  komisyonOnay?: string
  workflow?: string
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function normalizeBigInt(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  return /^\d+$/.test(text) ? text : null
}

function normalizeInteger(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  const number = Number(text)
  return Number.isInteger(number) ? number : null
}

function normalizeNumber(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  const normalized = text.replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function normalizeJson(value: unknown, fallback: unknown) {
  return value && typeof value === 'object' ? value : fallback
}

async function ensureIncelemeFormuTable() {
  const pool = getSqlMonitorPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.inceleme_formu (
      id BIGSERIAL PRIMARY KEY,
      dosyaid BIGINT NOT NULL,
      form_tarihi DATE NOT NULL DEFAULT CURRENT_DATE,
      basvuru_no TEXT,
      ad_soyad TEXT,
      tc_kimlik TEXT,
      telefon TEXT,
      ilce_mahalle TEXT,
      adres TEXT,
      hane_kisi_sayisi INTEGER,
      toplam_gelir NUMERIC(14,2),
      kisi_basi_gelir NUMERIC(14,2),
      on_kontrol JSONB NOT NULL DEFAULT '{}'::jsonb,
      secimler JSONB NOT NULL DEFAULT '{}'::jsonb,
      puanlar JSONB NOT NULL DEFAULT '{}'::jsonb,
      toplam_puan INTEGER NOT NULL DEFAULT 0,
      otomatik_sonuc TEXT,
      saha_inceleme_ozeti TEXT,
      ozel_durum_gerekce TEXT,
      komisyon_karari TEXT,
      yardim_turleri JSONB NOT NULL DEFAULT '[]'::jsonb,
      yardim_miktarlari JSONB NOT NULL DEFAULT '{}'::jsonb,
      yardim_suresi TEXT,
      inceleyen_ad_soyad TEXT,
      komisyon_raporu TEXT,
      komisyon_onay TEXT,
      evziyareti_id BIGINT,
      tahkikatraporu_id BIGINT,
      ilkislemtarihi TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      islemtarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  const columnResult = await pool.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inceleme_formu'
      AND column_name IN ('komisyon_raporu', 'yardim_miktarlari', 'evziyareti_id', 'tahkikatraporu_id', 'kullaniciid');
  `)
  const existingColumns = new Set(columnResult.rows.map((row) => row.column_name))

  if (!existingColumns.has('komisyon_raporu')) {
    await pool.query('ALTER TABLE public.inceleme_formu ADD COLUMN komisyon_raporu TEXT;')
  }

  if (!existingColumns.has('yardim_miktarlari')) {
    await pool.query("ALTER TABLE public.inceleme_formu ADD COLUMN yardim_miktarlari JSONB NOT NULL DEFAULT '{}'::jsonb;")
  }

  if (!existingColumns.has('evziyareti_id')) {
    await pool.query('ALTER TABLE public.inceleme_formu ADD COLUMN evziyareti_id BIGINT;')
  }

  if (!existingColumns.has('tahkikatraporu_id')) {
    await pool.query('ALTER TABLE public.inceleme_formu ADD COLUMN tahkikatraporu_id BIGINT;')
  }

  if (!existingColumns.has('kullaniciid')) {
    await pool.query('ALTER TABLE public.inceleme_formu ADD COLUMN kullaniciid INTEGER;')
  }

  const indexResult = await pool.query<{ indexname: string }>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'inceleme_formu'
      AND indexname IN ('ind_inceleme_formu_dosyaid', 'ind_inceleme_formu_form_tarihi');
  `)
  const existingIndexes = new Set(indexResult.rows.map((row) => row.indexname))

  if (!existingIndexes.has('ind_inceleme_formu_dosyaid')) {
    await pool.query('CREATE INDEX ind_inceleme_formu_dosyaid ON public.inceleme_formu (dosyaid);')
  }

  if (!existingIndexes.has('ind_inceleme_formu_form_tarihi')) {
    await pool.query('CREATE INDEX ind_inceleme_formu_form_tarihi ON public.inceleme_formu (form_tarihi);')
  }
}

async function ensureDocumentEvaluationScoreColumn() {
  const pool = getSqlMonitorPool()
  const result = await pool.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dosyalar'
      AND column_name = 'inceleme_puani';
  `)

  if (result.rows.length === 0) {
    await pool.query('ALTER TABLE public.dosyalar ADD COLUMN inceleme_puani integer;')
    await pool.query(`
      DO $$
      BEGIN
        IF to_regclass('public.inceleme_formu') IS NOT NULL THEN
          UPDATE public.dosyalar d
          SET inceleme_puani = latest.toplam_puan
          FROM (
            SELECT DISTINCT ON (dosyaid)
              dosyaid,
              toplam_puan
            FROM public.inceleme_formu
            ORDER BY dosyaid, form_tarihi DESC NULLS LAST, islemtarihi DESC NULLS LAST, id DESC
          ) latest
          WHERE d.id = latest.dosyaid;
        END IF;
      END $$;
    `)
  }
}

async function updateDocumentEvaluationScore(client: PoolClient, dosyaid: string) {
  if (!normalizeBigInt(dosyaid)) return

  await ensureDocumentEvaluationScoreColumn()
  await client.query(
    `
      UPDATE public.dosyalar d
      SET inceleme_puani = latest.toplam_puan,
          islemtarihi = NOW()
      FROM (
        SELECT toplam_puan
        FROM public.inceleme_formu
        WHERE dosyaid = $1::bigint
        ORDER BY form_tarihi DESC NULLS LAST, islemtarihi DESC NULLS LAST, id DESC
        LIMIT 1
      ) latest
      WHERE d.id = $1::bigint;
    `,
    [dosyaid],
  )
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    dosyaid: row.dosyaid === null || row.dosyaid === undefined ? null : String(row.dosyaid),
    formTarihi: row.form_tarihi,
    basvuruNo: row.basvuru_no,
    adSoyad: row.ad_soyad,
    tcKimlik: row.tc_kimlik,
    telefon: row.telefon,
    ilceMahalle: row.ilce_mahalle,
    adres: row.adres,
    haneKisiSayisi: row.hane_kisi_sayisi,
    toplamGelir: row.toplam_gelir,
    kisiBasiGelir: row.kisi_basi_gelir,
    onKontrol: row.on_kontrol || {},
    secimler: row.secimler || {},
    puanlar: row.puanlar || {},
    toplamPuan: row.toplam_puan,
    otomatikSonuc: row.otomatik_sonuc,
    sahaIncelemeOzeti: row.saha_inceleme_ozeti,
    ozelDurumGerekce: row.ozel_durum_gerekce,
    komisyonKarari: row.komisyon_karari,
    yardimTurleri: row.yardim_turleri || [],
    yardimMiktarlari: row.yardim_miktarlari || {},
    yardimSuresi: row.yardim_suresi,
    inceleyenAdSoyad: row.inceleyen_ad_soyad,
    komisyonRaporu: row.komisyon_raporu,
    komisyonOnay: row.komisyon_onay,
    ilkislemtarihi: row.ilkislemtarihi,
    islemtarihi: row.islemtarihi,
  }
}

async function syncEvaluationReports(client: PoolClient, row: Record<string, unknown>) {
  const formId = normalizeBigInt(row.id)
  const dosyaid = normalizeBigInt(row.dosyaid)
  if (!formId || !dosyaid) return row

  const pool = client
  const formDate = row.form_tarihi || new Date()
  const homeVisitContent = normalizeText(row.saha_inceleme_ozeti)
  const investigationContent = normalizeText(row.komisyon_raporu)
  let homeVisitId = normalizeBigInt(row.evziyareti_id)
  let investigationReportId = normalizeBigInt(row.tahkikatraporu_id)

  if (homeVisitContent || homeVisitId) {
    if (homeVisitId) {
      await pool.query(
        `
          UPDATE public.evziyareti
          SET dosyaid = $1::bigint,
              tarih = $2::date,
              konu = $3,
              rapor = $4,
              islemtarihi = NOW()
          WHERE id = $5::bigint;
        `,
        [dosyaid, formDate, 'Saha Inceleme Ozeti', homeVisitContent || '', homeVisitId],
      )
    } else if (homeVisitContent) {
      const result = await pool.query<{ id: string }>(
        `
          INSERT INTO public.evziyareti (dosyaid, tarih, konu, rapor, ilkislemtarihi, islemtarihi)
          VALUES ($1::bigint, $2::date, $3, $4, NOW(), NOW())
          RETURNING id::text AS id;
        `,
        [dosyaid, formDate, 'Saha Inceleme Ozeti', homeVisitContent],
      )
      homeVisitId = result.rows[0]?.id || null
    }
  }

  if (investigationContent || investigationReportId) {
    if (investigationReportId) {
      await pool.query(
        `
          UPDATE public.tahkikatraporlari
          SET dosyaid = $1::bigint,
              tarih = $2::date,
              konu = $3,
              rapor = $4,
              islemtarihi = NOW()
          WHERE id = $5::bigint;
        `,
        [dosyaid, formDate, 'Komisyon Raporu', investigationContent || '', investigationReportId],
      )
    } else if (investigationContent) {
      const result = await pool.query<{ id: string }>(
        `
          INSERT INTO public.tahkikatraporlari (dosyaid, tarih, konu, rapor, ilkislemtarihi, islemtarihi)
          VALUES ($1::bigint, $2::date, $3, $4, NOW(), NOW())
          RETURNING id::text AS id;
        `,
        [dosyaid, formDate, 'Komisyon Raporu', investigationContent],
      )
      investigationReportId = result.rows[0]?.id || null
    }
  }

  const refreshed = await pool.query(
    `
      UPDATE public.inceleme_formu
      SET evziyareti_id = $2::bigint,
          tahkikatraporu_id = $3::bigint,
          islemtarihi = NOW()
      WHERE id = $1::bigint
      RETURNING *;
    `,
    [formId, homeVisitId, investigationReportId],
  )

  return refreshed.rows[0] || row
}

async function updateFileStatusForTahkikat(client: PoolClient, payload: IncelemePayload, dosyaid: string) {
  if (normalizeText(payload.workflow) !== 'tahkikat') return

  const statusDate = normalizeDate(payload.formTarihi) || new Date().toISOString().slice(0, 10)
  await client.query(
    `
      UPDATE public.dosyalar
      SET durumu = 2,
          durumutarih = $2::date,
          durumuaciklama = $3,
          islemtarihi = NOW()
      WHERE id = $1::bigint;
    `,
    [dosyaid, statusDate, 'Inceleme formu kaydedildi'],
  )
}

export async function GET(request: NextRequest) {
  try {
    const dosyaid = normalizeBigInt(request.nextUrl.searchParams.get('dosyaId'))
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    await ensureIncelemeFormuTable()
    const result = await getSqlMonitorPool().query(
      `
        SELECT *
        FROM public.inceleme_formu
        WHERE dosyaid = $1::bigint
        ORDER BY form_tarihi DESC, id DESC;
      `,
      [dosyaid],
    )

    return NextResponse.json({ success: true, data: result.rows.map(mapRow) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Inceleme formlari alinamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluation', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as IncelemePayload
    const dosyaid = normalizeBigInt(payload.dosyaid)
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id zorunludur.' }, { status: 400 })
    }

    await ensureIncelemeFormuTable()
    const currentUserId = getCurrentUserId(request)
    const syncedRow = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const result = await client.query(
        `
          INSERT INTO public.inceleme_formu (
            dosyaid, form_tarihi, basvuru_no, ad_soyad, tc_kimlik, telefon, ilce_mahalle, adres,
            hane_kisi_sayisi, toplam_gelir, kisi_basi_gelir, on_kontrol, secimler, puanlar,
            toplam_puan, otomatik_sonuc, saha_inceleme_ozeti, ozel_durum_gerekce, komisyon_karari,
            yardim_turleri, yardim_miktarlari, yardim_suresi, inceleyen_ad_soyad, komisyon_raporu, komisyon_onay,
            kullaniciid, ilkislemtarihi, islemtarihi
          )
          VALUES (
            $1::bigint, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8,
            $9::integer, $10::numeric, $11::numeric, $12::jsonb, $13::jsonb, $14::jsonb,
            $15::integer, $16, $17, $18, $19, $20::jsonb, $21::jsonb, $22, $23, $24, $25,
            $26, NOW(), NOW()
          )
          RETURNING *;
        `,
        [
          dosyaid,
          normalizeDate(payload.formTarihi),
          normalizeText(payload.basvuruNo),
          normalizeText(payload.adSoyad),
          normalizeText(payload.tcKimlik),
          normalizeText(payload.telefon),
          normalizeText(payload.ilceMahalle),
          normalizeText(payload.adres),
          normalizeInteger(payload.haneKisiSayisi),
          normalizeNumber(payload.toplamGelir),
          normalizeNumber(payload.kisiBasiGelir),
          JSON.stringify(normalizeJson(payload.onKontrol, {})),
          JSON.stringify(normalizeJson(payload.secimler, {})),
          JSON.stringify(normalizeJson(payload.puanlar, {})),
          normalizeInteger(payload.toplamPuan) ?? 0,
          normalizeText(payload.otomatikSonuc),
          normalizeText(payload.sahaIncelemeOzeti),
          normalizeText(payload.ozelDurumGerekce),
          normalizeText(payload.komisyonKarari),
          JSON.stringify(Array.isArray(payload.yardimTurleri) ? payload.yardimTurleri : []),
          JSON.stringify(normalizeJson(payload.yardimMiktarlari, {})),
          normalizeText(payload.yardimSuresi),
          normalizeText(payload.inceleyenAdSoyad),
          normalizeText(payload.komisyonRaporu),
          normalizeText(payload.komisyonOnay),
          currentUserId,
        ],
      )

      const synced = await syncEvaluationReports(client, result.rows[0])
      await updateDocumentEvaluationScore(client, dosyaid)
      await updateFileStatusForTahkikat(client, payload, dosyaid)
      return synced
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: mapRow(syncedRow) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Inceleme formu kaydedilemedi.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluation', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as IncelemePayload
    const id = normalizeBigInt(payload.id)
    if (!id) {
      return NextResponse.json({ success: false, error: 'Guncellenecek form secilmedi.' }, { status: 400 })
    }

    await ensureIncelemeFormuTable()
    const patchResult = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const result = await client.query(
      `
        UPDATE public.inceleme_formu
        SET form_tarihi = COALESCE($2::date, form_tarihi),
            basvuru_no = $3,
            ad_soyad = $4,
            tc_kimlik = $5,
            telefon = $6,
            ilce_mahalle = $7,
            adres = $8,
            hane_kisi_sayisi = $9::integer,
            toplam_gelir = $10::numeric,
            kisi_basi_gelir = $11::numeric,
            on_kontrol = $12::jsonb,
            secimler = $13::jsonb,
            puanlar = $14::jsonb,
            toplam_puan = $15::integer,
            otomatik_sonuc = $16,
            saha_inceleme_ozeti = $17,
            ozel_durum_gerekce = $18,
            komisyon_karari = $19,
            yardim_turleri = $20::jsonb,
            yardim_miktarlari = $21::jsonb,
            yardim_suresi = $22,
            inceleyen_ad_soyad = $23,
            komisyon_raporu = $24,
            komisyon_onay = $25,
            islemtarihi = NOW()
        WHERE id = $1::bigint
        RETURNING *;
      `,
      [
        id,
        normalizeDate(payload.formTarihi),
        normalizeText(payload.basvuruNo),
        normalizeText(payload.adSoyad),
        normalizeText(payload.tcKimlik),
        normalizeText(payload.telefon),
        normalizeText(payload.ilceMahalle),
        normalizeText(payload.adres),
        normalizeInteger(payload.haneKisiSayisi),
        normalizeNumber(payload.toplamGelir),
        normalizeNumber(payload.kisiBasiGelir),
        JSON.stringify(normalizeJson(payload.onKontrol, {})),
        JSON.stringify(normalizeJson(payload.secimler, {})),
        JSON.stringify(normalizeJson(payload.puanlar, {})),
        normalizeInteger(payload.toplamPuan) ?? 0,
        normalizeText(payload.otomatikSonuc),
        normalizeText(payload.sahaIncelemeOzeti),
        normalizeText(payload.ozelDurumGerekce),
        normalizeText(payload.komisyonKarari),
        JSON.stringify(Array.isArray(payload.yardimTurleri) ? payload.yardimTurleri : []),
        JSON.stringify(normalizeJson(payload.yardimMiktarlari, {})),
        normalizeText(payload.yardimSuresi),
        normalizeText(payload.inceleyenAdSoyad),
        normalizeText(payload.komisyonRaporu),
        normalizeText(payload.komisyonOnay),
        ],
      )

      if (result.rows.length === 0) {
        return { kind: 'notFound' as const }
      }

      const synced = await syncEvaluationReports(client, result.rows[0])
      const dosyaid = normalizeBigInt(result.rows[0]?.dosyaid) || ''
      await updateDocumentEvaluationScore(client, dosyaid)
      await updateFileStatusForTahkikat(client, payload, dosyaid)

      return { kind: 'ok' as const, syncedRow: synced }
    }, getAuditMetaFromRequest(request))

    if (patchResult.kind === 'notFound') {
      return NextResponse.json({ success: false, error: 'Form bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: mapRow(patchResult.syncedRow) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Inceleme formu guncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluation', page: '/documents' })
    if (accessDenied) return accessDenied

    const id = normalizeBigInt(request.nextUrl.searchParams.get('id'))
    if (!id) {
      return NextResponse.json({ success: false, error: 'Silinecek form secilmedi.' }, { status: 400 })
    }

    await ensureIncelemeFormuTable()
    const deletedCount = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const result = await client.query('DELETE FROM public.inceleme_formu WHERE id = $1::bigint;', [id])
      return result.rowCount ?? 0
    }, getAuditMetaFromRequest(request))

    if (deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Form bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Inceleme formu silinemedi.' },
      { status: 500 },
    )
  }
}
