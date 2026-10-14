import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Dosya Müracaat Formu (Sosyal Yardım Talep Formu) - müracaatçının dijital
// imzası ve talep ettiği yardımlar (kullanici istegi 2026-10-14). Her imza
// yeni bir kayit olarak saklanir (gecmis korunur); formda en son kayit kullanilir.

const IMZA_EN_FAZLA = 1_500_000 // ~1.5 MB data URL

let semaHazir: Promise<void> | null = null
function ensureSchema() {
  semaHazir ??= getSqlMonitorPool()
    .query(`
      CREATE TABLE IF NOT EXISTS public.dosya_muracaat_formu (
        id bigserial PRIMARY KEY,
        dosyaid bigint NOT NULL,
        dosya_no varchar(50),
        ad_soyad varchar(200),
        tckimlikno varchar(20),
        talepler jsonb NOT NULL DEFAULT '[]'::jsonb,
        imza text,
        kullaniciid integer,
        olusturma_tarihi timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
      );
      CREATE INDEX IF NOT EXISTS dosya_muracaat_formu_dosyaid_idx ON public.dosya_muracaat_formu (dosyaid, id DESC);
      -- 2026-10-14 (2. tur): formu teslim alan personelin imzasi
      ALTER TABLE public.dosya_muracaat_formu ADD COLUMN IF NOT EXISTS personel_imza text;
      ALTER TABLE public.dosya_muracaat_formu ADD COLUMN IF NOT EXISTS personel_adi varchar(200);
      -- imza anindaki form bilgileri (kisi, adres, hane) - anlik kopya
      ALTER TABLE public.dosya_muracaat_formu ADD COLUMN IF NOT EXISTS form_bilgileri jsonb;
      -- müracaatçının el yazısıyla "Okudum, onaylıyorum." (gorsel)
      ALTER TABLE public.dosya_muracaat_formu ADD COLUMN IF NOT EXISTS onay_yazisi text;
    `)
    .then(() => undefined)
    .catch((error) => {
      semaHazir = null
      throw error
    })
  return semaHazir
}

function bigIntParam(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return /^\d{1,18}$/.test(text) ? text : null
}

type KayitSatiri = {
  id: string
  dosyaid: string
  talepler: string[] | null
  imza: string | null
  personel_imza: string | null
  onay_yazisi: string | null
  personel_adi: string | null
  ad_soyad: string | null
  kullanici: string | null
  olusturma_tarihi: string
}

export async function GET(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ page: '/documents' })
    if (accessDenied) return accessDenied

    const dosyaid = bigIntParam(request.nextUrl.searchParams.get('dosyaId'))
    if (!dosyaid) return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })

    await ensureSchema()
    const result = await getSqlMonitorPool().query<KayitSatiri>(
      `
        SELECT f.id::text AS id, f.dosyaid::text AS dosyaid, f.talepler, f.imza, f.personel_imza, f.personel_adi, f.onay_yazisi, f.ad_soyad,
               COALESCE(NULLIF(TRIM(k.kullanicitamadi), ''), k.kullaniciadi) AS kullanici,
               to_char(f.olusturma_tarihi, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS olusturma_tarihi
        FROM public.dosya_muracaat_formu f
        LEFT JOIN public.kullanicilar k ON k.id = f.kullaniciid
        WHERE f.dosyaid = $1::bigint
        ORDER BY f.id DESC
        LIMIT 1
      `,
      [dosyaid],
    )
    return NextResponse.json({ success: true, data: result.rows[0] ?? null })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Müracaat formu alınamadı.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.print', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = await request.json() as { dosyaId?: unknown; dosyaNo?: unknown; adSoyad?: unknown; tc?: unknown; talepler?: unknown; imza?: unknown; personelImza?: unknown; personelAdi?: unknown; formBilgileri?: unknown; onayYazisi?: unknown }
    const dosyaid = bigIntParam(body.dosyaId)
    if (!dosyaid) return NextResponse.json({ success: false, error: 'Dosya id zorunludur.' }, { status: 400 })

    const imza = typeof body.imza === 'string' ? body.imza : ''
    if (!imza.startsWith('data:image/')) {
      return NextResponse.json({ success: false, error: 'Müracaatçı imzası alınmadı.' }, { status: 400 })
    }
    const personelImza = typeof body.personelImza === 'string' && body.personelImza.startsWith('data:image/') ? body.personelImza : null
    const onayYazisi = typeof body.onayYazisi === 'string' && body.onayYazisi.startsWith('data:image/') ? body.onayYazisi : null
    if (imza.length > IMZA_EN_FAZLA || (personelImza?.length ?? 0) > IMZA_EN_FAZLA || (onayYazisi?.length ?? 0) > IMZA_EN_FAZLA) {
      return NextResponse.json({ success: false, error: 'İmza dosyası çok büyük.' }, { status: 400 })
    }
    const formBilgileri = body.formBilgileri && typeof body.formBilgileri === 'object' ? JSON.stringify(body.formBilgileri) : null
    if ((formBilgileri?.length ?? 0) > 200_000) {
      return NextResponse.json({ success: false, error: 'Form bilgileri çok büyük.' }, { status: 400 })
    }
    const talepler = Array.isArray(body.talepler)
      ? body.talepler.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
      : []

    const userId = Number(parseSessionValue(readSessionCookie(request.cookies)))
    await ensureSchema()
    const result = await getSqlMonitorPool().query<{ id: string }>(
      `
        INSERT INTO public.dosya_muracaat_formu (dosyaid, dosya_no, ad_soyad, tckimlikno, talepler, imza, kullaniciid, personel_imza, personel_adi, form_bilgileri, onay_yazisi)
        VALUES ($1::bigint, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb, $11)
        RETURNING id::text AS id
      `,
      [
        dosyaid,
        String(body.dosyaNo ?? '').slice(0, 50) || null,
        String(body.adSoyad ?? '').slice(0, 200) || null,
        String(body.tc ?? '').slice(0, 20) || null,
        JSON.stringify(talepler),
        imza,
        Number.isInteger(userId) ? userId : null,
        personelImza,
        String(body.personelAdi ?? '').slice(0, 200) || null,
        formBilgileri,
        onayYazisi,
      ],
    )
    return NextResponse.json({ success: true, data: { id: result.rows[0]?.id } })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Müracaat formu kaydedilemedi.' }, { status: 500 })
  }
}
