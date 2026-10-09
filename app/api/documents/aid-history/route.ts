import { NextRequest, NextResponse } from 'next/server'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

export const dynamic = 'force-dynamic'

// "Yardım Hareketleri" penceresindeki Gıda Bankası / Destek Paketi / Hazır
// Yemek sekmeleri icin veri kaynagi. Bu 3 tur icin dosyanin tek bir "guncel
// durum" satiri (yrd_gidabankasi/yrd_destekpaketi/yrd_haziryemek) yerine,
// o yardimla ilgili YAPILAN TUM ISLEMLERI (Ilk Kayit, Yardim Basla, her
// donemin odeme hareketi, Iptal vb.) kendi "hareket" (hrk) tablolarindan
// okur - "İşlem Geçmişi" formatında.
//
// NOT: Bu rota BILEREK app/api/documents/fetch/route.ts'deki ana
// `assistances` sorgusuna DOKUNMUYOR - o sorgu dosya sayfasindaki asil
// "Yardımlar" tablosunu (duzenleme/iptal/durdurma/silme islemlerinin
// calistigi) besliyor. Hareket (hrk) tablolari duzenlenebilir/silinebilir
// satirlar degil, salt-okunur bir islem gunlugudur; bu yuzden ayri, sadece
// raporlama amacli bir uctan servis ediliyor.

type AidHistoryRow = {
  id: string
  source_type: string
  islemtarihi: string | null
  islemadi: string | null
  aciklama: string | null
  miktar: string | null
  donem: string | null
  // Kullanici istegi: "Yardım Hareketleri" penceresindeki tum raporlarda
  // alisveris miktari da gorunsun. Sadece yrd_gidabankasihrk ve
  // yrd_destekpaketihrk tablolarinda VAR - yrd_haziryemekhrk'ta bu alan
  // hic tutulmuyor, o dalda NULL secilir.
  alisveris_miktari: string | null
}

function normalizeBigInt(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : null
}

export async function GET(request: NextRequest) {
  try {
    const dosyaId = normalizeBigInt(request.nextUrl.searchParams.get('dosyaId'))

    if (!dosyaId) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    const result = await getSqlMonitorPool().query<AidHistoryRow>(
      `
        SELECT * FROM (
          SELECT
            h.id::text AS id,
            'Gıda Bankası'::text AS source_type,
            h.islemtarihi::timestamp AS islemtarihi,
            h.islemadi::text AS islemadi,
            NULLIF(h.aciklama, '''''')::text AS aciklama,
            h.miktar::text AS miktar,
            COALESCE(NULLIF(h.donemadi, ''), h.donem::text)::text AS donem,
            h.alisverismiktari::text AS alisveris_miktari
          FROM public.yrd_gidabankasihrk h
          WHERE h.dosyaid = $1::bigint

          UNION ALL

          SELECT
            h.id::text AS id,
            'Destek Paketi'::text AS source_type,
            h.islemtarihi::timestamp AS islemtarihi,
            h.islemadi::text AS islemadi,
            NULLIF(h.aciklama, '''''')::text AS aciklama,
            h.miktar::text AS miktar,
            NULL::text AS donem,
            h.alisverismiktari::text AS alisveris_miktari
          FROM public.yrd_destekpaketihrk h
          WHERE h.dosyaid = $1::bigint

          UNION ALL

          SELECT
            h.id::text AS id,
            'Hazır Yemek'::text AS source_type,
            h.islemtarihi::timestamp AS islemtarihi,
            h.islemadi::text AS islemadi,
            NULLIF(h.aciklama, '''''')::text AS aciklama,
            COALESCE(h.ekmekmiktari, h.kisisayisi)::text AS miktar,
            NULLIF(h.donemadi, '')::text AS donem,
            NULL::text AS alisveris_miktari
          FROM public.yrd_haziryemekhrk h
          WHERE h.dosyaid = $1::bigint
        ) history
        ORDER BY islemtarihi DESC NULLS LAST, id DESC;
      `,
      [dosyaId],
    )

    return NextResponse.json({ success: true, data: result.rows })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Yardım işlem geçmişi alınamadı.' },
      { status: 500 },
    )
  }
}
