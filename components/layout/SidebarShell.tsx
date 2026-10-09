'use client'

// Kullanici istegi (Ekim 2026): "1360x768 gibi ekranlarda sol sidebar cok
// buyuk duruyor, ekranin nerdeyse 1/3'unu kapliyor". Sebep: KATMAN 0 (bkz.
// ScaledArea) SADECE sayfa icerigini kuculturdu, sidebar 100%'de kaliyordu -
// icerik %70'e inince sidebar orantisiz buyuk gorunuyordu.
//
// Cozum: masaustu (lg+) sabit sidebar, icerikle AYNI mantikla (kullanilabilir
// genislik / 1500) orantili olarak `zoom` ile kuculur. Ayrica header'daki
// "Boyut" (UiScaleContext) carpanini da uygular - kullanici kendi arayuz
// boyutunu secince sidebar da onunla birlikte kucculur/buyur.
//
// Mobil cekmece sidebar'i (AppShell) OLCEKLENMEZ - orada kendi genisligi var.
//
// Kullanici istegi (Eylul 2026): "sol sidebar'i kullanici istersen otomatik
// gizleyebilsin, ekran tam acilsin; fare sol kenara gelince sidebar acilsin".
// autoHide=true iken sidebar akistan CIKAR (icerik tam genislik alir) ve
// `position: fixed` bir katman olarak, fare sol kenara gelince (AppShell'deki
// ince tetik seridi) iceri kayar, fare ayrilinca geri gizlenir. Toggle
// dugmesi sidebar basliginda (bkz. sidebar.tsx onToggleAutoHide).

import { useEffect, useState } from 'react'
import { Sidebar } from './sidebar'
import { useUiScale } from '@/lib/context/UiScaleContext'

// Kullanici istegi (2026-10-07, 2. tur): sidebar buton yazilari -2px
// kucultuldu (17->15px, 16->14px - ONCEKI +2px buyutmenin TAM TERSI,
// yani orijinal 15/14px'e donuldu, bkz. sidebar.tsx) - genislik de AYNI
// sekilde 272->248 (orijinal deger) geri alindi, buton ici dolgu/sekmeler
// arasi mesafe de daraltildi (bkz. sidebar.tsx py-2->py-1.5, space-y-1->
// space-y-0.5).
const BASE_WIDTH = 248 // px - .dy-sidebar yazi buyutmeleri bu genislikte tasarlandi

function computeScale(viewportWidth: number, uiScale: number): number {
  // ScaledArea/useViewportScale ile AYNI: kullanilabilir icerik alani ~
  // (viewport - sidebar) ; onu 1500'luk tasarim genisligine oranla.
  const available = Math.max(0, viewportWidth - BASE_WIDTH)
  const auto = Math.min(1, Math.max(0.68, available / 1500))
  return +(Math.min(1.2, Math.max(0.6, auto * uiScale))).toFixed(3)
}

interface SidebarShellProps {
  autoHide?: boolean
  revealed?: boolean
  onHoverEnter?: () => void
  onHoverLeave?: () => void
}

export function SidebarShell({
  autoHide = false,
  revealed = false,
  onHoverEnter,
  onHoverLeave,
}: SidebarShellProps = {}) {
  const { uiScale } = useUiScale()
  // SSR ve ilk render 1 (hydration uyumu) - gercek olcek mount sonrasi.
  const [viewportWidth, setViewportWidth] = useState(1500)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
  }, [])

  const scale = computeScale(viewportWidth, uiScale)

  if (autoHide) {
    return (
      <div
        className="fixed inset-y-0 left-0 z-[900] hidden transition-transform duration-200 ease-out lg:block"
        style={{
          width: BASE_WIDTH,
          ...(scale !== 1 ? { zoom: scale } : {}),
          transform: revealed ? 'translateX(0)' : 'translateX(-101%)',
        }}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
      >
        <div className="h-full shadow-[18px_0_45px_rgba(16,30,43,0.22)]">
          <Sidebar onNavigate={onHoverLeave} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="hidden shrink-0 lg:block"
      style={scale !== 1 ? { width: BASE_WIDTH, zoom: scale } : { width: BASE_WIDTH }}
    >
      <Sidebar />
    </div>
  )
}
