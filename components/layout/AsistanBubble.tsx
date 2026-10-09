'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { AsistanChat } from '@/app/(modules)/asistan/AsistanChat'

// Kullanici istegi (14 Eylul 2026, 23. tur): "her sayfada yuzen bir
// baloncuk da olsun" - Sosyal Asistan artik sadece kendi sayfasinda degil,
// AppShell icindeki HER ic sayfada sagalt kosede acilir-kapanir bir
// baloncuk olarak da erisilebilir. AsistanChat.tsx (mevcut sohbet mantigi/
// UI'i) HICBIR DEGISIKLIK yapilmadan aynen tekrar kullanildi - sadece
// sabit boyutlu bir kutuya sarildi (kendisi zaten "flex-1" ile parent
// yuksekligini doldurur).
export function AsistanBubble() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  // /asistan sayfasinin kendisinde zaten tam ekran sohbet var - baloncuk
  // orada tekrar gostermez (gereksiz/kafa karistirici olurdu).
  if (pathname === '/asistan' || pathname?.startsWith('/asistan/')) return null

  return (
    <>
      {isOpen && (
        // Kullanici istegi (15 Eylul 2026, 29. tur): "altindaki boslugu
        // kaldiralim, genisligini artiralim, boyunu kisaltalim" - yukseklik
        // belirgin sekilde azaltildi (440 -> 340px) ve genislik artirildi
        // (340 -> 400px), boylece bos durumdaki (sadece ipucu kutusu olan)
        // panel cok daha az bos alan birakiyor.
        // Kullanici istegi (15 Eylul 2026, 31. tur): "kenarini renklendir
        // daha estetik gorunsun" - duz gri kenarlik yerine marka rengiyle
        // (mavi) uyumlu, hafif parlak bir kenarlik + daha yumusak/derin golge.
        <div className="fixed bottom-20 right-4 z-[1200] flex h-[min(70vh,620px)] w-[min(97vw,600px)] flex-col overflow-hidden rounded-xl border-2 border-[#0076b6]/40 bg-white shadow-[0_20px_50px_rgba(0,118,182,0.25)] ring-1 ring-[#0076b6]/10 sm:bottom-24 sm:right-6">
          <div className="flex shrink-0 items-center justify-between gap-2 rounded-t-xl border-b border-black/5 bg-[#0076b6] px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-black tracking-wide text-white">
              <span className="text-lg leading-none">🤖</span> Sosyal Asistan
            </p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Kapat"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-sm text-white transition hover:bg-white/25"
            >
              ✕
            </button>
          </div>
          {/* Kullanici istegi (15 Eylul 2026, 37. tur): "kaydirma cubugu
              cikmiyor, baslik kayboluyor" - GERCEK kok neden bulundu:
              bu sarmalayici "flex-1 min-h-0" TASIYORDU ama KENDISI
              "display:flex" DEGILDI - flex-1/min-h-0, SADECE flex bir
              kapsayicinin ICINDEKI oge icin anlamlidir. Flex olmayan bu
              div'in icinde AsistanChat'in KENDI "flex-1"i hicbir sey
              yapmiyordu, bu yuzden sohbet kutusu kisitlanmadan buyuyup
              baloncugun sinirlarinin (overflow:hidden) DISINA gorunmez
              sekilde tasiyordu - kaydirma cubugu hic devreye girmiyordu.
              Headless Chrome ile birebir ayni yapiyi test ederek dogrulandi.
              "flex flex-col" eklenerek asil sorun cozuldu. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <AsistanChat compact />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? 'Sosyal Asistanı kapat' : 'Sosyal Asistanı aç'}
        className={`fixed bottom-4 right-4 z-[1200] flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition hover:scale-105 sm:bottom-6 sm:right-6 ${
          isOpen ? 'bg-slate-700' : 'bg-[#0076b6]'
        }`}
      >
        {isOpen ? (
          <span className="text-lg text-white">✕</span>
        ) : (
          <span className="text-xl">🤖</span>
        )}
      </button>
    </>
  )
}
