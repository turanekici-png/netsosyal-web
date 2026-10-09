import webpush from 'web-push'
import { prisma } from '@/lib/db/prisma'
import { settingService } from './settings.service'
import { AUTHORIZED_PERSONNEL_SETTING_KEY, type AuthorizedPersonnelEntry } from '@/lib/constants/authorizedPersonnel'

// Web Push (masaüstü bildirim) - kullanıcının tarayıcı sekmesi kapalı/arka
// planda olsa bile (bilgisayar açık ve tarayıcı çalışır durumdaysa) işletim
// sisteminin kendi bildirim kutusunda bir uyarı gösterir. VAPID anahtarları
// olmadan hiçbir push gönderilemez - .env.local'de VAPID_PUBLIC_KEY/
// VAPID_PRIVATE_KEY tanımlı degilse bu modül sessizce devre dışı kalır
// (mevcut in-app bildirim/polling akışı bundan ETKİLENMEZ).
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:destek@netsosyal.local'

const isConfigured = Boolean(vapidPublicKey && vapidPrivateKey)

if (isConfigured) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey!, vapidPrivateKey!)
}

export function getPushPublicKey() {
  return isConfigured ? vapidPublicKey! : null
}

export function isPushConfigured() {
  return isConfigured
}

type PushSubscriptionInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

// NOT: bu veritabani PostgreSQL 9.4 - "ON CONFLICT" (9.5+ ozelligi)
// KULLANILAMAZ. Bunun yerine once UPDATE denenir, hic satir etkilenmediyse
// (endpoint daha once yoksa) INSERT yapilir - projede yerlesik olan ayni
// "once dene, olmadiysa ekle" deseni (bkz. convert-application/route.ts).
export async function saveSubscription(userId: number, subscription: PushSubscriptionInput, userAgent: string | null) {
  const updatedCount = await prisma.$executeRaw`
    UPDATE push_subscriptions
    SET kullaniciid = ${userId}, p256dh = ${subscription.keys.p256dh}, auth = ${subscription.keys.auth}, user_agent = ${userAgent}
    WHERE endpoint = ${subscription.endpoint}
  `

  if (updatedCount === 0) {
    await prisma.$executeRaw`
      INSERT INTO push_subscriptions (kullaniciid, endpoint, p256dh, auth, user_agent)
      VALUES (${userId}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, ${userAgent})
    `
  }
}

export async function removeSubscription(endpoint: string) {
  await prisma.$executeRaw`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`
}

export async function getSubscriptionStatus(userId: number, endpoint: string | null) {
  if (!endpoint) return false
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM push_subscriptions WHERE kullaniciid = ${userId} AND endpoint = ${endpoint} LIMIT 1
  `
  return rows.length > 0
}

type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

// Bir kullanicinin TUM cihaz/tarayici aboneliklerine push gonderir - biri
// artik gecerli degilse (410 Gone / kullanici bildirimleri kapatmis) o
// aboneligi sessizce veritabanindan siler, diger aboneliklere gondermeye
// DEVAM eder.
export async function sendPushToUser(userId: number, payload: PushPayload) {
  if (!isConfigured) return

  const subscriptions = await prisma.$queryRaw<{ endpoint: string; p256dh: string; auth: string }[]>`
    SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE kullaniciid = ${userId}
  `

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      )
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(sub.endpoint).catch(() => {})
      } else {
        console.error('Push gönderilemedi:', error)
      }
    }
  }))
}

export async function sendPushToUsers(userIds: number[], payload: PushPayload) {
  await Promise.all(Array.from(new Set(userIds)).map((id) => sendPushToUser(id, payload)))
}

// Belirli bir yetkili secilmeden gonderilen taleplerde ("Fark etmez - tüm
// yetkili personele gönder"), Ayarlar > Yetkili Personeller listesindeki
// HERKESE push gonderilir.
export async function sendPushToAuthorizedPersonnel(payload: PushPayload) {
  const setting = await settingService.getByKey(AUTHORIZED_PERSONNEL_SETTING_KEY)
  const list = (setting?.value as AuthorizedPersonnelEntry[] | undefined) ?? []
  const userIds = list.map((entry) => Number(entry.userId)).filter((id) => Number.isInteger(id))
  if (userIds.length > 0) await sendPushToUsers(userIds, payload)
}
