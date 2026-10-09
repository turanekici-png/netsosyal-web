import type { Metadata } from 'next'
import { AsistanChat } from './AsistanChat'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sosyal Asistan',
}

// Kullanici istegi (14 Eylul 2026, 23. tur): "sosyal asistan" - dogal dille
// soru sorulabilen, veritabanina hakim bir yapay zeka asistani. Sayfa
// HERKESE acik (bkz. lib/constants/pageAccess.ts + sidebar.tsx /asistan
// istisnasi) - veri erisimi asistanin kendi ic kontrolleriyle (bkz.
// lib/services/asistanSql.service.ts) kullanicinin MEVCUT yetkisine gore
// sinirlanir.
export default function AsistanPage() {
  return (
    <div className="flex h-full w-full flex-col">
      {/* Kullanici istegi (15 Eylul 2026, 31. tur): "sosyal asistan basligi
          hic gitmesin" - "shrink-0" (varsayilan) zaten bu basligin AsistanChat
          ile ayni yukseklikte SIKISTIRILMAMASINI saglar; "sticky top-0"
          EKSTRA bir guvenlik agi - sayfanin sardigi disandaki kaydirma
          alani (AppShell'deki <main>) her nasilsa devreye girse bile
          baslik ekranin USTUNE yapisik kalir, kaybolmaz. */}
      <div className="sticky top-0 z-10 mb-4 shrink-0 bg-gray-100 pb-1 dark:bg-slate-950">
        <p className="text-lg font-black uppercase tracking-wide text-[#1E2A38]">Sosyal Asistan</p>
        <h1 className="text-2xl font-black text-slate-950 sm:text-3xl">Nasıl yardımcı olabilirim?</h1>
        <p className="mt-1.5 text-xl font-semibold text-slate-500">
          Dosya, yardım, başvuru veya istatistikle ilgili sorularınızı doğal dille sorabilirsiniz. Yalnızca kendi yetkiniz dahilindeki verileri görürsünüz.
        </p>
      </div>
      <AsistanChat />
    </div>
  )
}
