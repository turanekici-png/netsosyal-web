// Onay bekleyen işlem bildirimlerini (bkz. lib/services/webPush.service.ts)
// EK OLARAK, sadece bunu AÇIKÇA isteyen yetkililerin kendi kayıtlı telefon
// numarasına (kullanicilar.telefon) WhatsApp üzerinden de gönderir - bkz.
// lib/services/whatsappWeb.service.ts (tek kurum oturumu). Kullanıcının bunu
// isteyip istemediği Ayarlar > Kullanıcı Yetkileri'nde
// UserPermissionConfig.whatsappNotifications alanıyla belirlenir; varsayılan
// KAPALIdır - hiçbir kullanıcıya izinsiz WhatsApp mesajı gönderilmez.

import { prisma } from '@/lib/db/prisma'
import { settingService } from './settings.service'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { AUTHORIZED_PERSONNEL_SETTING_KEY, type AuthorizedPersonnelEntry } from '@/lib/constants/authorizedPersonnel'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'
import { sendWhatsappMessage } from './whatsappWeb.service'
import { logWhatsappSend } from './whatsappLog.service'

async function isWhatsappNotificationEnabled(userId: number): Promise<boolean> {
  const setting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
  const configs = (setting?.value as UserPermissionsById | undefined) ?? {}
  return configs[String(userId)]?.whatsappNotifications === true
}

// userId -> {telefon, ad} (normalize edilmis telefon yoksa/gecersizse null).
async function getUserWhatsappTarget(userId: number): Promise<{ phone: string | null; name: string | null }> {
  const rows = await prisma.$queryRaw<{ telefon: string | null; kullanicitamadi: string | null }[]>`
    SELECT telefon, kullanicitamadi FROM kullanicilar WHERE id = ${userId} LIMIT 1
  `
  return {
    phone: normalizeWhatsappPhoneNumber(rows[0]?.telefon ?? null),
    name: rows[0]?.kullanicitamadi ?? null,
  }
}

export async function sendWhatsappNotificationToUser(userId: number, message: string): Promise<void> {
  try {
    const enabled = await isWhatsappNotificationEnabled(userId)
    if (!enabled) return

    const { phone, name } = await getUserWhatsappTarget(userId)
    if (!phone) return

    const result = await sendWhatsappMessage(phone, message)
    // await: ilk "ack" olayi, log satiri veritabaninda olusmadan gelip
    // kacirilmasin diye (bkz. app/api/whatsapp/send/route.ts'teki not).
    await logWhatsappSend({
      telefon: phone,
      adisoyadi: name,
      mesaj: message,
      durum: result.ok ? 'gönderildi' : 'hata',
      cevap: result.ok ? null : (result.error || 'Bilinmeyen hata'),
      waMessageId: result.ok ? (result.messageId || null) : null,
      gonderimTipi: 'otomatik-bildirim',
      kullanici: 'Sistem',
    })
  } catch {
    // Bildirim ikincil (yan) bir islemdir - hicbir zaman ana akisi bozmamali.
  }
}

export async function sendWhatsappNotificationToUsers(userIds: number[], message: string): Promise<void> {
  await Promise.all(Array.from(new Set(userIds)).map((id) => sendWhatsappNotificationToUser(id, message)))
}

// Belirli bir yetkili secilmeden gonderilen taleplerde ("Fark etmez - tüm
// yetkili personele gönder"), Ayarlar > Yetkili Personeller listesindeki
// HERKESE (icinden sadece WhatsApp bildirimini acmis olanlara) gonderilir.
export async function sendWhatsappNotificationToAuthorizedPersonnel(message: string): Promise<void> {
  try {
    const setting = await settingService.getByKey(AUTHORIZED_PERSONNEL_SETTING_KEY)
    const list = (setting?.value as AuthorizedPersonnelEntry[] | undefined) ?? []
    const userIds = list.map((entry) => Number(entry.userId)).filter((id) => Number.isInteger(id))
    if (userIds.length > 0) await sendWhatsappNotificationToUsers(userIds, message)
  } catch {
    // yoksay - ikincil bildirim
  }
}
