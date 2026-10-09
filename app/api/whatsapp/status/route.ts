import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getWhatsappState } from '@/lib/services/whatsappWeb.service'

export const dynamic = 'force-dynamic'

// GET - o an sunucudaki TEK WhatsApp oturumunun durumunu döner (bağlı mı,
// QR bekleniyor mu, bağlı numara ne). Ayarlar sayfası VE üst menüdeki
// gösterge bunu periyodik olarak çağırarak QR/bağlantı durumunu canlı
// gösterir. "settings.whatsapp" işlem yetkisi gerekir - tam yetkili
// (admin) kullanıcılar zaten her zaman geçer, admin OLMAYAN bir kullanıcıya
// da Kullanıcı Yetkileri'nden bu tek işlem AYRICA verilebilir. QR kod
// eşleştirme anındayken görülebiliyor olması, başka bir kullanıcının o
// QR'ı KENDİ telefonuyla okutup kurum oturumunu ele geçirmesine yol
// açabileceği için hala GENEL erişime AÇIK DEĞİLDİR.
export async function GET() {
  const accessDenied = await requireApiAccess({ action: 'settings.whatsapp' })
  if (accessDenied) return accessDenied

  const state = getWhatsappState()
  return NextResponse.json({ success: true, data: state })
}
