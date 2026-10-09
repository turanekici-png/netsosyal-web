import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { startBulkWhatsappSend, type BulkRecipientInput } from '@/lib/services/whatsappBulk.service'

export const dynamic = 'force-dynamic'

// POST - herhangi bir liste ekranında (Dosyalar, Bireyler, Yardım Raporları,
// Online Başvurular vb.) seçilen kayıtların TAMAMINA mesaj toplu göndermeyi
// BAŞLATIR. Gövde: { recipients: [{id, phone, label, personalizedMessage?}], message }.
// "message" ortak sablon metnidir (ekranda gosterilir/loglanir); her alicinin
// "(isim)", "(telefon)" gibi kisayollari ONCEDEN istemci tarafinda (bkz.
// lib/messageTemplateTokens.ts) yerine konulup personalizedMessage olarak
// gonderilmis olabilir - varsa GERCEK gonderimde o kullanilir (bkz.
// whatsappBulk.service.ts - finalMessage). Hemen döner - gerçek gönderim
// arka planda devam eder, ilerleme /api/whatsapp/bulk-status ile izlenir.
// SMS ile AYNI yetkiye ("documents.sms") bağlıdır. Her gönderim sonucu
// sms_gonderim_log tablosuna (kanal='whatsapp') kaydedilir.
export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'documents.sms' })
  if (accessDenied) return accessDenied

  const sessionUser = await getSessionUser()

  const body = await request.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message : ''
  const rawRecipients = Array.isArray(body?.recipients) ? body.recipients : []

  const recipients: BulkRecipientInput[] = rawRecipients
    .filter((row: unknown): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ''),
      phone: typeof row.phone === 'string' ? row.phone : null,
      label: typeof row.label === 'string' ? row.label : null,
      dosyaNo: typeof row.dosyaNo === 'string' ? row.dosyaNo : null,
      dosyaId: typeof row.dosyaId === 'string' || typeof row.dosyaId === 'number' ? String(row.dosyaId) : null,
      personalizedMessage: typeof row.personalizedMessage === 'string' ? row.personalizedMessage : null,
    }))
    .filter((row: BulkRecipientInput) => row.id)

  const result = startBulkWhatsappSend(recipients, message, sessionUser?.name || sessionUser?.username || null)
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
