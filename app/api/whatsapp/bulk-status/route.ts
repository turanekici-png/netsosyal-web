import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getBulkJobState } from '@/lib/services/whatsappBulk.service'

export const dynamic = 'force-dynamic'

// GET - devam eden (ya da en son biten) toplu WhatsApp gönderiminin
// ilerleme durumunu döner. İstemci bunu birkaç saniyede bir sorgulayarak
// ilerleme çubuğunu/sonuç listesini günceller. SMS ile AYNI yetkiye
// ("documents.sms") bağlıdır.
export async function GET() {
  const accessDenied = await requireApiAccess({ action: 'documents.sms' })
  if (accessDenied) return accessDenied

  return NextResponse.json({ success: true, data: getBulkJobState() })
}
