import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { getAddressRefreshStatus } from '@/lib/services/addressAutoRefresh.service'

export const dynamic = 'force-dynamic'

// GET - bir dosya için arka planda süren (varsa) otomatik NVİ adres
// tazeleme durumunu döner. Dosya ekranı bunu, "Adres NVİ'den
// güncelleniyor..." bildirimini göstermek/kapatmak için birkaç saniyede
// bir sorgular (bkz. app/(modules)/documents/page.tsx).
export async function GET(request: Request) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fileId = searchParams.get('fileId')
  if (!fileId || !/^\d+$/.test(fileId)) {
    return NextResponse.json({ success: false, error: 'Geçersiz dosya ID.' }, { status: 400 })
  }

  const status = getAddressRefreshStatus(BigInt(fileId))
  return NextResponse.json({ success: true, data: status })
}
