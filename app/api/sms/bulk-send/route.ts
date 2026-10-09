import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { startBulkSmsSend, type SmsBulkRecipientInput } from '@/lib/services/smsBulk.service'

export const dynamic = 'force-dynamic'

// POST - herhangi bir liste ekranında (Dosyalar, Bireyler, Yardım Raporları,
// Nakit Müracaatları vb.) seçilen kayıtların TAMAMINA SMS toplu göndermeyi
// BAŞLATIR - bkz. app/api/whatsapp/bulk-send/route.ts (BİREBİR aynı desen).
// Gövde: { recipients: [{id, phone, label, personalizedMessage?}], message }.
// Hemen döner - gerçek gönderim arka planda devam eder, ilerleme
// /api/sms/bulk-status ile izlenir. WhatsApp ile AYNI yetkiye
// ("documents.sms") bağlıdır. Her gönderim sonucu sms_gonderim_log
// tablosuna (kanal='sms') kaydedilir.
export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'documents.sms' })
  if (accessDenied) return accessDenied

  const sessionUser = await getSessionUser()

  const body = await request.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message : ''
  const rawRecipients = Array.isArray(body?.recipients) ? body.recipients : []

  const recipients: SmsBulkRecipientInput[] = rawRecipients
    .filter((row: unknown): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ''),
      phone: typeof row.phone === 'string' ? row.phone : null,
      label: typeof row.label === 'string' ? row.label : null,
      dosyaNo: typeof row.dosyaNo === 'string' ? row.dosyaNo : null,
      dosyaId: typeof row.dosyaId === 'string' || typeof row.dosyaId === 'number' ? String(row.dosyaId) : null,
      personalizedMessage: typeof row.personalizedMessage === 'string' ? row.personalizedMessage : null,
    }))
    .filter((row: SmsBulkRecipientInput) => row.id)

  const result = startBulkSmsSend(recipients, message, sessionUser?.name || sessionUser?.username || null)
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
