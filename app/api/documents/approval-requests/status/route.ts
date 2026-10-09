import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

// GET - tek bir kaydin GUNCEL onay durumunu ANLIK sorgular (cache YOK).
// handlePrintAssistance yazdirmadan hemen once bunu cagirir - boylece
// istemcideki (bazen sekmeler arasi gecislerde) BAYAT kalabilen
// row.approvalStatus'a degil, DAIMA en guncel veriye gore karar verilir.
export async function GET(request: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const kayitTuru = (searchParams.get('kayitTuru') || '').trim()
    const kayitId = cleanBigInt(searchParams.get('kayitId'))
    const donemParam = searchParams.get('donem')
    const donem = donemParam !== null && donemParam !== '' && Number.isInteger(Number(donemParam)) ? Number(donemParam) : null

    if (!['yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_ddgidadosyali'].includes(kayitTuru) || !kayitId) {
      return NextResponse.json({ success: false, error: 'Geçersiz sorgu.' }, { status: 400 })
    }

    const rows = await prisma.$queryRaw<{ durum: number }[]>`
      SELECT durum FROM yardim_onay_talepleri
      WHERE kayit_turu = ${kayitTuru} AND kayit_id = ${kayitId} AND donem IS NOT DISTINCT FROM ${donem}
      ORDER BY id DESC LIMIT 1
    `

    const status = rows[0]?.durum === 0 ? 'pending' : rows[0]?.durum === 1 ? 'approved' : rows[0]?.durum === 2 ? 'rejected' : 'none'

    return NextResponse.json({ success: true, data: { status } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Onay durumu alınamadı.' },
      { status: 500 },
    )
  }
}
