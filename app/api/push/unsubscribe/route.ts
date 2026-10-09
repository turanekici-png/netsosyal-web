import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { removeSubscription } from '@/lib/services/webPush.service'

export const dynamic = 'force-dynamic'

// POST - "Bildirimleri Kapat" - bu tarayici/cihazdaki push aboneligini siler.
export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const body = await request.json()
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : ''
    if (!endpoint) {
      return NextResponse.json({ success: false, error: 'Geçersiz abonelik bilgisi.' }, { status: 400 })
    }

    await removeSubscription(endpoint)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Abonelik kaldırılamadı.' },
      { status: 500 },
    )
  }
}
