import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { setWhatsappDisplayName } from '@/lib/services/whatsappWeb.service'

export const dynamic = 'force-dynamic'

// POST - bağlı WhatsApp hesabının profil/görünen adını değiştirir ("Kurum
// Görünen Adı" - Ayarlar > Sistem Ayarları > WhatsApp Web). Bu, numarayı
// rehberine kaydetmemiş alıcıların mesajın yanında çıplak numara yerine
// kurum adını görmesini sağlar. "settings.whatsapp" işlem yetkisi gerekir
// (bkz. status/route.ts).
export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'settings.whatsapp' })
  if (accessDenied) return accessDenied

  const body = await request.json().catch(() => null)
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''

  if (!displayName) {
    return NextResponse.json({ success: false, error: 'Görünen ad boş olamaz.' }, { status: 400 })
  }

  const result = await setWhatsappDisplayName(displayName)
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error || 'Görünen ad değiştirilemedi.' }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
