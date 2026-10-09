'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// Kullanici istegi (Ekim 2026): "Tasarım Modu" ac/kapa dugmesi, sayfa
// icindeki bilgi cubugundan ALINDI ve ust menuye (kullanici adinin yanina)
// tasindi. Ust menu (components/layout/header.tsx) global bir bilesen,
// Dosya Yonetimi sayfasindaki tasarim-modu state'ine dogrudan erisemez -
// bu yuzden ikisini birbirine baglayan kucuk bir context.
//
// - Bir "host" (ör. Dosya Yonetimi sayfasi) mount oldugunda kendini
//   registerHost ile kaydeder; boylece ust menudeki dugme SADECE o sayfa
//   acikken gorunur.
// - Host unmount olunca kayit duser ve tasarim modu otomatik kapanir.

interface DesignModeContextValue {
  /** Ust menudeki dugme gorunsun mu (bir host kayitli mi). */
  hostAvailable: boolean
  /** Tasarim modu su an acik mi. */
  active: boolean
  setActive: (next: boolean) => void
  toggle: () => void
  /** Host bilesenler (ör. Dosya Yonetimi sayfasi) mount/unmount'ta cagirir. */
  registerHost: () => () => void
}

const DesignModeContext = createContext<DesignModeContextValue | undefined>(undefined)

export function DesignModeProvider({ children }: { children: React.ReactNode }) {
  const [hostCount, setHostCount] = useState(0)
  const [active, setActiveState] = useState(false)

  const registerHost = useCallback(() => {
    setHostCount((count) => count + 1)
    return () => {
      setHostCount((count) => Math.max(0, count - 1))
    }
  }, [])

  // Host kalmadiysa tasarim modu anlamsiz - kapat. ANCAK bunu GECIKTIREREK
  // yapariz: React StrictMode (dev) ve gecici yeniden-montajlar host'u AYNI
  // tik icinde once kaydini silip HEMEN yeniden kaydeder; aninda kapatirsak
  // kullanici tasarim modundayken (ör. bir kutuyu boyutlandirirken)
  // beklenmedik sekilde moddan cikilir ve o sirada yapilan degisiklik
  // KAYDEDILMEZ. Kisa bir gecikme, bu "kirp-yeniden bagla" durumunu yutar.
  useEffect(() => {
    if (hostCount > 0 || !active) return
    const timer = setTimeout(() => setActiveState(false), 400)
    return () => clearTimeout(timer)
  }, [hostCount, active])

  const value = useMemo<DesignModeContextValue>(() => ({
    hostAvailable: hostCount > 0,
    active,
    setActive: setActiveState,
    toggle: () => setActiveState((prev) => !prev),
    registerHost,
  }), [hostCount, active, registerHost])

  return <DesignModeContext.Provider value={value}>{children}</DesignModeContext.Provider>
}

export function useDesignMode() {
  const context = useContext(DesignModeContext)
  if (!context) throw new Error('useDesignMode must be used within DesignModeProvider')
  return context
}

// Host sayfalar icin kolaylik kancasi: mount oldugu surece ust menudeki
// dugmeyi gorunur kilar, [active, setActive] dondurur.
export function useDesignModeHost(): [boolean, (next: boolean) => void] {
  const { active, setActive, registerHost } = useDesignMode()
  useEffect(() => registerHost(), [registerHost])
  return [active, setActive]
}
