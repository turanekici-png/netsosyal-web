import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { cancelBulkWhatsappSend, getBulkJobState } from '@/lib/services/whatsappBulk.service'

export const dynamic = 'force-dynamic'

// POST - devam eden toplu WhatsApp gönderimini iptal eder. O ana kadar
// gönderilmiş olan mesajlar geri alınmaz, sadece KALAN kayıtlara gönderim
// durdurulur. SMS ile AYNI yetkiye ("documents.sms") bağlıdır.
export async function POST() {
  const accessDenied = await requireApiAccess({ action: 'documents.sms' })
  if (accessDenied) return accessDenied

  cancelBulkWhatsappSend()
  return NextResponse.json({ success: true, data: getBulkJobState() })
}
