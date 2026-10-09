'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { migrateLegacyBrowserStorage } from '@/lib/browserStorageMigration'

// "nextsosyal" -> "netsosyal" yeniden adlandirmasi: eski yerel depolama
// anahtarlarini yeni ada tasi. Modul yuklenir yuklenmez (React render'indan
// ve dolayisiyla depolamayi okuyan alt bilesenlerden ONCE) bir kez calisir.
if (typeof window !== 'undefined') {
  migrateLegacyBrowserStorage()
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type PwaContextValue = {
  /** Tarayici gercek "Yükle" istemini destekliyor ve uygulama henuz yuklu degil */
  canPrompt: boolean
  /** Uygulama zaten yuklu / standalone modda acilmis */
  isInstalled: boolean
  /** iOS Safari (beforeinstallprompt YOK - elle "Ana Ekrana Ekle" gerekir) */
  isIOS: boolean
  /**
   * Guvenli baglam (HTTPS veya localhost / enterprise politikasiyla guvenli
   * sayilan origin). FALSE ise Android/masaustunde tek dokunuslu "Yükle"
   * ISTEMI HIC CIKMAZ ve service worker kaydedilemez - talimat metni buna
   * gore degisir.
   */
  isSecureContext: boolean
  /** Gercek yukleme istemini gosterir; true = kabul edildi */
  promptInstall: () => Promise<boolean>
}

const PwaContext = createContext<PwaContextValue>({
  canPrompt: false,
  isInstalled: false,
  isIOS: false,
  isSecureContext: true,
  promptInstall: async () => false,
})

export function usePwa() {
  return useContext(PwaContext)
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ Safari masaüstü UA verir - dokunmatik + Mac ile ayirt et
  const isIPadOS = navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1
  return isIOSDevice || isIPadOS
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  // SSR'da guvenli varsay - istemcide gercek deger okununca duzelir.
  const [isSecureContext, setIsSecureContext] = useState(true)

  useEffect(() => {
    migrateLegacyBrowserStorage()
    setIsIOS(detectIOS())
    setIsInstalled(detectStandalone())
    setIsSecureContext(typeof window !== 'undefined' && window.isSecureContext === true)

    // Service worker'i HER ZAMAN (push aboneligi olmasa da) kaydet - PWA'nin
    // "yüklenebilir" sayilmasi ve cevrimdisi sayfasi icin gerekli. Guvenli
    // baglam (HTTPS veya localhost) yoksa tarayici zaten sessizce yok sayar.
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // kayit basarisiz olsa bile uygulama normal calisir
      })
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }
    const mq = window.matchMedia('(display-mode: standalone)')
    const onDisplayModeChange = () => setIsInstalled(detectStandalone())

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    mq.addEventListener?.('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      mq.removeEventListener?.('change', onDisplayModeChange)
    }
  }, [])

  const value = useMemo<PwaContextValue>(() => ({
    canPrompt: !isInstalled && deferredPrompt !== null,
    isInstalled,
    isIOS,
    isSecureContext,
    promptInstall: async () => {
      if (!deferredPrompt) return false
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      setDeferredPrompt(null)
      return choice.outcome === 'accepted'
    },
  }), [deferredPrompt, isInstalled, isIOS, isSecureContext])

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>
}
