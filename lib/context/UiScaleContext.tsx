'use client'

// Kullanici istegi (Eylul 2026): "herkeste farkli cozunurluk var; uygulama
// birinde cok buyuk birinde cok kucuk. Kisi kendi arayuz boyutunu secebilsin".
//
// Bu carpan, KATMAN 0 otomatik olcekleme (ScaledArea / useViewportScale) ve
// ELLE kabuk zoom'un (ShellZoomContext, Ctrl +/-) USTUNE bir carpan olarak
// uygulanir:  efektif zoom = otoOlcek * elleZoom * arayuzBoyutu
//
// ShellZoomContext'ten FARKI: bu ayar KULLANICI HESABINA ozeldir (sunucuda
// saklanir) - hangi bilgisayardan girilirse girilsin ayni hesap ayni boyutu
// gorur. Varsayilan 1 -> hicbir sey degismez (opt-in).

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export const UI_SCALE_MIN = 0.85
export const UI_SCALE_MAX = 1.3

// Kullaniciya sunulan hazir secenekler.
export const UI_SCALE_OPTIONS: { label: string; value: number }[] = [
  { label: 'Küçük', value: 0.9 },
  { label: 'Normal', value: 1 },
  { label: 'Büyük', value: 1.1 },
  { label: 'Çok Büyük', value: 1.2 },
  { label: 'En Büyük', value: 1.3 },
]

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(value * 100) / 100))
}

interface UiScaleContextValue {
  uiScale: number
  setUiScale: (next: number) => void
  ready: boolean
}

const UiScaleContext = createContext<UiScaleContextValue | undefined>(undefined)

export function UiScaleProvider({ children }: { children: React.ReactNode }) {
  // SSR ve ilk istemci render'i AYNI (1) - hydration uyumsuzlugu yok.
  const [uiScale, setUiScaleState] = useState(1)
  const [ready, setReady] = useState(false)

  // Mount sonrasi kullanicinin kayitli tercihini getir.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user-ui-scale', { cache: 'no-store' })
        const payload = await res.json().catch(() => null)
        if (!cancelled && res.ok && payload?.success && typeof payload.data?.scale === 'number') {
          setUiScaleState(clamp(payload.data.scale))
        }
      } catch {
        /* sunucuya ulasilamadi - varsayilan 1 */
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setUiScale = useCallback((next: number) => {
    const clamped = clamp(next)
    setUiScaleState(clamped)
    // Debounce'a gerek yok - kullanici hazir secenege tiklar, sik degismez.
    void fetch('/api/user-ui-scale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: clamped }),
    }).catch(() => {
      /* kaydedilemezse sessiz - bir sonraki degisiklikte tekrar denenir */
    })
  }, [])

  const value = useMemo<UiScaleContextValue>(
    () => ({ uiScale, setUiScale, ready }),
    [uiScale, setUiScale, ready],
  )

  return <UiScaleContext.Provider value={value}>{children}</UiScaleContext.Provider>
}

export function useUiScale(): UiScaleContextValue {
  const context = useContext(UiScaleContext)
  if (!context) {
    return { uiScale: 1, setUiScale: () => {}, ready: true }
  }
  return context
}
