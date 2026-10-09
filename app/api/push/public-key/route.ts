import { NextResponse } from 'next/server'
import { getPushPublicKey } from '@/lib/services/webPush.service'

export const dynamic = 'force-dynamic'

// GET - istemcinin pushManager.subscribe() cagrisinda kullanacagi VAPID
// public key'i doner (private key HICBIR ZAMAN client'a gonderilmez).
export async function GET() {
  const publicKey = getPushPublicKey()
  if (!publicKey) {
    return NextResponse.json({ success: false, error: 'Push bildirimleri yapılandırılmamış.' }, { status: 503 })
  }
  return NextResponse.json({ success: true, publicKey })
}
