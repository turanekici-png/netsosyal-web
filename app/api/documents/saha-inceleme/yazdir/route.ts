import { NextRequest, NextResponse } from 'next/server'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { ensureSahaIncelemeSchema, sablonuGetir } from '../_lib/sablon'
import { kayitDetayiniEsle, normalizeBigInt, type FormSatiri } from '../_lib/kayit'
import { sahaIncelemeHtml } from '../_lib/yazdir'

export const dynamic = 'force-dynamic'

function html(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

// /api/documents/saha-inceleme/yazdir?id=123  -> kayitli formun ciktisi
// /api/documents/saha-inceleme/yazdir?dosyaId=5 -> o dosya icin bos form (Başvuru No dolu)
// /api/documents/saha-inceleme/yazdir           -> tamamen bos saha formu
export async function GET(request: NextRequest) {
  try {
    await ensureSahaIncelemeSchema()
    const params = request.nextUrl.searchParams
    const otomatikYazdir = params.get('yazdir') === '1'
    const formId = normalizeBigInt(params.get('id'))

    if (formId) {
      const result = await getSqlMonitorPool().query<FormSatiri>(
        `SELECT *, id::text AS id, dosyaid::text AS dosyaid, tarih::text AS tarih FROM public.saha_inceleme_formu WHERE id = $1::bigint;`,
        [formId],
      )
      if (result.rows.length === 0) return html('<p>Form bulunamadı.</p>', 404)
      const detay = kayitDetayiniEsle(result.rows[0])
      return html(sahaIncelemeHtml({
        sablon: detay.sablon,
        cevaplar: detay.cevaplar,
        formNo: detay.id,
        dosyaNo: detay.dosyaNo,
        tarih: detay.tarih,
        personelAciklamasi: detay.personelAciklamasi,
        personelRaporu: detay.personelRaporu,
        otomatikYazdir,
      }))
    }

    let dosyaNo: string | null = null
    const dosyaId = normalizeBigInt(params.get('dosyaId'))
    if (dosyaId) {
      const dosya = await getSqlMonitorPool().query<{ dosyano: string | null }>(`SELECT dosyano FROM dosyalar WHERE id = $1::bigint;`, [dosyaId])
      dosyaNo = dosya.rows[0]?.dosyano ?? null
    }
    return html(sahaIncelemeHtml({ sablon: await sablonuGetir(false), cevaplar: null, dosyaNo, otomatikYazdir }))
  } catch (error) {
    return html(`<p>Form yazdırılamadı: ${error instanceof Error ? error.message.replace(/</g, '&lt;') : ''}</p>`, 500)
  }
}
