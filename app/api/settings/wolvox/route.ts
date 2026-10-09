import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getWolvoxConnectionConfig, saveWolvoxConnectionConfig } from '@/lib/services/wolvox.service'

export const dynamic = 'force-dynamic'

// Muhasebe sayfasina erisimi olmayan bir kullanici bu uc noktayi hic
// goremesin diye GET/POST ikisi de sayfa yetkisiyle (allowedPages'teki
// '/muhasebe') kapali - genel amacli /api/settings/[key] GET'inin aksine
// (o route'ta GET icin HICBIR yetki kontrolu yok), bu baglanti bilgileri
// (sifre dahil) hassas oldugu icin NVI kimlik bilgileriyle AYNI desende
// (bkz. app/api/settings/nvi/route.ts) kendi ozel route'una alindi.
export async function GET() {
  const accessDenied = await requireApiAccess({ page: '/muhasebe' })
  if (accessDenied) return accessDenied

  try {
    const config = await getWolvoxConnectionConfig()
    return NextResponse.json({ success: true, data: config })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ page: '/muhasebe' })
  if (accessDenied) return accessDenied

  try {
    const body = await request.json()
    const host = typeof body.host === 'string' ? body.host.trim() : ''
    const database = typeof body.database === 'string' ? body.database.trim() : ''
    const user = typeof body.user === 'string' && body.user.trim() ? body.user.trim() : 'SYSDBA'
    const password = typeof body.password === 'string' ? body.password : ''
    const port = Number(body.port) || 3050

    if (!host || !database) {
      return NextResponse.json(
        { success: false, error: 'Sunucu adresi ve veritabanı dosya yolu zorunludur.' },
        { status: 400 },
      )
    }

    await saveWolvoxConnectionConfig({ host, port, database, user, password })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}
