import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getWhatsappState, logoutWhatsapp } from '@/lib/services/whatsappWeb.service'

export const dynamic = 'force-dynamic'

// POST - kurulu WhatsApp oturumunu tamamen kapatır ("Bağlantıyı Kes" butonu) -
// başka bir kurum numarasına geçmek istendiğinde kullanılır. "settings.whatsapp"
// işlem yetkisi gerekir (bkz. status/route.ts) - herhangi bir kullanıcının
// kurumun PAYLAŞILAN oturumunu kesebilmesi ciddi bir aksama riski olurdu.
export async function POST() {
  const accessDenied = await requireApiAccess({ action: 'settings.whatsapp' })
  if (accessDenied) return accessDenied

  await logoutWhatsapp()
  return NextResponse.json({ success: true, data: getWhatsappState() })
}
