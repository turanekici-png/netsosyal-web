import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { sendSmsMessage } from '@/lib/services/smsProvider.service'

export const dynamic = 'force-dynamic'

// POST - Dosya detayındaki "SMS Gönder" butonu buraya bağlanır. Ayarlar >
// Sistem Ayarları > SMS Entegrasyonu'nda tanımlı AKTİF SMS firması
// (Mutlucell / İleti Bilgi Teknolojileri / NetGSM) üzerinden GERÇEK SMS
// gönderimi yapar - bkz. lib/services/smsProvider.service.ts. WhatsApp ile
// AYNI yetkiye ("documents.sms") bağlıdır. Gönderim sonucu (başarılı/hatalı)
// her durumda sms_gonderim_log tablosuna (kanal='sms') kaydedilir (bkz.
// Raporlar > SMS Raporları, Dosya Yönetimi > Mesaj Raporları).
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
  const tcKimlik = typeof body?.tcKimlik === 'string' ? body.tcKimlik : null

  if (!message) {
    return NextResponse.json({ success: false, error: 'Mesaj metni boş olamaz.' }, { status: 400 })
  }
  if (!rawPhone.trim()) {
    return NextResponse.json({ success: false, error: 'Telefon numarası boş olamaz.' }, { status: 400 })
  }

  const result = await sendSmsMessage(rawPhone, message)

  await prisma.sms_gonderim_log.create({
    data: {
      telefon: rawPhone,
      adisoyadi: adSoyad,
      dosyano: dosyaNo,
      dosyaid: dosyaId,
      tckimlikno: tcKimlik,
      mesaj: message,
      durum: result.ok ? 'gönderildi' : 'hata',
      cevap: result.ok ? null : (result.error || result.raw || 'Bilinmeyen hata'),
      sms_tipi: 'tekil',
      kanal: 'sms',
      kullanici: sessionUser?.name || sessionUser?.username || null,
    },
  }).catch(() => { /* loglama basarisiz olsa bile gonderim sonucu degismez - yan islem */ })

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error || 'SMS gönderilemedi.' }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
