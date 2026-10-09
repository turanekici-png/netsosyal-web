'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Hareketsizlik (idle) zaman asimi - kullanici istegi (Eylul 2026, eskiden
// 30 dk): oturumda 180 DAKIKA (3 saat) boyunca HICBIR islem yapilmazsa
// otomatik cikis.
//
// Nasil calisir:
//  - Gercek kullanici etkilesimi (fare, klavye, dokunma, kaydirma, tiklama)
//    "son etkinlik" zamanini gunceller ve sekmeler arasi paylasilir
//    (localStorage + storage olayi).
//  - Kullanici aktifken periyodik olarak /api/auth/heartbeat cagrilir; bu uc
//    sunucudaki oturum cerezini "simdi + 180 dk" ileri attirir (sliding).
//    Arka plan yoklamalari (bildirim sayaci vb.) bu ucu CAGIRMAZ.
//  - 180 dk boyunca etkinlik olmazsa: once son 1 dk icin uyari gosterilir,
//    sure dolunca /api/auth/logout cagrilip /login sayfasina yonlendirilir.
//  - Sunucu cerezi zaten dustuyse (ör. mutlak 24 saat ust siniri) heartbeat
//    401 doner ve aninda cikis yapilir.

const IDLE_LIMIT_MS = 180 * 60 * 1000
const WARNING_BEFORE_MS = 60 * 1000
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
const CHECK_INTERVAL_MS = 15 * 1000
const ACTIVITY_STORAGE_KEY = 'netsosyal_last_activity'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'scroll', 'touchstart'] as const

function readSharedLastActivity(): number {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY)
    const parsed = raw ? Number(raw) : 0
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

function writeSharedLastActivity(value: number) {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(value))
  } catch {
    // localStorage kapali/dolu olabilir - sekme-yerel takip yine calisir.
  }
}

export function IdleLogout() {
  const lastActivityRef = useRef<number>(Date.now())
  const lastHeartbeatRef = useRef<number>(Date.now())
  const loggingOutRef = useRef(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const markActivity = useCallback((shareAcrossTabs: boolean) => {
    const now = Date.now()
    lastActivityRef.current = now
    setSecondsLeft(null)
    if (shareAcrossTabs) writeSharedLastActivity(now)
  }, [])

  const logout = useCallback(async (reason: 'timeout' | 'expired') => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' })
    } catch {
      // yine de login'e gonder
    }
    const params = reason === 'timeout' ? '?timeout=1' : '?expired=1'
    window.location.href = `/login${params}`
  }, [])

  const sendHeartbeat = useCallback(async () => {
    lastHeartbeatRef.current = Date.now()
    try {
      const response = await fetch('/api/auth/heartbeat', { method: 'POST', cache: 'no-store' })
      if (response.status === 401) {
        void logout('expired')
      }
    } catch {
      // ag hatasi - bir sonraki denemede tekrar denenir
    }
  }, [logout])

  useEffect(() => {
    markActivity(true)

    const onActivity = () => {
      const now = Date.now()
      // mousemove cok sik tetiklenir; localStorage yazimini seyreklestir.
      const shouldShare = now - readSharedLastActivity() > 5 * 1000
      markActivity(shouldShare)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === ACTIVITY_STORAGE_KEY && event.newValue) {
        const value = Number(event.newValue)
        if (Number.isFinite(value) && value > lastActivityRef.current) {
          lastActivityRef.current = value
          setSecondsLeft(null)
        }
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Baska sekmedeki etkinligi dikkate al, sonra taze heartbeat gonder.
        const shared = readSharedLastActivity()
        if (shared > lastActivityRef.current) lastActivityRef.current = shared
        if (Date.now() - lastActivityRef.current < IDLE_LIMIT_MS) void sendHeartbeat()
      }
    }

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true })
    }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibility)

    const timer = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current

      if (idleFor >= IDLE_LIMIT_MS) {
        setSecondsLeft(0)
        void logout('timeout')
        return
      }

      const remaining = IDLE_LIMIT_MS - idleFor
      if (remaining <= WARNING_BEFORE_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000))
      } else {
        setSecondsLeft(null)
        // Kullanici aktif ve heartbeat araligi dolduysa oturumu uzat.
        if (Date.now() - lastHeartbeatRef.current >= HEARTBEAT_INTERVAL_MS) {
          void sendHeartbeat()
        }
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity)
      }
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [logout, markActivity, sendHeartbeat])

  if (secondsLeft === null || secondsLeft <= 0) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex justify-center px-3 pt-3">
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-amber-300 bg-white px-4 py-3 shadow-lg dark:border-amber-500/40 dark:bg-slate-900">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-sm font-black text-amber-700 dark:bg-amber-500/10">
          !
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Oturumunuz {secondsLeft} saniye içinde kapanacak
          </p>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            İşlem yapılmadığı için güvenlik amacıyla çıkış yapılıyor.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            markActivity(true)
            void sendHeartbeat()
          }}
          className="shrink-0 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700"
        >
          Devam et
        </button>
      </div>
    </div>
  )
}
