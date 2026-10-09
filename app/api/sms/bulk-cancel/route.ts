import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { cancelBulkSmsSend, getSmsBulkJobState } from '@/lib/services/smsBulk.service'

export const dynamic = 'force-dynamic'

// POST - devam eden toplu SMS gönderimini iptal eder. O ana kadar gönderilmiş
// olan mesajlar geri alınmaz, sadece KALAN kayıtlara gönderim durdurulur.
// WhatsApp ile AYNI yetkiye ("documents.sms") bağlıdır.
export async function POST() {
  const accessDenied = await requireApiAccess({ action: 'documents.sms' })
  if (accessDenied) return accessDenied

  cancelBulkSmsSend()
  return NextResponse.json({ success: true, data: getSmsBulkJobState() })
}
