import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getCommunicationUser } from '@/lib/communicationAuth'
import {
  communicationMessageCutoff,
  scheduleCommunicationRetentionCleanup,
} from '@/lib/services/communicationRetention.service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const currentUser = await getCommunicationUser()
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

  scheduleCommunicationRetentionCleanup()

  const now = new Date()
  const messageCutoff = communicationMessageCutoff(now)
  const unreadWhere = {
      recipientUserId: currentUser.id,
      readAt: null,
      archivedAt: null,
      communication: {
        status: 'aktif',
        createdAt: { gte: messageCutoff },
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        ],
      },
    }
  const [unreadCount, unread] = await Promise.all([
    prisma.internalCommunicationRecipient.count({ where: unreadWhere }),
    prisma.internalCommunicationRecipient.findMany({
      where: unreadWhere,
      include: { communication: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])
  const senderIds = [...new Set(unread.map(({ communication }) => communication.senderUserId))]
  const senders = await prisma.user.findMany({
    where: { id: { in: senderIds } },
    select: { id: true, kullanicitamadi: true, username: true },
  })
  const sendersById = new Map(senders.map((sender) => [sender.id.toString(), sender]))

    return NextResponse.json({
      success: true,
      data: {
        count: unreadCount,
        messages: unread.map(({ communication }) => ({
          id: communication.id.toString(),
          type: communication.type,
          senderUserId: communication.senderUserId.toString(),
          senderName: sendersById.get(communication.senderUserId.toString())?.kullanicitamadi
            || sendersById.get(communication.senderUserId.toString())?.username
            || 'Kullanıcı',
          subject: communication.subject,
          content: communication.content.slice(0, 120),
          priority: communication.priority,
          createdAt: communication.createdAt,
        })),
      },
    })
  } catch (error) {
    console.error('[Kurum ici iletisim] Ozet hatasi:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Bildirimler alınamadı.' },
      { status: 500 },
    )
  }
}
