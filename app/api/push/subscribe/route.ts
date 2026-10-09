import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { saveSubscription } from '@/lib/services/webPush.service'

export const dynamic = 'force-dynamic'

// POST - oturum sahibi kullanicinin bu tarayici/cihazdaki push aboneligini
// kaydeder ("Bildirimleri Aç" butonu) - bkz. lib/pushClient.ts.
export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const body = await request.json()
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : ''
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : ''
    const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : ''

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ success: false, error: 'Geçersiz abonelik bilgisi.' }, { status: 400 })
    }

    const userAgent = request.headers.get('user-agent')
    await saveSubscription(Number(sessionUser.id), { endpoint, keys: { p256dh, auth } }, userAgent)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Abonelik kaydedilemedi.' },
      { status: 500 },
    )
  }
}
