'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

// Tasinabilir / boyutlandirilabilir pencere (2026-10-14) - Dosya Yönetimi'ndeki
// tasinabilir pencerelerle (documents/page.tsx useFloatingWindow) ayni
// davranis, baska sayfalarda da kullanilabilsin diye ayri hook:
//  - baslik cubugundan tutup SURUKLE (dugmeler haric)
//  - sag alt koseden BOYUTLANDIR
//  - "Ekranı Kapla" / "Küçült" (onceki konum/boyuta don)
//  - Ctrl + fare tekerlegi: pencere degil ICERIK yakinlasir (data-window-zoom;
//    bkz. lib/context/ShellZoomContext.tsx onWheel -> 'netsosyal:window-zoom')
//
// Kullanim: overlay'e overlayRef; panele panelRef + panelStyle; baslik
// cubuguna dragHandleProps; koseye resizeHandleProps; icerige contentZoom.
// Koordinatlar overlay'in KENDI birimindedir - kabuk zoom'u (ScaledArea)
// != 1 olsa da surukleme imlecle birebir gider.

type Rect = { x: number; y: number; width: number; height: number }
type Options = {
  // Kucultulmus (geri yuklenmis) boyut: overlay genisligi/yuksekligi orani
  restoreWidthRatio?: number
  restoreHeightRatio?: number
  maxRestoreWidth?: number
  startMaximized?: boolean
  minWidth?: number
  minHeight?: number
}

const KENAR = 6

export function useFloatingPanel(options: Options = {}) {
  const {
    restoreWidthRatio = 0.8,
    restoreHeightRatio = 0.82,
    maxRestoreWidth = Infinity,
    startMaximized = true,
    minWidth = 420,
    minHeight = 300,
  } = options

  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [isMaximized, setIsMaximized] = useState(startMaximized)
  const [contentZoom, setContentZoom] = useState(1)
  const restoreRectRef = useRef<Rect | null>(null)
  const islemRef = useRef<{ tur: 'tasi' | 'boyut'; pointerId: number; x: number; y: number; bas: Rect; olcek: number } | null>(null)

  const alan = useCallback(() => {
    const overlay = overlayRef.current
    return { w: overlay?.clientWidth || window.innerWidth, h: overlay?.clientHeight || window.innerHeight }
  }, [])

  const tamEkran = useCallback((): Rect => {
    const { w, h } = alan()
    return { x: KENAR, y: KENAR, width: Math.max(minWidth, w - KENAR * 2), height: Math.max(minHeight, h - KENAR * 2) }
  }, [alan, minHeight, minWidth])

  const ortaBoyut = useCallback((): Rect => {
    const { w, h } = alan()
    const width = Math.max(minWidth, Math.min(maxRestoreWidth, Math.round(w * restoreWidthRatio)))
    const height = Math.max(minHeight, Math.round(h * restoreHeightRatio))
    return { x: Math.max(KENAR, Math.round((w - width) / 2)), y: Math.max(KENAR, Math.round((h - height) / 2)), width, height }
  }, [alan, maxRestoreWidth, minHeight, minWidth, restoreHeightRatio, restoreWidthRatio])

  // Ilk konum: pencere GERCEKTEN ekrandayken (overlay olculebilir) hesaplanir -
  // kapaliyken hesaplansaydi kabuk zoom'u varken konum kayardi.
  // Bilincli olarak bagimlilik listesi YOK: overlay olculebilir olana kadar her
  // cizimde dener, rect dolunca hemen cikar (sonsuz dongu olmaz).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (rect || !overlayRef.current) return
    setRect(startMaximized ? tamEkran() : ortaBoyut())
  })

  // Tarayici penceresi degisince: tam ekransa yeniden kapla, degilse ekranda tut
  useEffect(() => {
    const ayarla = () => {
      if (isMaximized) { setRect(tamEkran()); return }
      const { w, h } = alan()
      setRect((r) => r && {
        ...r,
        width: Math.min(r.width, w - KENAR * 2),
        height: Math.min(r.height, h - KENAR * 2),
        x: Math.min(Math.max(KENAR, r.x), Math.max(KENAR, w - 80)),
        y: Math.min(Math.max(KENAR, r.y), Math.max(KENAR, h - 60)),
      })
    }
    window.addEventListener('resize', ayarla)
    return () => window.removeEventListener('resize', ayarla)
  }, [alan, isMaximized, tamEkran])

  // Ctrl + tekerlek -> icerik yakinlastirma
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    panel.setAttribute('data-window-zoom', '')
    const dinle = (event: Event) => {
      const yon = (event as CustomEvent<{ direction: number }>).detail?.direction ?? 0
      setContentZoom((z) => Math.min(1.6, Math.max(0.6, +(z + yon * 0.05).toFixed(2))))
    }
    panel.addEventListener('netsosyal:window-zoom', dinle)
    return () => panel.removeEventListener('netsosyal:window-zoom', dinle)
  })

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setRect(restoreRectRef.current ?? ortaBoyut())
      setIsMaximized(false)
    } else {
      if (rect) restoreRectRef.current = rect
      setRect(tamEkran())
      setIsMaximized(true)
    }
  }, [isMaximized, ortaBoyut, rect, tamEkran])

  // 2026-10-14: isleyici render sirasinda URETILMIYOR (eskiden baslat('tasi')
  // render'da cagrilip kapanis donduruyordu; React derleyici kurali bunu ref
  // okuma sayiyordu). Artik yalniz pointerdown aninda calisir - davranis ayni.
  const baslat = (tur: 'tasi' | 'boyut', event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !rect) return
    // baslikta dugme/baglanti/alanlara tiklamak surukleme baslatmasin
    if (tur === 'tasi' && (event.target as Element).closest('button, a, input, select, textarea, [data-no-drag]')) return
    const overlay = overlayRef.current
    const olcek = overlay && overlay.offsetWidth ? overlay.getBoundingClientRect().width / overlay.offsetWidth : 1
    let bas = rect
    if (isMaximized && tur === 'tasi') {
      // tam ekrandan suruklenirse once eski boyuta don, imlec altinda kalsin
      const geri = restoreRectRef.current ?? ortaBoyut()
      bas = { ...geri, x: Math.max(KENAR, event.clientX / olcek - geri.width / 2), y: KENAR }
      setRect(bas)
      setIsMaximized(false)
    } else if (isMaximized && tur === 'boyut') {
      setIsMaximized(false)
    }
    islemRef.current = { tur, pointerId: event.pointerId, x: event.clientX, y: event.clientY, bas, olcek }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const hareket = (event: ReactPointerEvent<HTMLElement>) => {
    const islem = islemRef.current
    if (!islem || islem.pointerId !== event.pointerId) return
    const dx = (event.clientX - islem.x) / islem.olcek
    const dy = (event.clientY - islem.y) / islem.olcek
    const { w, h } = alan()
    if (islem.tur === 'tasi') {
      setRect({
        ...islem.bas,
        x: Math.min(Math.max(KENAR - islem.bas.width + 120, islem.bas.x + dx), w - 120),
        y: Math.min(Math.max(KENAR, islem.bas.y + dy), h - 48),
      })
    } else {
      setRect({
        ...islem.bas,
        width: Math.min(Math.max(minWidth, islem.bas.width + dx), w - islem.bas.x - KENAR),
        height: Math.min(Math.max(minHeight, islem.bas.height + dy), h - islem.bas.y - KENAR),
      })
    }
  }

  const bitir = (event: ReactPointerEvent<HTMLElement>) => {
    if (islemRef.current?.pointerId === event.pointerId) islemRef.current = null
  }

  const panelStyle: CSSProperties = rect
    ? { position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }
    : { visibility: 'hidden' }

  return {
    overlayRef,
    panelRef,
    panelStyle,
    isMaximized,
    toggleMaximize,
    contentZoom,
    resetContentZoom: () => setContentZoom(1),
    dragHandleProps: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => baslat('tasi', event),
      onPointerMove: hareket,
      onPointerUp: bitir,
      onPointerCancel: bitir,
      onDoubleClick: (event: React.MouseEvent<HTMLElement>) => {
        if ((event.target as Element).closest('button, a, input, select, textarea, [data-no-drag]')) return
        toggleMaximize()
      },
      style: { cursor: 'move', touchAction: 'none' } as CSSProperties,
    },
    resizeHandleProps: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => baslat('boyut', event),
      onPointerMove: hareket,
      onPointerUp: bitir,
      onPointerCancel: bitir,
      title: 'Boyutlandırmak için sürükleyin',
      style: { cursor: 'nwse-resize', touchAction: 'none' } as CSSProperties,
    },
  }
}
