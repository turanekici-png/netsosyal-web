import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'
import { sendWhatsappMessage } from '@/lib/services/whatsappWeb.service'
import { logWhatsappSend } from '@/lib/services/whatsappLog.service'

export const dynamic = 'force-dynamic'

// POST - herhangi bir dosyadaki "WhatsApp'tan Gönder" butonu buraya bağlanır.
// Kullanıcı kendi WhatsApp hesabına GİRMEZ - mesaj, sunucuda tek bir yetkili
// tarafından bağlanmış olan KURUM WhatsApp oturumu üzerinden gider (bkz.
// lib/services/whatsappWeb.service.ts). SMS ile AYNI yetkiye ("documents.sms")
// bağlıdır - bu yetkisi olmayan bir kullanıcı API'yi doğrudan çağırsa bile
// mesaj gönderemez. Gönderim sonucu (başarılı/hatalı) her durumda
// sms_gonderim_log tablosuna (kanal='whatsapp') kaydedilir (bkz. Raporlar >
// WhatsApp Raporları).
export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'documents.sms' })
  if (accessDenied) return accessDenied

  const sessionUser = await getSessionUser()

  const body = await request.json().catch(() => null)
  const rawPhone = typeof body?.phone === 'string' ? body.phone : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const dosyaNo = typeof body?.dosyaNo === 'string' ? body.dosyaNo : null
  const dosyaId = typeof body?.dosyaId === 'string' || typeof body?.dosyaId === 'number' ? String(body.dosyaId) : null
  const adSoyad = typeof body?.adSoyad === 'string' ? body.adSoyad : null

  if (!message) {
    return NextResponse.json({ success: false, error: 'Mesaj metni boş olamaz.' }, { status: 400 })
  }

  const normalized = normalizeWhatsappPhoneNumber(rawPhone)
  if (!normalized) {
    return NextResponse.json({ success: false, error: 'Telefon numarası WhatsApp için uygun bir formatta değil.' }, { status: 400 })
  }

  const result = await sendWhatsappMessage(normalized, message)

  // ONEMLI: bu satir ARTIK bekleniyor (await) - eskiden "void" ile
  // beklenmeden atesleniyordu, bu da WhatsApp'in ilk "ack" olayi (mesaj
  // sunucuya ulasti) INSERT satiri henuz veritabaninda OLUSMADAN
  // gelirse, o ilk durum guncellemesinin sessizce KACIRILMASINA yol
  // acabiliyordu (recordWhatsappMessageAck satiri bulamayinca hicbir sey
  // yapmadan cikar - bkz. whatsappLog.service.ts).
  await logWhatsappSend({
    telefon: normalized,
    adisoyadi: adSoyad,
    dosyano: dosyaNo,
    dosyaid: dosyaId,
    mesaj: message,
    durum: result.ok ? 'gönderildi' : 'hata',
    cevap: result.ok ? null : (result.error || 'Bilinmeyen hata'),
    waMessageId: result.ok ? (result.messageId || null) : null,
    gonderimTipi: 'tekil',
    kullanici: sessionUser?.name || sessionUser?.username || null,
  })

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error || 'WhatsApp mesajı gönderilemedi.' }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
