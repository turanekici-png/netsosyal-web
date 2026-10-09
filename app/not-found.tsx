'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Var olmayan bir adres istendiginde (ör. eski yer imi, yanlis yazilmis URL)
// gosterilir.
//
// GUVENLIK/UX DUZELTMESI (14 Eylul 2026, 8. tur): Kullanici "/onlinebasvuru"
// adresini bir harf EKSIK yazinca ("/onlinebasvur"), oturumu acik olan bu
// tarayicida (kendi personel oturumu) bu sayfa - eskiden - ic yonetim
// KABUGU (sidebar/header) ICINDE goruntuleniyordu, cunku AppShell sadece
// TAM eslesen "/online?form=..." / "/onlinebasvuru" yollarini "genel erisim"
// sayiyordu; herhangi bir yazim hatasi bu istisnanin DISINDA kalip normal ic
// sayfa muamelesi goruyordu (oturum acik oldugu icin sidebar/header
// gosteriliyordu). Gercek (oturumsuz) bir vatandas icin bu ZATEN GUVENLIydi
// (proxy.ts, oturumu olmayan HERHANGI bir istegi - typo dahil - /login'e
// yonlendirir, kabuk/veri hic uretilmez) - ama kullanicinin istegi acik:
// online basvuru alani, oturum durumundan BAGIMSIZ, HER ZAMAN kendi basina
// (kabuksuz) acilsin. Bunun icin AppShell.tsx'teki "genel erisim" kontrolu
// "/online" ile baslayan TUM yollari (yazim hatalari dahil, sadece TAM
// "/online" - ic yonetimdeki "Vatandaş Başvuru Listesi" - haric) kapsayacak
// sekilde genisletildi. Bu sayfa da, o baglamda goruntulendiginde "Ana
// Sayfaya Dön" yerine "/onlinebasvuru"ya donen bir baglanti gostersin diye
// pathname'e gore uyarlaniyor - aksi halde ic yonetimdeki "/dashboard"
// baglantisini (oturum gerektiren) gosterip vatandasi yanlis yone yonlendirirdi.
function isOnlineApplicationPath(pathname: string) {
  return pathname.toLowerCase().startsWith('/online') && pathname !== '/online'
}

export default function NotFound() {
  const pathname = usePathname()
  const isOnlineContext = isOnlineApplicationPath(pathname || '')

  return (
    <div className="flex min-h-[420px] items-center justify-center p-4">
      <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-lg font-black text-slate-500 dark:bg-slate-800">
          ?
        </div>
        <h1 className="mt-4 text-xl font-black text-slate-950 dark:text-slate-100">Sayfa bulunamadı</h1>
        <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-400">
          Aradığınız sayfa taşınmış veya hiç var olmamış olabilir.
        </p>
        <div className="mt-5">
          <Link
            href={isOnlineContext ? '/onlinebasvuru' : '/dashboard'}
            className="inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
          >
            {isOnlineContext ? 'Online Başvuru Ana Sayfasına Dön' : 'Ana Sayfaya Dön'}
          </Link>
        </div>
      </div>
    </div>
  )
}
