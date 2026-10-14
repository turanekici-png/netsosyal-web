import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { ensureSahaIncelemeSchema, gelenSablonuDogrula, SablonCakismasi, sablonuGetir, sablonuKaydet, varsayilanSablonuYukle } from '../_lib/sablon'

export const dynamic = 'force-dynamic'

// Form doldurma ekrani (aktif bolum/sorular) ve Ayarlar > Tahkikat Formu
// Tasarımı ekrani (?tumu=1, pasifler dahil) icin tek veri kaynagi.
export async function GET(request: NextRequest) {
  try {
    const tumu = request.nextUrl.searchParams.get('tumu') === '1'
    return NextResponse.json({ success: true, data: await sablonuGetir(tumu) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Form şablonu alınamadı.' },
      { status: 500 },
    )
  }
}

// Tasarim ekranindaki "Kaydet" - tum sablonu tek islemde yazar.
export async function PUT(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const govde = await request.json() as { revizyon?: unknown }
    const dogrulama = gelenSablonuDogrula(govde)
    if ('hata' in dogrulama) {
      return NextResponse.json({ success: false, error: dogrulama.hata }, { status: 400 })
    }
    const beklenenRevizyon = govde?.revizyon !== undefined && govde?.revizyon !== null && Number.isInteger(Number(govde.revizyon)) ? Number(govde.revizyon) : null
    // Revizyon gondermeyen (eski surum/acik kalmis) sayfa kaydedemez - yenilemeli.
    if (beklenenRevizyon === null) {
      return NextResponse.json({ success: false, error: new SablonCakismasi().message, cakisma: true }, { status: 409 })
    }

    await ensureSahaIncelemeSchema()
    await withAuditedPoolWrite(getSqlMonitorPool(), (client) => sablonuKaydet(client, dogrulama.sablon, beklenenRevizyon), getAuditMetaFromRequest(request))
    return NextResponse.json({ success: true, data: await sablonuGetir(true) })
  } catch (error) {
    if (error instanceof SablonCakismasi) {
      return NextResponse.json({ success: false, error: error.message, cakisma: true }, { status: 409 })
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Form şablonu kaydedilemedi.' },
      { status: 500 },
    )
  }
}

// "Varsayılan forma dön" - sablonu PDF'teki ilk haline sifirlar.
export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    if (request.nextUrl.searchParams.get('islem') !== 'sifirla') {
      return NextResponse.json({ success: false, error: 'Geçersiz işlem.' }, { status: 400 })
    }

    await ensureSahaIncelemeSchema()
    await withAuditedPoolWrite(getSqlMonitorPool(), (client) => varsayilanSablonuYukle(true, client), getAuditMetaFromRequest(request))
    return NextResponse.json({ success: true, data: await sablonuGetir(true) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Form şablonu sıfırlanamadı.' },
      { status: 500 },
    )
  }
}
