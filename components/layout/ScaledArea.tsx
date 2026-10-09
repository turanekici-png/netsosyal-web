'use client'

// KATMAN 0 - Kabuk olcekleme (guvenlik agi).
//
// SADECE ana icerik alanini (sidebar + header HARIC) sabit bir "tasarim
// genisligine" gore tek parca CSS `zoom` ile olcekler. Oran birebir korunur,
// REFLOW olmaz - paneller sekilsiz tasmak yerine oranli kuculur.
//
// Neden `zoom`, `transform: scale()` DEGIL:
//  - `zoom` kutuyu gercekten kuculttur -> yerlesim akisi, kaydirma ve
//    surukle-birak koordinatlari tutarli kalir.
//  - `transform: scale()` genislik telafisi + koordinat duzeltmesi ister,
//    sticky/overflow'u bozar.
//  - Destek: Chromium / Safari / Firefox 126+ (2024). Eski Firefox `zoom`'u
//    yok sayar -> sayfa 1.0'da kalir ama BOZULMAZ (kabul edilebilir).
//
// scale === 1 iken (genis ekran / dusuk zoom) hicbir inline stil verilmez;
// yani genis ekranlarda davranis birebir eskisi gibidir.

import { useRef } from 'react'
import { ScaleContext } from './ScaleContext'
import { useViewportScale } from './useViewportScale'
import { useShellZoom } from '@/lib/context/ShellZoomContext'
import { useUiScale } from '@/lib/context/UiScaleContext'

export function ScaledArea({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  // Kullanici istegi (2026-10-07): "her yerde sabit gercek boyut" - KATMAN 0
  // otomatik kucultme (dar ekranda sayfa icerigi oranli kuculurdu) KAPATILDI,
  // min=max=1 ile hook HER ZAMAN 1 doner. Sebep: pencereler (fixed inset-0,
  // bkz. globals.css ".app-scaled .fixed.inset-0") bu kucultmeden ZATEN
  // MUAFTI - ayni "18px" degeri pencerede tam boyut, sayfa icindeki tabloda
  // (dar ekranda) kucuk gorunuyordu; kullanici TUTARLILIGI (sabit boyut)
  // kucuk-ekrana-sigdirma kolayligina tercih etti. Kullanicinin KENDI elle
  // yakinlastirmasi (ShellZoomContext) ve hesap bazli arayuz boyutu
  // (UiScaleContext) buna DOKUNULMADAN calismaya devam eder - sadece
  // viewport genisligine gore OTOMATIK kucultme devre disi.
  const autoScale = useViewportScale(frameRef, { designWidth: 1500, min: 1, max: 1 })
  // Kullanici istegi (Eylul 2026): tarayici zoom'unun kaba adimlari yerine
  // uygulama ICI ince adimli (%2) elle yakinlastirma - otomatik olcegin
  // USTUNE carpan (bkz. ShellZoomContext).
  const { zoom: manualZoom } = useShellZoom()
  // Kullanici istegi (Eylul 2026): kisi kendi arayuz boyutunu secebilsin -
  // hesaba ozel, sunucuda saklanir (bkz. UiScaleContext). Varsayilan 1.
  const { uiScale } = useUiScale()
  const scale = +(autoScale * manualZoom * uiScale).toFixed(3)

  return (
    <ScaleContext.Provider value={scale}>
      <div ref={frameRef} className={`h-full w-full ${className ?? ''}`}>
        <div
          className="app-scaled h-full w-full"
          // --shell-unzoom: kabuk zoom'unu GERI ALAN carpan. Tam ekran acilan
          // pencereler (".app-modal") bunu kendi "zoom"una uygulayarak kabuk
          // olceginden BAGIMSIZ, gercek viewport boyutunda acilir (aksi halde
          // tablet/dar ekranda modal da %78 kuculup ortada kucuk bir kutu
          // gibi goruluyordu). Bkz. globals.css ".app-scaled .app-modal".
          style={scale !== 1
            ? ({ zoom: scale, '--shell-unzoom': String(+(1 / scale).toFixed(4)) } as React.CSSProperties)
            : ({ '--shell-unzoom': '1' } as React.CSSProperties)}
        >
          {children}
        </div>
      </div>
    </ScaleContext.Provider>
  )
}
