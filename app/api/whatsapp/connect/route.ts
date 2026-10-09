import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getWhatsappState, initWhatsappClient, isReconnectCoolingDown, resetReconnectCooldown } from '@/lib/services/whatsappWeb.service'

export const dynamic = 'force-dynamic'

// POST - WhatsApp oturumunu başlatır/yeniden başlatır ("Bağlan" / "Yeniden
// Bağlan" butonu). Sonucu beklemeden hemen döner - QR kodu birazdan
// /api/whatsapp/status üzerinden gelir (istemci tarafı bunu poll eder).
// "settings.whatsapp" işlem yetkisi gerekir (bkz. status/route.ts) - kurumun
// PAYLAŞILAN oturumunu etkileyen bir yönetim işlemi, herkese açık olmamalı.
export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'settings.whatsapp' })
  if (accessDenied) return accessDenied

  let force = false
  try {
    const body = await request.json()
    force = Boolean(body?.force)
  } catch {
    // gövde boş olabilir, sorun değil
  }

  // ÖNEMLİ: force=true SADECE kullanıcının "Bağlan"/"Yeniden Dene"/"QR Kodu
  // Yenile" butonlarına ELLE basmasıyla gönderilir (bkz. settings/page.tsx
  // connectWhatsapp). Ayarlar sayfasının SESSİZ otomatik yeniden bağlanma
  // denemesi force=false gönderir - hız-sınırı koruması (bkz.
  // isReconnectCoolingDown yorumu) SADECE bu sessiz/otomatik istekleri
  // engeller; kullanıcı elle bastığında (force=true) her zaman hemen
  // denenir VE sayaç sıfırlanır.
  if (force) {
    resetReconnectCooldown()
  } else if (isReconnectCoolingDown()) {
    return NextResponse.json({ success: true, data: getWhatsappState() })
  }

  void initWhatsappClient(force).catch(() => { /* durum zaten state icinde tutulur */ })

  return NextResponse.json({ success: true, data: getWhatsappState() })
}
