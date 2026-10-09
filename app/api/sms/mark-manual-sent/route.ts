import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'

export const dynamic = 'force-dynamic'

// POST - kullanıcı bir kaydı UYGULAMA DIŞINDA (ör. kendi telefonundan) zaten
// SMS ile bilgilendirmişse, bunu sisteme GERÇEK bir gönderim yapmadan - sadece
// kayıt/rapor amacıyla - "gönderildi" olarak işlemek için. Herhangi bir liste
// ekranında seçilen kayıtların TAMAMI için sms_gonderim_log'a (kanal='sms',
// sms_tipi='manuel', durum='gönderildi') bir satır eklenir - bkz.
// components/shared/MarkManualSentButton.tsx. WhatsApp/SMS toplu gönderimle
// (bulk-send) AYNI yetkiye ("documents.sms") bağlıdır; gerçek bir mesaj
// GÖNDERİLMEZ, sadece "Son Mesaj Durumu" sütununda/SMS Raporları'nda görünsün
// diye kayıt oluşturulur.
type ManualSentRecipient = {
  id?: string
  phone?: string | null
  label?: string | null
  dosyaNo?: string | null
  dosyaId?: string | number | null
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'documents.sms' })
  if (accessDenied) return accessDenied

  const sessionUser = await getSessionUser()

  const body = await request.json().catch(() => null)
  const rawRecipients = Array.isArray(body?.recipients) ? body.recipients : []
  const recipients: ManualSentRecipient[] = rawRecipients
    .filter((row: unknown): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row: Record<string, unknown>) => ({
      id: typeof row.id === 'string' ? row.id : undefined,
      phone: typeof row.phone === 'string' ? row.phone : null,
      label: typeof row.label === 'string' ? row.label : null,
      dosyaNo: typeof row.dosyaNo === 'string' ? row.dosyaNo : null,
      dosyaId: typeof row.dosyaId === 'string' || typeof row.dosyaId === 'number' ? row.dosyaId : null,
    }))

  if (recipients.length === 0) {
    return NextResponse.json({ success: false, error: 'Seçili kayıt yok.' }, { status: 400 })
  }

  const kullanici = sessionUser?.name || sessionUser?.username || null
  let markedCount = 0
  let skippedCount = 0

  for (const recipient of recipients) {
    const normalized = normalizeWhatsappPhoneNumber(recipient.phone)
    if (!normalized) {
      skippedCount += 1
      continue
    }

    await prisma.sms_gonderim_log.create({
      data: {
        telefon: normalized,
        adisoyadi: recipient.label?.trim() || null,
        dosyano: recipient.dosyaNo || null,
        dosyaid: recipient.dosyaId != null ? String(recipient.dosyaId) : null,
        mesaj: 'Uygulama dışında (manuel) gönderildi - kullanıcı tarafından işaretlendi.',
        durum: 'gönderildi',
        sms_tipi: 'manuel',
        kanal: 'sms',
        kullanici,
      },
    }).catch(() => { /* tek bir kaydin loglanmasi basarisiz olsa bile digerleri islenmeye devam eder */ })
    markedCount += 1
  }

  return NextResponse.json({ success: true, data: { markedCount, skippedCount } })
}
