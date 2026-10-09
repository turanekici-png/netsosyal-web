import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getCommunicationUser } from '@/lib/communicationAuth'

export async function PATCH(_request: Request, context: RouteContext<'/api/communication/[id]/read'>) {
  const currentUser = await getCommunicationUser()
  if (!currentUser) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const { id } = await context.params
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ success: false, error: 'Geçersiz ileti kaydı.' }, { status: 400 })
  }

  const result = await prisma.internalCommunicationRecipient.updateMany({
    where: { communicationId: BigInt(id), recipientUserId: currentUser.id, readAt: null },
    data: { readAt: new Date() },
  })

  return NextResponse.json({ success: true, updated: result.count })
}
