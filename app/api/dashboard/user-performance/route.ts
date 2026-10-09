import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getUserDailyActivityReport } from '@/lib/services/userDailyActivity.service'

export const dynamic = 'force-dynamic'

// Hata raporu: "ana sayfadaki özet veriler gelmiyor / çok geç geliyor" - kok
// neden: getUserDailyActivityReport() (bu ay boyunca TUM sistem hareket/
// denetim kayitlarini, kullanici+dosya bazinda pencere fonksiyonlariyla
// oturumlara ayiran AGIR bir sorgu - canli veride 70+ SANIYE surdugu
// olculdu) daha once app/api/dashboard/route.ts icindeki TEK BUYUK
// Promise.all'un BIR PARCASIYDI - bu da "Toplam Dosya" gibi ANINDA donmesi
// gereken basit sayilarin bile, bu tek agir sorgu bitene kadar EKRANA HIC
// YANSIMAMASINA (surekli "..." gostermeye) yol aciyordu.
//
// Cozum: bu rapor artik AYRI, kendi ucundan (bu dosya) cekiliyor - ana
// /api/dashboard cagrisini ARTIK BEKLEMIYOR/ENGELLEMIYOR (bkz.
// dashboard/page.tsx - ayri bir useEffect/loading state ile). Sorgunun
// KENDISI (lib/services/userDailyActivity.service.ts) DEGISTIRILMEDI -
// halen ayni 30 saniyelik onbellegi kullaniyor, bu yuzden "Genel Liste"/
// Personel Performans Raporu sayfasi da AYNI onbellekten faydalanmaya
// devam ediyor.
export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ page: '/dashboard' })
    if (accessDenied) return accessDenied

    const data = await getUserDailyActivityReport()

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kullanıcı performans raporu alınamadı.' },
      { status: 500 },
    )
  }
}
