import { NextResponse } from 'next/server'
import { getCommunicationUser } from '@/lib/communicationAuth'
import { getCommunicationAttachmentFromStorage } from '@/lib/db/communicationStorage'
import { prisma } from '@/lib/db/prisma'
import {
  scheduleCommunicationRetentionCleanup,
} from '@/lib/services/communicationRetention.service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const currentUser = await getCommunicationUser()
  if (!currentUser) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  scheduleCommunicationRetentionCleanup()

  const { id } = await context.params
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ success: false, error: 'Dosya bilgisi geçersiz.' }, { status: 400 })
  }

  const sourceAttachment = await prisma.internalCommunicationAttachment.findUnique({
    where: { id: BigInt(id) },
    select: {
      communication: {
        select: {
          senderUserId: true,
          senderArchivedAt: true,
          recipients: {
            where: { recipientUserId: currentUser.id, archivedAt: null },
            select: { id: true },
          },
        },
      },
    },
  })

  const mayAccessSource = sourceAttachment && (
    (sourceAttachment.communication.senderUserId === currentUser.id && !sourceAttachment.communication.senderArchivedAt)
    || sourceAttachment.communication.recipients.length > 0
  )
  if (!mayAccessSource) {
    return NextResponse.json({ success: false, error: 'Bu dosyaya erişim yetkiniz yok.' }, { status: 403 })
  }

  const attachment = await getCommunicationAttachmentFromStorage(BigInt(id))

  if (!attachment) {
    return NextResponse.json({ success: false, error: 'Dosya bulunamadı.' }, { status: 404 })
  }

  const currentUserId = currentUser.id.toString()
  const mayAccess = attachment.sender_user_id === currentUserId
    || attachment.recipient_user_ids.includes(currentUserId)
  if (!mayAccess) {
    return NextResponse.json({ success: false, error: 'Bu dosyaya erişim yetkiniz yok.' }, { status: 403 })
  }

  const safeFileName = attachment.file_name.replace(/[\r\n"]/g, '_')
  const disposition = new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'
  return new Response(Uint8Array.from(attachment.content).buffer, {
    headers: {
      'Content-Type': attachment.mime_type,
      'Content-Length': String(attachment.file_size),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(safeFileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
