import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import { headers } from "next/headers"
import { AppShell } from "../components/layout/AppShell"
import { Providers } from "../components/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Sosyal Yardım Yönetim Sistemi",
  description: "Sosyal yardım programı yönetimi",
  // Telefon tarayicilarinin TC kimlik / dosya no gibi rakam dizilerini
  // otomatik olarak "aranabilir telefon numarasi" linkine cevirmesini
  // engeller (mobilde yaygin ve rahatsiz edici bir sorun).
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Sosyal Yardım" },
}

// Kullanici istegi (Ekim 2026): "her deploy sonrasi tarayicida ESKI ekran
// kaliyor" (ör. kaldirilan "Kısayollar" paneli hala goruniyor). Kok neden:
// 'use client' sayfalar Next tarafindan "○ statik" isaretlenip 1 YILLIK
// (s-maxage=31536000) onbellek basligi aliyor; ne sayfa ici "export const
// dynamic" (client bilesende yok sayilir) ne next.config headers() (statik
// sayfalarda Cache-Control'u wildcard ile ezemiyor) ne de middleware
// (statik yanit basligini gecemiyor) bunu duzeltebiliyor. TEK guvenilir
// cozum: KOK (server) layout'ta tum agaci dinamik render'a zorlamak -
// boylece hicbir sayfa statik onbelleklenmez, her istekte taze gelir.
// (Uygulama zaten kucuk kullanicili bir ic arac; statik optimizasyon
// kaybinin pratik etkisi yok.)
export const dynamic = 'force-dynamic'

// Profesyonel mobil gorunum - dogru viewport, centik (notch) guvenli alani
// ve tarayici ust cubugu rengi.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0E7C86" },
    { media: "(prefers-color-scheme: dark)", color: "#131d33" },
  ],
}

// Tema secimi sayfa boyanmadan ONCE uygulanmali - aksi halde her acilista
// kisa bir an acik (varsayilan) tema gorunup hemen ardindan koyu temaya
// gecerken bir "yanip sonme" (FOUC) olusur. Bu script React hidrasyonundan
// bagimsiz, dogrudan <head> icinde, senkron calisir.
//
// Kullanici istegi (Eylul 2026): ilk acilista HER ZAMAN gunduz (light) modu.
// Isletim sisteminin koyu tema tercihine BAKILMAZ - koyu tema yalnizca
// kullanici tema dugmesinden acikca "dark" sectiyse (localStorage'da 'dark')
// uygulanir.
const themeInitScript = `
(function () {
  try {
    var isDark = localStorage.getItem('theme') === 'dark';
    if (isDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // proxy.ts, oturumu olmayan bir istekte korumali bir sayfayi sessizce
  // "Sayfa bulunamadı" olarak sunarken (bkz. proxy.ts 10. tur notu) bu
  // basligi isaretliyor. usePathname() (istemci tarafi) rewrite HEDEFINI
  // degil TARAYICIDA GORUNEN orijinal adresi dondurdugu icin, AppShell
  // salt pathname'e bakarak bunun sahte-404 oldugunu guvenilir sekilde
  // anlayamaz - bu yuzden karar burada, SUNUCU tarafinda, senkron olarak
  // verilip AppShell'e acik bir prop olarak geciriliyor.
  const requestHeaders = await headers()
  const forceStandalone = requestHeaders.get('x-netsosyal-unauth-notfound') === '1'

  return (
    <html lang="tr" className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="h-full overflow-hidden">
        <Providers>
          <Suspense fallback={null}>
            <AppShell forceStandalone={forceStandalone}>{children}</AppShell>
          </Suspense>
        </Providers>
      </body>
    </html>
  )
}
