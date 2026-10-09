import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getCommunicationUser } from '@/lib/communicationAuth'
import { saveCommunicationToStorage } from '@/lib/db/communicationStorage'
import {
  communicationAttachmentCutoff,
  communicationMessageCutoff,
  scheduleCommunicationRetentionCleanup,
} from '@/lib/services/communicationRetention.service'

export const dynamic = 'force-dynamic'

const serialize = (item: any, currentUserId: bigint) => ({
  id: item.id.toString(),
  type: item.type,
  subject: item.subject,
  content: item.content,
  priority: item.priority,
  senderUserId: item.senderUserId.toString(),
  senderName: item.sender?.kullanicitamadi || item.sender?.username || 'Kullanıcı',
  recipients: (item.recipients || []).map((recipient: any) => ({
    userId: recipient.recipientUserId.toString(),
    name: recipient.user?.kullanicitamadi || recipient.user?.username || 'Kullanıcı',
    readAt: recipient.readAt,
  })),
  attachments: (item.attachments || []).map((attachment: any) => ({
    id: attachment.id.toString(),
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
  })),
  readAt: item.recipients?.find((recipient: any) => recipient.recipientUserId === currentUserId)?.readAt || null,
  startsAt: item.startsAt,
  expiresAt: item.expiresAt,
  createdAt: item.createdAt,
})

export async function GET(request: Request) {
  try {
    const currentUser = await getCommunicationUser()
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

  scheduleCommunicationRetentionCleanup()

  const url = new URL(request.url)
  const box = url.searchParams.get('box') === 'sent' ? 'sent' : 'inbox'
  const type = url.searchParams.get('type')
  const now = new Date()
  const messageCutoff = communicationMessageCutoff(now)
  const attachmentCutoff = communicationAttachmentCutoff(now)

  const items = await prisma.internalCommunication.findMany({
    where: {
      status: 'aktif',
      createdAt: { gte: messageCutoff },
      ...(type === 'mesaj' || type === 'duyuru' ? { type } : {}),
      ...(box === 'sent'
        ? { senderUserId: currentUser.id, senderArchivedAt: null }
        : {
            recipients: { some: { recipientUserId: currentUser.id, archivedAt: null } },
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
            ],
          }),
    },
    include: {
      recipients: true,
      attachments: {
        where: { createdAt: { gte: attachmentCutoff } },
        select: { id: true, fileName: true, mimeType: true, fileSize: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const userIds = [...new Set(items.flatMap((item) => [item.senderUserId, ...item.recipients.map((r) => r.recipientUserId)]))]
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, kullanicitamadi: true, username: true },
  })
  const usersById = new Map(users.map((user) => [user.id.toString(), user]))
  const hydrated = items.map((item) => ({
    ...item,
    sender: usersById.get(item.senderUserId.toString()),
    recipients: item.recipients.map((recipient) => ({
      ...recipient,
      user: usersById.get(recipient.recipientUserId.toString()),
    })),
  }))

  // Savunma katmanı: Veritabanı filtresine ek olarak yanıt oluşturulurken de
  // yalnızca oturum sahibinin alıcısı veya göndericisi olduğu kayıtları bırak.
  const visibleItems = hydrated.filter((item) => (
    box === 'sent'
      ? item.senderUserId === currentUser.id && !item.senderArchivedAt
      : item.recipients.some((recipient) => recipient.recipientUserId === currentUser.id)
  ))

    return NextResponse.json({ success: true, data: visibleItems.map((item) => serialize(item, currentUser.id)) })
  } catch (error) {
    console.error('[Kurum ici iletisim] Listeleme hatasi:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'İletiler alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCommunicationUser()
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

  scheduleCommunicationRetentionCleanup()

  const body = await request.json()
  const type = body.type === 'duyuru' ? 'duyuru' : 'mesaj'
  const content = String(body.content || '').trim()
  const subject = String(body.subject || '').trim().slice(0, 200) || null
  const priority = Math.max(0, Math.min(2, Number(body.priority) || 0))
  const rawAttachments: unknown[] = Array.isArray(body.attachments) ? body.attachments : []
  const allowedMimeTypes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  if (rawAttachments.length > 5) {
    return NextResponse.json({ success: false, error: 'Bir mesaja en fazla 5 dosya ekleyebilirsiniz.' }, { status: 400 })
  }
  const attachments = rawAttachments.map((raw) => {
    const attachment = raw as { fileName?: unknown; mimeType?: unknown; data?: unknown }
    const fileName = String(attachment.fileName || '').trim().slice(0, 255)
    const mimeType = String(attachment.mimeType || '').toLowerCase()
    const base64 = String(attachment.data || '').replace(/^data:[^;]+;base64,/, '')
    const content = Buffer.from(base64, 'base64')
    if (!fileName || !allowedMimeTypes.has(mimeType) || content.length === 0 || content.length > 5 * 1024 * 1024) {
      throw new Error('Yalnızca 5 MB altındaki PDF, PNG, JPG veya WEBP dosyaları gönderilebilir.')
    }
    return { fileName, mimeType, fileSize: content.length, content }
  })

  if ((!content && attachments.length === 0) || content.length > 10000) {
    return NextResponse.json({ success: false, error: 'İçerik 1-10000 karakter olmalıdır.' }, { status: 400 })
  }
  if (type === 'duyuru' && !currentUser.isAdmin) {
    return NextResponse.json({ success: false, error: 'Duyuru yayımlama yetkiniz yok.' }, { status: 403 })
  }
  if (type === 'duyuru' && !subject) {
    return NextResponse.json({ success: false, error: 'Duyuru başlığı zorunludur.' }, { status: 400 })
  }

  let recipientIds: bigint[]
  if (type === 'duyuru' && body.allUsers === true) {
    const users = await prisma.user.findMany({ where: { status: 1 }, select: { id: true } })
    recipientIds = users.map((user) => user.id).filter((id) => id !== currentUser.id)
  } else {
    const rawIds: unknown[] = Array.isArray(body.recipientUserIds) ? body.recipientUserIds : []
    const normalizedIds = rawIds.map((value) => String(value)).filter((id) => /^\d+$/.test(id))
    recipientIds = [...new Set<string>(normalizedIds)].map((id) => BigInt(id))
    const validUsers = await prisma.user.findMany({
      where: { id: { in: recipientIds }, status: 1 },
      select: { id: true },
    })
    recipientIds = validUsers.map((user) => user.id).filter((id) => id !== currentUser.id)
  }

  if (recipientIds.length === 0) {
    return NextResponse.json({ success: false, error: 'En az bir aktif alıcı seçmelisiniz.' }, { status: 400 })
  }
  const startsAt = type === 'duyuru' && body.startsAt ? new Date(body.startsAt) : null
  const expiresAt = type === 'duyuru' && body.expiresAt ? new Date(body.expiresAt) : null
  if (startsAt && Number.isNaN(startsAt.getTime()) || expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ success: false, error: 'Tarih bilgisi geçersiz.' }, { status: 400 })
  }
  if (startsAt && expiresAt && expiresAt <= startsAt) {
    return NextResponse.json({ success: false, error: 'Bitiş tarihi başlangıçtan sonra olmalıdır.' }, { status: 400 })
  }

  const created = await prisma.internalCommunication.create({
    data: {
      type,
      senderUserId: currentUser.id,
      subject,
      content: content || 'Dosya gönderildi.',
      priority,
      startsAt,
      expiresAt,
      recipients: { create: recipientIds.map((recipientUserId) => ({ recipientUserId })) },
      attachments: { create: attachments },
    },
    select: {
      id: true,
      attachments: {
        select: { id: true, fileName: true, mimeType: true, fileSize: true, content: true },
      },
    },
  })

  try {
    await saveCommunicationToStorage({
      sourceCommunicationId: created.id,
      type,
      senderUserId: currentUser.id,
      recipientUserIds: recipientIds,
      subject,
      content: content || 'Dosya gönderildi.',
      attachments: created.attachments.map((attachment) => ({
        sourceAttachmentId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        content: Buffer.from(attachment.content),
      })),
    })
  } catch (storageError) {
    await prisma.internalCommunication.delete({ where: { id: created.id } }).catch(() => null)
    throw storageError
  }

    return NextResponse.json({ success: true, data: { id: created.id.toString() } }, { status: 201 })
  } catch (error) {
    console.error('[Kurum ici iletisim] Gonderme hatasi:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'İleti gönderilemedi.' },
      { status: 500 },
    )
  }
}
