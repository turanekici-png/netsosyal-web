'use client'

import { useEffect } from 'react'
import type { useRouter } from 'next/navigation'

// Kullanici istegi (Eylul 2026): "Bir kullanici veri girince digeri sayfayi
// YENILEMEDEN goremiyor - listeler kendini periyodik yenilesin."
//
// Cozum (dusuk risk): acik liste sayfalari her 15 sn'de bir
// `router.refresh()` cagirir - bu Next.js App Router "soft refresh"idir:
// SADECE sunucudan gelen veriyi tazeler, sayfayi YENIDEN YUKLEMEZ; kaydirma
// konumu, form girdileri, React state ve acik menuler KORUNUR.
//
// Guvenlik onlemleri:
//  - Sekme/pencere GORUNMUYORken (arka planda) yenileme YAPILMAZ (sunucu
//    yuku + pil tasarrufu).
//  - Ayni sayfada birden fazla tablo (ör. Ana Sayfa) olsa bile TEK zamanlayici
//    calisir (modul seviyesinde singleton) -> tik basina TEK refresh.
//  - Bir onceki refresh hala suruyorsa yeni tik atlanir (ust uste binmesin).

const DEFAULT_INTERVAL_MS = 15_000

type AppRouter = ReturnType<typeof useRouter>

let subscriberCount = 0
let timerId: ReturnType<typeof setInterval> | null = null
let latestRouter: AppRouter | null = null
let intervalMs = DEFAULT_INTERVAL_MS
let refreshInFlight = false

function userIsTyping() {
  if (typeof document === 'undefined') return false
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

function startTimerIfNeeded() {
  if (timerId || intervalMs <= 0) return
  timerId = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    // Kullanici bir alana yaziyorsa / secim yapiyorsa (filtre kutusu, form,
    // acilir menu) yenileme ERTELENIR - odak/secim kaybolmasin.
    if (userIsTyping()) return
    if (refreshInFlight || !latestRouter) return
    refreshInFlight = true
    try {
      latestRouter.refresh()
    } finally {
      // router.refresh() bir promise dondurmez; RSC yeniden render suresi
      // icin kisa bir kilit yeterli (ust uste binmeyi engeller, 15 sn'lik
      // aralikta pratikte hep temizlenmis olur).
      setTimeout(() => { refreshInFlight = false }, 4_000)
    }
  }, intervalMs)
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId)
    timerId = null
  }
}

/**
 * Acik liste sayfasini periyodik olarak (varsayilan 15 sn) sunucudan tazeler.
 * `ms <= 0` verilirse otomatik yenileme KAPALI olur.
 */
export function useListAutoRefresh(router: AppRouter, ms: number = DEFAULT_INTERVAL_MS) {
  useEffect(() => {
    latestRouter = router
    intervalMs = ms
    subscriberCount += 1
    startTimerIfNeeded()

    return () => {
      subscriberCount -= 1
      if (subscriberCount <= 0) {
        subscriberCount = 0
        stopTimer()
        latestRouter = null
        refreshInFlight = false
      }
    }
  }, [router, ms])
}
