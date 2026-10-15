import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { getBilgiTabani } from '@/lib/services/aiAssistant.service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 2026-10-15: Sosyal Asistan sohbet ekranindaki "Hazır Sorular" dugmeleri.
// Sohbet sayfasi gibi yalniz OTURUM ister (bkz. chat/route.ts) - donen veri
// sadece Ayarlar'da tanimlanan etiket/soru metinleridir, gizli bilgi icermez.
export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const { hazirSorular } = await getBilgiTabani()
  return NextResponse.json({
    success: true,
    data: hazirSorular.filter((soru) => soru.aktif).map(({ id, kategori, etiket, soru }) => ({ id, kategori, etiket, soru })),
  })
}
