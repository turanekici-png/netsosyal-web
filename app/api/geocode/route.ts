import { NextResponse } from 'next/server'
import { geocodeSivasMerkezAddress } from '@/lib/services/geocoding'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') || '').trim()

  if (!query) {
    return NextResponse.json({ success: false, error: 'Adres sorgusu boş' }, { status: 400 })
  }

  const outcome = await geocodeSivasMerkezAddress(query)

  if (outcome.status === 'ok') {
    return NextResponse.json({ success: true, data: outcome.result })
  }

  return NextResponse.json(
    { success: false, error: outcome.error, status: outcome.status },
    { status: outcome.status === 'rate_limited' ? 429 : 200 }
  )
}
