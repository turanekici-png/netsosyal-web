import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Bu tabloda (dosyalar/bireyler/yrd_* tablolarinin aksine) veritabani
// denetim (audit) trigger'i KURULU DEGIL - yani "İnceleme Formları Raporu"
// (bkz. app/api/workflow/sonuc-raporu/route.ts) "islemi kim yapti" bilgisini
// sistem_hareket_log'dan OKUYAMAZ. Bu yuzden formu doldururken oturum
// kullanicisini dogrudan bu tabloya (kullaniciid) yaziyoruz - on_inceleme_raporlari
// tablosunda zaten kullanilan ayni desen.
function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null
  return Number.isInteger(numericUserId) ? numericUserId : null
}

type GuncellemeFormuPayload = {
  id?: string
  dosyaid?: string
  formTarihi?: string
  aciklama?: string
  cevaplar?: Record<string, string | string[]>
  sonuc?: string
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

function normalizeDate(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function normalizeJson(value: unknown, fallback: unknown) {
  return value && typeof value === 'object' ? value : fallback
}

async function ensureGuncellemeFormuTable() {
  const pool = getSqlMonitorPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.guncelleme_formu (
      id BIGSERIAL PRIMARY KEY,
      dosyaid BIGINT NOT NULL,
      form_tarihi DATE NOT NULL DEFAULT CURRENT_DATE,
      cevaplar JSONB NOT NULL DEFAULT '{}'::jsonb,
      aciklama TEXT,
      ilkislemtarihi TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      islemtarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  const indexResult = await pool.query<{ indexname: string }>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'guncelleme_formu'
      AND indexname = 'ind_guncelleme_formu_dosyaid';
  `)

  if (indexResult.rows.length === 0) {
    await pool.query('CREATE INDEX ind_guncelleme_formu_dosyaid ON public.guncelleme_formu (dosyaid);')
  }

  // "sonuc" sutunu sonradan eklendi. PostgreSQL 9.4'te "ADD COLUMN IF NOT EXISTS"
  // desteklenmedigi icin (9.6+ ozelligi) once information_schema'dan kontrol edip
  // oyle ekliyoruz.
  const columnResult = await pool.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'guncelleme_formu'
      AND column_name = 'sonuc';
  `)

  if (columnResult.rows.length === 0) {
    await pool.query('ALTER TABLE public.guncelleme_formu ADD COLUMN sonuc TEXT;')
  }

  const kullaniciColumnResult = await pool.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'guncelleme_formu'
      AND column_name = 'kullaniciid';
  `)

  if (kullaniciColumnResult.rows.length === 0) {
    await pool.query('ALTER TABLE public.guncelleme_formu ADD COLUMN kullaniciid INTEGER;')
  }
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    dosyaid: row.dosyaid === null || row.dosyaid === undefined ? null : String(row.dosyaid),
    formTarihi: row.form_tarihi,
    cevaplar: row.cevaplar || {},
    aciklama: row.aciklama,
    sonuc: row.sonuc,
    ilkislemtarihi: row.ilkislemtarihi,
    islemtarihi: row.islemtarihi,
  }
}

// Guncelleme formu, dosya "ON INCELEME YAPILMIS" durumuna alinirken doldurulur.
// Bu route SADECE formun cevaplarini kaydeder; dosyanin durumunu degistirmez -
// durum degisikligi ayni istekten hemen sonra client tarafindan mevcut ve zaten
// test edilmis /api/documents/file-status rotasi cagrilarak yapilir. Boylece
// dosya durumu degistirme mantigi tek bir yerde (file-status route) kalir ve
// burada tekrar edilmez. "sonuc" alani ise sadece bilgilendirme icindir (ornegin
// "Ön İncelemeye Gönderildi" / "İncelemeye Uygun Değil") - client hangi butona
// basildigini zaten bildigi icin bu metni kendisi gonderir.
export async function GET(request: NextRequest) {
  try {
    const dosyaid = normalizeBigInt(request.nextUrl.searchParams.get('dosyaId'))
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    await ensureGuncellemeFormuTable()
    const result = await getSqlMonitorPool().query(
      `
        SELECT *
        FROM public.guncelleme_formu
        WHERE dosyaid = $1::bigint
        ORDER BY form_tarihi DESC, id DESC;
      `,
      [dosyaid],
    )

    return NextResponse.json({ success: true, data: result.rows.map(mapRow) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Guncelleme formlari alinamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.status', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as GuncellemeFormuPayload
    const dosyaid = normalizeBigInt(payload.dosyaid)
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id zorunludur.' }, { status: 400 })
    }

    await ensureGuncellemeFormuTable()
    const currentUserId = getCurrentUserId(request)
    const savedRow = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const result = await client.query(
        `
          INSERT INTO public.guncelleme_formu (dosyaid, form_tarihi, cevaplar, aciklama, sonuc, kullaniciid, ilkislemtarihi, islemtarihi)
          VALUES ($1::bigint, COALESCE($2::date, CURRENT_DATE), $3::jsonb, $4, $5, $6, NOW(), NOW())
          RETURNING *;
        `,
        [
          dosyaid,
          normalizeDate(payload.formTarihi),
          JSON.stringify(normalizeJson(payload.cevaplar, {})),
          normalizeText(payload.aciklama),
          normalizeText(payload.sonuc),
          currentUserId,
        ],
      )

      return result.rows[0]
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: mapRow(savedRow) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Guncelleme formu kaydedilemedi.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.status', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as GuncellemeFormuPayload
    const id = normalizeBigInt(payload.id)
    if (!id) {
      return NextResponse.json({ success: false, error: 'Guncellenecek form secilmedi.' }, { status: 400 })
    }

    await ensureGuncellemeFormuTable()
    const updatedRow = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const result = await client.query(
        `
          UPDATE public.guncelleme_formu
          SET form_tarihi = COALESCE($2::date, form_tarihi),
              cevaplar = $3::jsonb,
              aciklama = $4,
              islemtarihi = NOW()
          WHERE id = $1::bigint
          RETURNING *;
        `,
        [
          id,
          normalizeDate(payload.formTarihi),
          JSON.stringify(normalizeJson(payload.cevaplar, {})),
          normalizeText(payload.aciklama),
        ],
      )

      return result.rows[0]
    }, getAuditMetaFromRequest(request))

    if (!updatedRow) {
      return NextResponse.json({ success: false, error: 'Form bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: mapRow(updatedRow) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Guncelleme formu guncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.status', page: '/documents' })
    if (accessDenied) return accessDenied

    const id = normalizeBigInt(request.nextUrl.searchParams.get('id'))
    if (!id) {
      return NextResponse.json({ success: false, error: 'Silinecek form secilmedi.' }, { status: 400 })
    }

    await ensureGuncellemeFormuTable()
    const deletedCount = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const result = await client.query('DELETE FROM public.guncelleme_formu WHERE id = $1::bigint;', [id])
      return result.rowCount ?? 0
    }, getAuditMetaFromRequest(request))

    if (deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Form bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Guncelleme formu silinemedi.' },
      { status: 500 },
    )
  }
}
