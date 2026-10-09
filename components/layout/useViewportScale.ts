'use client'

// KATMAN 0 - Kabuk olcekleme (bkz. ScaledArea.tsx).
//
// Ana icerik alaninin GERCEK kullanilabilir CSS genisligini olcup, sabit bir
// "tasarim genisligine" gore tek bir olcek katsayisi (0.7 - 1.0) uretir.
// Tarayici zoom'u bir REFLOW olayidir: %150 zoom, 1920px ekrani CSS'e ~1280px
// gosterir. Yani "zoom sorunu" ile "dusuk cozunurluk sorunu" AYNI sorundur;
// ikisini de tek "kullanilabilir CSS genisligi" ekseninde cozeriz.
//
// Not: host.clientWidth kasitli tercih (getBoundingClientRect DEGIL) - clientWidth
// olceklenmemis (layout) piksel dondurur; frame zaten `zoom` katmaninin DISINDA
// oldugu icin bu, gercek kullanilabilir genisliktir.

import { useEffect, useState, type RefObject } from 'react'

type Options = { designWidth?: number; min?: number; max?: number }

export function useViewportScale<T extends HTMLElement>(
  frameRef: RefObject<T | null>,
  { designWidth = 1500, min = 0.7, max = 1 }: Options = {},
): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const frame = frameRef.current
    const host = frame?.parentElement
    if (!frame || !host) return

    const compute = () => {
      // MOBIL (<768px): olcekleme YOK. Telefon/kucuk tablet zaten kendi
      // tek-sutun responsive duzenini kullanir; burada `zoom` uygularsak
      // duzen daha genis bir CSS genisliginde hesaplanip kuculur ve
      // container query'ler (panel @[...]) "yer var" sanip masaustu
      // duzenini acar -> ezik gorunum. Guvenlik agi sadece dar
      // masaustu/laptop (768-1600) icindir.
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setScale((prev) => (prev === 1 ? prev : 1))
        return
      }
      const available = host.clientWidth
      if (!available) return
      const next = Math.min(max, Math.max(min, available / designWidth))
      setScale((prev) => (Math.abs(prev - next) < 0.005 ? prev : +next.toFixed(3)))
    }

    compute()

    const ro = new ResizeObserver(compute)
    ro.observe(host)
    window.visualViewport?.addEventListener('resize', compute)
    window.addEventListener('resize', compute)

    return () => {
      ro.disconnect()
      window.visualViewport?.removeEventListener('resize', compute)
      window.removeEventListener('resize', compute)
    }
  }, [frameRef, designWidth, min, max])

  return scale
}
