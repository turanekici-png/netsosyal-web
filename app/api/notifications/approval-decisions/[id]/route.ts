import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

type Params = { id: string }

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

// PATCH - bildirimi "görüldü" olarak işaretler. Sadece talebi gönderen
// kullanıcı kendi bildirimini görüldü işaretleyebilir.
export async function PATCH(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const { id } = await params
    const requestId = cleanBigInt(id)
    if (!requestId) {
      return NextResponse.json({ success: false, error: 'Bildirim bulunamadı.' }, { status: 400 })
    }

    await prisma.$executeRaw`
      UPDATE yardim_onay_talepleri
      SET bildirim_gorundu = true
      WHERE id = ${requestId} AND talep_eden_kullaniciid = ${Number(sessionUser.id)}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Bildirim güncellenemedi.' },
      { status: 500 },
    )
  }
}
