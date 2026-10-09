import 'server-only'

import { prisma } from '@/lib/db/prisma'
import { cleanupCommunicationStorage } from '@/lib/db/communicationStorage'

export const COMMUNICATION_MESSAGE_RETENTION_DAYS = 180
export const COMMUNICATION_ATTACHMENT_RETENTION_DAYS = 30

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const globalForCommunicationRetention = globalThis as unknown as {
  communicationRetentionLastCleanupAt?: number
  communicationRetentionCleanupPromise?: Promise<void> | null
  communicationRetentionTimer?: ReturnType<typeof setInterval>
}

export function communicationMessageCutoff(now = new Date()) {
  return new Date(now.getTime() - COMMUNICATION_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

export function communicationAttachmentCutoff(now = new Date()) {
  return new Date(now.getTime() - COMMUNICATION_ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

async function cleanupExpiredCommunicationData() {
  const attachmentCutoff = communicationAttachmentCutoff()
  const messageCutoff = communicationMessageCutoff()

  await prisma.$transaction([
    prisma.internalCommunicationAttachment.deleteMany({
      where: { createdAt: { lt: attachmentCutoff } },
    }),
    prisma.internalCommunication.deleteMany({
      where: { createdAt: { lt: messageCutoff } },
    }),
  ])
  await cleanupCommunicationStorage()
}

export function scheduleCommunicationRetentionCleanup() {
  const now = Date.now()
  const lastCleanupAt = globalForCommunicationRetention.communicationRetentionLastCleanupAt || 0
  if (globalForCommunicationRetention.communicationRetentionCleanupPromise || now - lastCleanupAt < CLEANUP_INTERVAL_MS) return

  globalForCommunicationRetention.communicationRetentionLastCleanupAt = now
  globalForCommunicationRetention.communicationRetentionCleanupPromise = cleanupExpiredCommunicationData()
    .catch((error) => {
      globalForCommunicationRetention.communicationRetentionLastCleanupAt = 0
      console.error('[Kurum ici iletisim] Saklama suresi temizligi basarisiz:', error)
    })
    .finally(() => {
      globalForCommunicationRetention.communicationRetentionCleanupPromise = null
    })
}

export function startCommunicationRetentionScheduler() {
  if (globalForCommunicationRetention.communicationRetentionTimer) return

  scheduleCommunicationRetentionCleanup()
  globalForCommunicationRetention.communicationRetentionTimer = setInterval(
    scheduleCommunicationRetentionCleanup,
    CLEANUP_INTERVAL_MS,
  )
}
