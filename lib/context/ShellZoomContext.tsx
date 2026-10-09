'use client'

// Kullanici istegi (Eylul 2026): "tarayici zoom'u (Ctrl +/-) %67'den %50'ye
// gibi buyuk adimlarla ziplyor, ekrani ayarlamak zor - birer birer buyusun/
// kucculsun". Tarayicinin kendi zoom adimlarini degistiremeyiz; onun yerine
// uygulama ICINDE, ince adimli (%2) kendi "kabuk yakinlastirma" carpanimiz.
// KATMAN 0 otomatik olceklemenin (bkz. ScaledArea / useViewportScale) USTUNE
// carpan olarak uygulanir: efektif zoom = otomatikOlcek * elleZoom.
//
// Bu ayar KASITLI olarak tarayiciya (localStorage) ozeldir, kullanici
// hesabina DEGIL - "ekranima sigsin" ihtiyaci monitore/cozunurluge baglidir,
// ayni hesapla farkli bir bilgisayardan girildiginde o bilgisayarin kendi
// ayari gecerli olmalidir.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'netsosyal:shell-zoom'
export const SHELL_ZOOM_MIN = 0.35
export const SHELL_ZOOM_MAX = 1.15
export const SHELL_ZOOM_STEP = 0.02

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(SHELL_ZOOM_MAX, Math.max(SHELL_ZOOM_MIN, Math.round(value * 100) / 100))
}

function readStored(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return clamp(Number(raw))
  } catch {
    /* localStorage erisilemez - varsayilan */
  }
  return 1
}

interface ShellZoomContextValue {
  zoom: number
  setZoom: (next: number) => void
  adjust: (delta: number) => void
  increment: () => void
  decrement: () => void
  reset: () => void
}

const ShellZoomContext = createContext<ShellZoomContextValue | undefined>(undefined)

export function ShellZoomProvider({ children }: { children: React.ReactNode }) {
  // SSR ve ilk istemci render'i AYNI (1) olsun (hydration uyumsuzlugu yok);
  // localStorage'daki deger mount sonrasi efektte uygulanir.
  const [zoom, setZoomState] = useState(1)

  useEffect(() => {
    const stored = readStored()
    setZoomState((prev) => (prev === stored ? prev : stored))
  }, [])

  const persist = useCallback((value: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      /* yok say */
    }
  }, [])

  const setZoom = useCallback((next: number) => {
    setZoomState((prev) => {
      const clamped = clamp(next)
      if (clamped !== prev) persist(clamped)
      return clamped
    })
  }, [persist])

  const adjust = useCallback((delta: number) => {
    setZoomState((prev) => {
      const clamped = clamp(prev + delta)
      if (clamped !== prev) persist(clamped)
      return clamped
    })
  }, [persist])

  const increment = useCallback(() => adjust(SHELL_ZOOM_STEP), [adjust])
  const decrement = useCallback(() => adjust(-SHELL_ZOOM_STEP), [adjust])
  const reset = useCallback(() => setZoom(1), [setZoom])

  // Kullanici istegi (Eylul 2026): Ctrl ile yapilan zoom hareketlerini
  // (klavye +/- VE Ctrl+fare tekerlegi) YAKALAYIP tarayicininkini iptal
  // ediyor, yerine kendi ince (%2) adimli kabuk yakinlastirmamizi
  // uyguluyoruz. Ctrl'suz normal kaydirma / yazma hic etkilenmez.
  // Ctrl+0 BILEREK yakalanmaz - kullanici tarayicinin KENDI zoom'unu
  // %100'e dondurebilsin (uygulama %100'une ust menudeki "%NNN"e tiklar).
  useEffect(() => {
    if (typeof window === 'undefined') return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key
      if (key === '+' || key === '=' || event.code === 'NumpadAdd') {
        event.preventDefault()
        adjust(SHELL_ZOOM_STEP)
      } else if (key === '-' || key === '_' || event.code === 'NumpadSubtract') {
        event.preventDefault()
        adjust(-SHELL_ZOOM_STEP)
      }
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      adjust(event.deltaY < 0 ? SHELL_ZOOM_STEP : -SHELL_ZOOM_STEP)
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('wheel', onWheel)
    }
  }, [adjust])

  const value = useMemo<ShellZoomContextValue>(
    () => ({ zoom, setZoom, adjust, increment, decrement, reset }),
    [zoom, setZoom, adjust, increment, decrement, reset],
  )

  return <ShellZoomContext.Provider value={value}>{children}</ShellZoomContext.Provider>
}

export function useShellZoom(): ShellZoomContextValue {
  const context = useContext(ShellZoomContext)
  if (!context) {
    return {
      zoom: 1,
      setZoom: () => {},
      adjust: () => {},
      increment: () => {},
      decrement: () => {},
      reset: () => {},
    }
  }
  return context
}
