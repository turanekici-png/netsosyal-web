import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getCommunicationUser } from '@/lib/communicationAuth'
import { deleteCommunicationFromStorage } from '@/lib/db/communicationStorage'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await getCommunicationUser()
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const { id } = await context.params
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Mesaj bilgisi geçersiz.' }, { status: 400 })
    }

    const communicationId = BigInt(id)
    const message = await prisma.internalCommunication.findUnique({
      where: { id: communicationId },
      select: {
        id: true,
        senderUserId: true,
        recipients: {
          where: { recipientUserId: currentUser.id },
          select: { id: true },
        },
      },
    })

    if (!message) {
      return NextResponse.json({ success: false, error: 'Mesaj bulunamadı.' }, { status: 404 })
    }

    const isSender = message.senderUserId === currentUser.id
    const isRecipient = message.recipients.length > 0
    if (!isSender && !isRecipient) {
      return NextResponse.json({ success: false, error: 'Bu mesajı silme yetkiniz yok.' }, { status: 403 })
    }

    const scope = new URL(request.url).searchParams.get('scope') === 'everyone' ? 'everyone' : 'me'
    if (scope === 'everyone') {
      if (!isSender) {
        return NextResponse.json({ success: false, error: 'Mesajı herkesten yalnızca gönderen silebilir.' }, { status: 403 })
      }

      await prisma.internalCommunication.delete({ where: { id: communicationId } })
      await deleteCommunicationFromStorage(communicationId).catch((storageError) => {
        console.error('[Kurum ici iletisim] Mesaj deposu silme hatasi:', storageError)
      })
      return NextResponse.json({ success: true, message: 'Mesaj ve ekleri herkesten silindi.' })
    }

    if (isSender) {
      await prisma.internalCommunication.update({
        where: { id: communicationId },
        data: { senderArchivedAt: new Date() },
      })
    } else {
      await prisma.internalCommunicationRecipient.updateMany({
        where: { communicationId, recipientUserId: currentUser.id },
        data: { archivedAt: new Date() },
      })
    }

    return NextResponse.json({ success: true, message: 'Mesaj sizden silindi.' })
  } catch (error) {
    console.error('[Kurum ici iletisim] Silme hatasi:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Mesaj silinemedi.' },
      { status: 500 },
    )
  }
}
