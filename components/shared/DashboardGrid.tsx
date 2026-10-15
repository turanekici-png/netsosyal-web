'use client'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Responsive, useContainerWidth, verticalCompactor, moveElement, cloneLayout, type Layout } from 'react-grid-layout'
import { useUiScale } from '@/components/layout/ScaleContext'
import { createParentAwareScaledStrategy } from '@/components/shared/rglParentAwareScaledStrategy'

// Ana Sayfa rapor kutulari - her kullanici kendi duzenini (yer/boyut/gizli
// kutular) Tasarim Modu'nda ayarlar; duzen HESABA ozel sunucuda saklanir
// (bkz. app/api/dashboard-layout/route.ts, kullaniciId bazinda).
//
// 2026-10-15 yeniden duzenleme (kullanici: "tasarim modunda boyut ayarlarken
// ve yer degistirirken sorun yasiyorum - daha profesyonel/kullanisli olsun"):
//  - KAYMA: kutu fareden kayiyordu. Kok neden: olcek ScaleContext'ten
//    (kabuk zoom'u) okunuyordu, ama globals.css'teki
//    ":where(.app-scaled):has(.dy-fluid) { zoom: 1 !important }" kurali
//    Dosya Yonetimi sekmesi arka planda acikken GERCEK zoom'u 1'e zorluyor -
//    hesap yanlis olcekle yapiliyordu. Artik olcek ekrandaki GERCEK boyuttan
//    olculur (getBoundingClientRect / offsetWidth).
//  - YER DEGISTIRME: dikey sikistirma (kullanici secimi: "bosluklar otomatik
//    kapansin") - kutu baskasinin ustune birakilinca digerleri yer acar,
//    bosluk kalmaz. Kutu Tasarim Modu'nda HER YERINDEN tutulup tasinir
//    (icerik ustune seffaf bir katman gelir; tablo/grafik tiklamalari
//    tasarim sirasinda devre disi).
//  - BOYUTLANDIRMA: sag, alt, sol kenar ve alt koselerden; buyuk tutamaclar.
//  - KAYDET / VAZGEC / GERI AL: degisiklikler artik aninda kaydedilmez -
//    "Kaydet" ile kalici olur, "Vazgec" ile tasarim moduna girildigi ana
//    doner; Geri Al / Yinele (Ctrl+Z / Ctrl+Y) desteklenir.
//  - Klavye: secili kutu yon tuslariyla tasinir (yukari/asagi = komsuyla yer
//    degistirir), Ctrl+yon boyutlandirir, Shift daha buyuk adim.
const DASHBOARD_LAYOUT_GRID_ID = 'dashboard'

export type DashboardWidget = {
  id: string
  title: string
  node: ReactNode
  // Mobil (dar ekran) dizilimde bu kutu YARIM genislik kaplasin - ardisik
  // iki "yarim" kutu yan yana gelir (ör. Dosya Ozeti + Birey Ozeti).
  mobileHalf?: boolean
  // Kartin sag-ust kosesinde HER ZAMAN gorunen "⤢" (tam raporu yeni sekmede
  // ac) dugmesi icin rota/baslik. Verilmezse dugme cizilmez.
  fullReportPath?: string
  fullReportTitle?: string
}

const BREAKPOINTS = { lg: 1100, sm: 0 }
// 48 sutun + 5px satir: boyutlandirma neredeyse piksel hassasiyetinde.
// Eski (12 sutunluk) kayitlar app/api/dashboard-layout/route.ts'te otomatik
// yeni olcege yukseltilir.
const COLS = { lg: 48, sm: 1 }
const ROW_HEIGHT = 5
const ROW_MARGIN = 4
// Tasarim Modu'nda tasimayi BASLATMAYAN ogeler (kutu ustundeki dugmeler).
const NO_DRAG_SELECTOR = '.dashboard-no-drag'
const SELECT_CLICK_MAX_DISTANCE = 5
const HISTORY_LIMIT = 50
// Klavye adimlari (sutun / satir). Shift ile buyuk adim.
const KEY_STEP_X = 1
const KEY_STEP_X_FAST = 4
const KEY_STEP_Y = 4
const KEY_STEP_Y_FAST = 16

type Snapshot = { lg: Layout; hidden: string[] }

const snapshotKey = (snapshot: Snapshot) => JSON.stringify({
  lg: snapshot.lg
    .map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))
    .sort((a, b) => (a.i < b.i ? -1 : a.i > b.i ? 1 : 0)),
  hidden: [...snapshot.hidden].sort(),
})

function buildSingleColumnLayout(lgLayout: Layout): Layout {
  return lgLayout
    .slice()
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((item, index) => ({ ...item, x: 0, y: index, w: 1 }))
}

// Mobil "Tasarim" modu: kutulari serbest grid yerine tek sutun alt alta
// dizer - kullanici sadece SIRAYI (yukari/asagi) degistirebilir ve
// gizleyebilir. Sira, kayitli "sm" duzeninin y sirasindan turetilir;
// "sm" yoksa masaustu ("lg") duzeninin gorsel sirasi esas alinir.
function orderIdsFromLayout(layout: Layout | undefined): string[] {
  if (!Array.isArray(layout)) return []
  return layout
    .slice()
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((item) => item.i)
}

const horizontallyOverlaps = (a: { x: number; w: number }, b: { x: number; w: number }) => (
  a.x < b.x + b.w && a.x + a.w > b.x
)

const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => horizontallyOverlaps(a, b) && a.y < b.y + b.h && a.y + a.h > b.y

export function DashboardGrid({
  widgets,
  defaultLayout,
  canEdit,
  onOpenFullReport,
}: {
  widgets: DashboardWidget[]
  defaultLayout: Layout
  // Tasarim Modu SADECE "Ana sayfa duzenini degistirme" yetkisi olanlarda
  // gorunur; sunucu tarafinda da ayrica zorunlu kilinir.
  canEdit: boolean
  // widget.fullReportPath verilen kartlarin "⤢" dugmesine tiklaninca cagrilir.
  onOpenFullReport?: (title: string, path: string) => void
}) {
  const { width, containerRef, mounted } = useContainerWidth()
  // Kabuk zoom'u degisince olcegi yeniden olcmek icin tetikleyici olarak
  // kullanilir - hesapta DOGRUDAN kullanilmaz (bkz. dosya basi "KAYMA").
  const contextScale = useUiScale()
  // Mobil / dar ekran: grid tamamen devre disi, kutular dikey alt alta.
  // Esik <Responsive>'in BREAKPOINTS.lg esigiyle AYNI olmali (900-1100px
  // tabletlerde tek sutunda ust uste binme hatasi buradan cikmisti).
  const isNarrowViewport = mounted && width > 0 && width < BREAKPOINTS.lg
  const [designModeState, setDesignModeState] = useState(false)
  const designMode = designModeState && !isNarrowViewport
  const [mobileDesignActive, setMobileDesignActive] = useState(false)
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)

  // Mobil "sm" varsayilani: tek sutun; w=1 SADECE mobileHalf kutulari (yan
  // yana ciftler), digerleri w=2 (tam genislik).
  const buildDefaultMobileSm = (lg: Layout): Layout => {
    const half = new Set(widgets.filter((w) => w.mobileHalf).map((w) => w.id))
    return buildSingleColumnLayout(lg).map((it) => ({ ...it, w: half.has(it.i) ? 1 : 2 }))
  }
  const [layouts, setLayouts] = useState<Partial<Record<string, Layout>>>({
    lg: defaultLayout,
    sm: buildDefaultMobileSm(defaultLayout),
  })
  // <Responsive>'i TAMAMEN yeniden monte etmek icin (sifirla / geri al /
  // vazgec) - kutuphanenin ic durumu eski yerlesimi tasimasin.
  const [gridInstanceKey, setGridInstanceKey] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'default-saved' | 'error'>('idle')
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  // 2026-10-15: yoneticinin "Varsayilan Tasarim Yap" ile belirledigi ORTAK
  // varsayilan (yoksa koddaki defaultLayout). Kendi duzeni olmayan herkes
  // bunu gorur; "Varsayilana Sifirla" buna doner.
  const [sharedDefault, setSharedDefault] = useState<Snapshot | null>(null)
  const [canSetDefault, setCanSetDefault] = useState(false)
  const effectiveDefaultLg: Layout = sharedDefault?.lg ?? defaultLayout
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Tasarim Modu taslak/gecmis durumu ---
  const [historyPast, setHistoryPast] = useState<Snapshot[]>([])
  const [historyFuture, setHistoryFuture] = useState<Snapshot[]>([])
  const baselineRef = useRef<Snapshot | null>(null)
  const [baselineKey, setBaselineKey] = useState('')
  const interactingRef = useRef(false)
  const preInteractionRef = useRef<Snapshot | null>(null)
  const committedLayoutKeyRef = useRef<string | null>(null)
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null)

  // --- Gercek ekran olcegi (bkz. dosya basi "KAYMA") ---
  const [measuredScale, setMeasuredScale] = useState(1)
  const measureScale = useCallback(() => {
    const element = containerRef.current
    if (!element || !element.offsetWidth) return
    const ratio = element.getBoundingClientRect().width / element.offsetWidth
    if (!Number.isFinite(ratio) || ratio <= 0) return
    const rounded = Math.round(ratio * 1000) / 1000
    setMeasuredScale((prev) => (Math.abs(prev - rounded) > 0.001 ? rounded : prev))
  }, [containerRef])
  useEffect(() => {
    measureScale()
  }, [measureScale, contextScale, width, designMode, isLoaded])
  const positionStrategy = useMemo(
    // Strateji ref'i yalnizca surukleme aninda (olay icinde) okur, render'da degil.
    // eslint-disable-next-line react-hooks/refs
    () => (measuredScale !== 1 ? createParentAwareScaledStrategy(measuredScale, containerRef) : undefined),
    [measuredScale, containerRef],
  )

  // Kayitli (sunucudaki, bu HESABA ozel) duzeni yukle - kayitli duzende
  // olmayan (sonradan eklenmis) kutularin varsayilan konumu korunur.
  useEffect(() => {
    let isCancelled = false

    fetch(`/api/dashboard-layout?grid=${DASHBOARD_LAYOUT_GRID_ID}`)
      .then((res) => res.json())
      .then((payload) => {
        if (isCancelled || !payload?.success) return
        const sharedLg: Layout | undefined = payload.sharedDefault?.layouts?.lg
        const shared = Array.isArray(sharedLg) && sharedLg.length > 0
          ? {
              lg: sharedLg,
              sm: payload.sharedDefault?.layouts?.sm as Layout | undefined,
              hidden: Array.isArray(payload.sharedDefault?.hiddenIds) ? (payload.sharedDefault.hiddenIds as string[]) : [],
            }
          : null
        setSharedDefault(shared ? { lg: shared.lg, hidden: shared.hidden } : null)
        setCanSetDefault(Boolean(payload.canSetDefault))

        // Kisisel duzen varsa o, yoksa ortak varsayilan, o da yoksa koddaki varsayilan
        const personalLg: Layout | undefined = payload.data?.layouts?.lg
        const hasPersonal = Array.isArray(personalLg) && personalLg.length > 0
        const savedLg: Layout | undefined = hasPersonal ? personalLg : shared?.lg
        const savedSm: Layout | undefined = hasPersonal ? payload.data?.layouts?.sm : shared?.sm
        const savedHidden: string[] = hasPersonal
          ? (Array.isArray(payload.data?.hiddenIds) ? payload.data.hiddenIds : [])
          : (shared?.hidden ?? [])
        setHiddenIds(new Set(savedHidden))
        if (!Array.isArray(savedLg) || savedLg.length === 0) return

        const savedIds = new Set(savedLg.map((item) => item.i))
        const missingDefaults = defaultLayout.filter((item) => !savedIds.has(item.i))
        const mergedLg = [...savedLg, ...missingDefaults]

        // Mobil sira/boyut: kayitli "sm" varsa onun sirasi ve h/w'si korunur.
        const mobileHalfIds = new Set(widgets.filter((w) => w.mobileHalf).map((w) => w.id))
        const savedSmById = new Map((Array.isArray(savedSm) ? savedSm : []).map((it) => [it.i, it]))
        // Eski kayitlarda TUM sm.w === 1 idi - "kullanici genislik secmedi".
        const smIsLegacyWidth = savedSmById.size > 0 && Array.from(savedSmById.values()).every((it) => (it.w ?? 1) === 1)
        const resolveMobileW = (id: string) => {
          if (smIsLegacyWidth) return mobileHalfIds.has(id) ? 1 : 2
          const w = savedSmById.get(id)?.w
          return w === 1 ? 1 : w && w >= 2 ? 2 : mobileHalfIds.has(id) ? 1 : 2
        }
        let mergedSm = buildSingleColumnLayout(mergedLg).map((it) => ({ ...it, w: resolveMobileW(it.i) }))
        const savedSmOrder = orderIdsFromLayout(savedSm).filter((id) => mergedLg.some((it) => it.i === id))
        if (savedSmOrder.length > 0) {
          const seen = new Set(savedSmOrder)
          for (const it of mergedLg) if (!seen.has(it.i)) savedSmOrder.push(it.i)
          const byId = new Map(mergedLg.map((it) => [it.i, it]))
          mergedSm = savedSmOrder.map((id, index) => {
            const base = byId.get(id)
            const saved = savedSmById.get(id)
            return {
              i: id, x: 0, y: index,
              w: resolveMobileW(id),
              h: saved?.h ?? base?.h ?? 20,
              minW: base?.minW, minH: base?.minH,
            }
          })
        }

        setLayouts({ lg: mergedLg, sm: mergedSm })
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) setIsLoaded(true)
      })

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flashStatus = (status: 'saved' | 'default-saved' | 'error') => {
    setSaveStatus(status)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), status === 'saved' ? 2000 : 5000)
  }

  const persistLayouts = (next: Partial<Record<string, Layout>>, nextHiddenIds?: Set<string>): Promise<boolean> => {
    setSaveStatus('saving')
    return fetch('/api/dashboard-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid: DASHBOARD_LAYOUT_GRID_ID, layouts: next, hiddenIds: Array.from(nextHiddenIds ?? hiddenIds) }),
    })
      .then((res) => res.json())
      .then((payload) => {
        const ok = Boolean(payload?.success)
        flashStatus(ok ? 'saved' : 'error')
        return ok
      })
      .catch(() => {
        flashStatus('error')
        return false
      })
  }

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
  }, [])

  // Kullanicinin sonradan ekledigi (ör. "Özet Rapor Ekle") ve kayitli
  // duzende HENUZ yeri olmayan kutular en alta 16 sutunluk (satira 3 kutu)
  // ve okunur yukseklikte yerlestirilir.
  const effectiveLayouts = useMemo(() => {
    const lg = Array.isArray(layouts.lg) ? layouts.lg : []
    const placed = new Set(lg.map((item) => item.i))
    const missing = widgets.filter((widget) => !placed.has(widget.id))
    if (missing.length === 0) return layouts
    const bottom = lg.reduce((max, item) => Math.max(max, item.y + item.h), 0)
    const AUTO_W = 16
    const AUTO_H = 44
    const perRow = Math.max(1, Math.floor(COLS.lg / AUTO_W))
    const extra = missing.map((widget, index) => ({
      i: widget.id,
      x: (index % perRow) * AUTO_W,
      y: bottom + Math.floor(index / perRow) * AUTO_H,
      w: AUTO_W,
      h: AUTO_H,
      minW: 8,
      minH: 16,
    }))
    return { ...layouts, lg: [...lg, ...extra] }
  }, [layouts, widgets])

  const currentLg: Layout = (effectiveLayouts.lg as Layout | undefined) ?? []
  const currentSnapshot = (): Snapshot => ({ lg: currentLg, hidden: Array.from(hiddenIds) })
  const isDirty = designMode && baselineKey !== '' && snapshotKey(currentSnapshot()) !== baselineKey

  const applySnapshot = (snapshot: Snapshot, remount: boolean) => {
    setLayouts((prev) => ({ ...prev, lg: snapshot.lg }))
    setHiddenIds(new Set(snapshot.hidden))
    if (remount) setGridInstanceKey((prev) => prev + 1)
  }

  // Kullanicinin yaptigi bir degisikligi uygular ve geri alinabilir kilar.
  const commitChange = (next: Snapshot, remount = false) => {
    const before = currentSnapshot()
    if (snapshotKey(before) === snapshotKey(next)) return
    setHistoryPast((past) => [...past.slice(-(HISTORY_LIMIT - 1)), before])
    setHistoryFuture([])
    applySnapshot(next, remount)
  }

  const undo = () => {
    if (historyPast.length === 0) return
    const previous = historyPast[historyPast.length - 1]
    setHistoryPast((past) => past.slice(0, -1))
    setHistoryFuture((future) => [currentSnapshot(), ...future])
    applySnapshot(previous, true)
  }

  const redo = () => {
    if (historyFuture.length === 0) return
    const next = historyFuture[0]
    setHistoryFuture((future) => future.slice(1))
    setHistoryPast((past) => [...past, currentSnapshot()])
    applySnapshot(next, true)
  }

  const startDesignMode = () => {
    const snapshot = currentSnapshot()
    baselineRef.current = snapshot
    setBaselineKey(snapshotKey(snapshot))
    setHistoryPast([])
    setHistoryFuture([])
    setSelectedWidgetId(null)
    setDesignModeState(true)
  }

  const finishDesignMode = () => {
    baselineRef.current = null
    setBaselineKey('')
    setHistoryPast([])
    setHistoryFuture([])
    setSelectedWidgetId(null)
    setDesignModeState(false)
  }

  const saveDesign = async () => {
    const snapshot = currentSnapshot()
    const ok = await persistLayouts({ ...layouts, lg: snapshot.lg }, new Set(snapshot.hidden))
    if (ok) finishDesignMode()
  }

  const cancelDesign = () => {
    if (isDirty && !window.confirm('Kaydedilmemiş değişiklikler geri alınacak. Devam edilsin mi?')) return
    if (baselineRef.current) applySnapshot(baselineRef.current, true)
    finishDesignMode()
  }

  const resetToDefault = () => {
    commitChange({
      lg: verticalCompactor.compact(cloneLayout(effectiveDefaultLg), COLS.lg),
      hidden: sharedDefault?.hidden ?? [],
    }, true)
  }

  // Yonetici: mevcut tasarimi herkes icin varsayilan yapar (kisisel duzenler
  // sunucuda silinir - herkes bu tasarimla acilir).
  const setAsSharedDefault = async () => {
    if (!window.confirm('Bu tasarım HERKES için varsayılan ana sayfa düzeni olacak ve kişilerin kendi kaydettiği düzenler silinecek. Devam edilsin mi?')) return
    const snapshot = currentSnapshot()
    const sm = buildDefaultMobileSm(snapshot.lg)
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/dashboard-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-default', grid: DASHBOARD_LAYOUT_GRID_ID, layouts: { lg: snapshot.lg, sm }, hiddenIds: snapshot.hidden }),
      })
      const payload = await res.json().catch(() => null)
      if (!payload?.success) {
        flashStatus('error')
        return
      }
      setSharedDefault({ lg: snapshot.lg, hidden: snapshot.hidden })
      setLayouts((prev) => ({ ...prev, lg: snapshot.lg, sm }))
      finishDesignMode()
      flashStatus('default-saved')
    } catch {
      flashStatus('error')
    }
  }

  const toggleHidden = (id: string) => {
    if (designMode) {
      const hidden = new Set(hiddenIds)
      if (hidden.has(id)) hidden.delete(id)
      else hidden.add(id)
      commitChange({ lg: currentLg, hidden: Array.from(hidden) })
      return
    }
    // Mobil tasarim: aninda kaydedilir (eski davranis)
    setHiddenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      void persistLayouts(layouts, next)
      return next
    })
  }

  // --- Klavye ile hassas tasima / boyutlandirma (secili kutu) ---
  const moveSelectedWidget = (direction: 'left' | 'right' | 'up' | 'down', fast: boolean) => {
    if (!selectedWidgetId) return
    const working = cloneLayout(currentLg)
    const item = working.find((entry) => entry.i === selectedWidgetId)
    if (!item) return

    let targetX = item.x
    let targetY = item.y
    if (direction === 'left' || direction === 'right') {
      // Yanlara ince ayar yalniz BOS alana yapilir - komsuya carparsa kutu
      // asagi atlamasin, hareket etmez.
      const step = fast ? KEY_STEP_X_FAST : KEY_STEP_X
      targetX = Math.min(Math.max(0, item.x + (direction === 'left' ? -step : step)), Math.max(0, COLS.lg - item.w))
      if (targetX === item.x) return
      const candidate = { ...item, x: targetX }
      if (working.some((entry) => entry.i !== item.i && rectsOverlap(candidate, entry))) return
    } else {
      // Dikey sikistirmada tek satir kaydirmak geri ziplar - bunun yerine
      // yukari/asagidaki en yakin komsuyla yer degistirilir.
      const others = working.filter((entry) => entry.i !== item.i && !hiddenIds.has(entry.i) && horizontallyOverlaps(entry, item))
      if (direction === 'down') {
        const below = others.filter((entry) => entry.y >= item.y + item.h).sort((a, b) => a.y - b.y)[0]
        targetY = below ? below.y + below.h : item.y + (fast ? KEY_STEP_Y_FAST : KEY_STEP_Y)
      } else {
        const above = others.filter((entry) => entry.y + entry.h <= item.y).sort((a, b) => (b.y + b.h) - (a.y + a.h))[0]
        if (!above) return
        targetY = above.y
      }
    }

    const moved = moveElement(working, item, targetX, targetY, true, false, 'vertical', COLS.lg, false)
    commitChange({ lg: verticalCompactor.compact(moved, COLS.lg), hidden: Array.from(hiddenIds) })
  }

  const resizeSelectedWidget = (dw: number, dh: number) => {
    if (!selectedWidgetId) return
    const working = cloneLayout(currentLg)
    const item = working.find((entry) => entry.i === selectedWidgetId)
    if (!item) return
    const minW = item.minW ?? 1
    const minH = item.minH ?? 1
    let nextW = Math.min(Math.max(minW, item.w + dw), Math.max(minW, COLS.lg - item.x))
    const nextH = Math.max(minH, item.h + dh)
    // Genisletme yandaki kutuya carparsa yapilmaz (komsuyla tam hizalamak
    // icin); yukseklik artinca alttakiler normal sekilde asagi kayar.
    if (nextW > item.w && working.some((entry) => entry.i !== item.i && rectsOverlap({ ...item, w: nextW }, entry))) {
      nextW = item.w
    }
    if (nextW === item.w && nextH === item.h) return
    item.w = nextW
    item.h = nextH
    commitChange({ lg: verticalCompactor.compact(working, COLS.lg), hidden: Array.from(hiddenIds) })
  }

  useEffect(() => {
    if (!designMode) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = (target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return

      const ctrl = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (ctrl && key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
        return
      }
      if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === 'Escape') {
        setSelectedWidgetId(null)
        return
      }
      if (!selectedWidgetId) return

      const arrows: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      }
      const direction = arrows[event.key]
      if (!direction) return
      event.preventDefault()
      if (ctrl) {
        const stepX = event.shiftKey ? KEY_STEP_X_FAST : KEY_STEP_X
        const stepY = event.shiftKey ? KEY_STEP_Y_FAST : KEY_STEP_Y
        if (direction === 'left') resizeSelectedWidget(-stepX, 0)
        if (direction === 'right') resizeSelectedWidget(stepX, 0)
        if (direction === 'up') resizeSelectedWidget(0, -stepY)
        if (direction === 'down') resizeSelectedWidget(0, stepY)
      } else {
        moveSelectedWidget(direction, event.shiftKey)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  // Kaydedilmemis degisiklik varken sayfa kapatilir/yenilenirse uyar.
  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // --- react-grid-layout olaylari (Tasarim Modu) ---
  const handleInteractionStart = () => {
    interactingRef.current = true
    preInteractionRef.current = currentSnapshot()
  }

  const handleInteractionStop = (layout: Layout) => {
    interactingRef.current = false
    // Kutuphane hemen ardindan AYNI duzenle onLayoutChange cagirir - o
    // cagri "kutuphane duzeltmesi" sanilip taban cizgisini bozmasin.
    committedLayoutKeyRef.current = snapshotKey({ lg: layout, hidden: [] })
    const before = preInteractionRef.current
    preInteractionRef.current = null
    if (!before) return
    const next: Snapshot = { lg: layout, hidden: Array.from(hiddenIds) }
    if (snapshotKey(before) === snapshotKey(next)) return
    setHistoryPast((past) => [...past.slice(-(HISTORY_LIMIT - 1)), before])
    setHistoryFuture([])
    setLayouts((prev) => ({ ...prev, lg: layout }))
  }

  const handleLayoutChange = (current: Layout, allLayouts: Partial<Record<string, Layout>>) => {
    // Gorunum modunda yerlesim yalniz gosterim icindir (gizli kutular
    // cikarilip sikistirilmis hal) - kayitli duzen degistirilmez.
    if (!designMode || interactingRef.current) return
    const lg = allLayouts.lg ?? current
    const layoutKey = snapshotKey({ lg, hidden: [] })
    if (layoutKey === committedLayoutKeyRef.current) {
      committedLayoutKeyRef.current = null
      return
    }
    if (layoutKey === snapshotKey({ lg: currentLg, hidden: [] })) return
    // Kutuphanenin kendi duzeltmesi (ör. tasarim moduna girerken sikistirma):
    // kullanici degisikligi sayilmaz.
    setLayouts((prev) => ({ ...prev, lg }))
    if (historyPast.length === 0) {
      const snapshot = { lg, hidden: Array.from(hiddenIds) }
      baselineRef.current = baselineRef.current ? { ...baselineRef.current, lg } : snapshot
      setBaselineKey(snapshotKey(snapshot))
    }
  }

  // Kutu uzerindeki seffaf tasarim katmani: surukleme olmadan tiklanirsa secer.
  const handleOverlayMouseDown = (event: ReactMouseEvent) => {
    pointerDownRef.current = { x: event.clientX, y: event.clientY }
  }
  const handleOverlayClick = (widgetId: string) => (event: ReactMouseEvent) => {
    const start = pointerDownRef.current
    pointerDownRef.current = null
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SELECT_CLICK_MAX_DISTANCE) return
    setSelectedWidgetId((prev) => (prev === widgetId ? null : widgetId))
  }

  // --- Mobil tasarim (degismedi: aninda kaydeder) ---
  const mobileOrderedWidgets = (() => {
    const orderedIds = orderIdsFromLayout(layouts.sm) || []
    const known = orderedIds.filter((id) => widgets.some((w) => w.id === id))
    const seen = new Set(known)
    for (const w of widgets) if (!seen.has(w.id)) known.push(w.id)
    return known
      .map((id) => widgets.find((w) => w.id === id))
      .filter((w): w is DashboardWidget => Boolean(w))
  })()

  // Verilen id sirasina gore GECERLI bir tek-sutun "sm" duzeni uretir -
  // masaustu ("lg") duzenine HIC dokunulmaz.
  const buildMobileSm = (orderedIds: string[]): Layout => {
    const source = (layouts.lg && layouts.lg.length ? layouts.lg : effectiveDefaultLg)
    const byId = new Map(source.map((item) => [item.i, item]))
    const currentSmById = new Map((Array.isArray(layouts.sm) ? layouts.sm : []).map((item) => [item.i, item]))
    const mobileHalfIds = new Set(widgets.filter((w) => w.mobileHalf).map((w) => w.id))
    return orderedIds.map((wid, index) => {
      const base = byId.get(wid)
      const cur = currentSmById.get(wid)
      return {
        i: wid, x: 0, y: index,
        w: cur?.w === 1 ? 1 : cur?.w && cur.w >= 2 ? 2 : mobileHalfIds.has(wid) ? 1 : 2,
        h: cur?.h ?? base?.h ?? 20,
        minW: base?.minW, minH: base?.minH,
      }
    })
  }

  const moveMobileWidget = (id: string, dir: -1 | 1) => {
    const ids = mobileOrderedWidgets.map((w) => w.id)
    const index = ids.indexOf(id)
    const target = index + dir
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    const next = { ...layouts, sm: buildMobileSm(ids) }
    setLayouts(next)
    void persistLayouts(next, hiddenIds)
  }

  // Mobil Tasarim Modu'nda kutu yuksekligi - / + dugmeleriyle (sm "h",
  // 1 birim = 9px).
  const MOBILE_H_UNIT_PX = ROW_HEIGHT + ROW_MARGIN // 9px
  const MOBILE_H_STEP = 6 // ~54px
  const MOBILE_H_MIN = 14
  const MOBILE_H_MAX = 120
  const mobileHeightById = new Map(
    (Array.isArray(layouts.sm) ? layouts.sm : []).map((item) => [item.i, item.h]),
  )
  const mobileWidthById = new Map(
    (Array.isArray(layouts.sm) ? layouts.sm : []).map((item) => [item.i, item.w]),
  )
  const resizeMobileWidget = (id: string, deltaUnits: number) => {
    const ids = mobileOrderedWidgets.map((w) => w.id)
    const currentSm = Array.isArray(layouts.sm) ? layouts.sm : buildMobileSm(ids)
    const nextSm = currentSm.map((item) => {
      if (item.i !== id) return item
      const nextH = Math.max(MOBILE_H_MIN, Math.min(MOBILE_H_MAX, (item.h ?? 30) + deltaUnits))
      return { ...item, h: nextH }
    })
    const next = { ...layouts, sm: nextSm }
    setLayouts(next)
    void persistLayouts(next, hiddenIds)
  }
  // Mobilde "genislik" = kutu 1 sutun (yarim) mu 2 sutun (tam) mu kaplasin.
  const resizeMobileWidgetWidth = (id: string, dir: -1 | 1) => {
    const ids = mobileOrderedWidgets.map((w) => w.id)
    const currentSm = Array.isArray(layouts.sm) ? layouts.sm : buildMobileSm(ids)
    const nextSm = currentSm.map((item) => {
      if (item.i !== id) return item
      const cur = item.w === 1 ? 1 : 2
      return { ...item, w: Math.max(1, Math.min(2, cur + dir)) }
    })
    const next = { ...layouts, sm: nextSm }
    setLayouts(next)
    void persistLayouts(next, hiddenIds)
  }

  const resetMobileLayout = () => {
    // Sadece MOBIL SIRAYI varsayilana dondurur - masaustu duzenine ve
    // gizli kutulara DOKUNMAZ.
    const baseLg = layouts.lg && layouts.lg.length ? layouts.lg : effectiveDefaultLg
    const next = { ...layouts, sm: buildDefaultMobileSm(baseLg) }
    setLayouts(next)
    void persistLayouts(next, hiddenIds)
  }

  const selectedWidget = selectedWidgetId ? widgets.find((widget) => widget.id === selectedWidgetId) : undefined
  const selectedItem = selectedWidgetId ? currentLg.find((item) => item.i === selectedWidgetId) : undefined
  // Tasarim izgarasi: 4 sutunda / 4 satirda bir kilavuz cizgi.
  const colWidthPx = width > 0 ? (width - ROW_MARGIN * (COLS.lg - 1)) / COLS.lg : 0
  const guideStepX = (colWidthPx + ROW_MARGIN) * 4
  const guideStepY = (ROW_HEIGHT + ROW_MARGIN) * 4
  const statusText = saveStatus === 'saving'
    ? 'Kaydediliyor...'
    : saveStatus === 'saved'
      ? 'Düzen kaydedildi ✓'
      : saveStatus === 'default-saved'
        ? 'Herkes için varsayılan tasarım yapıldı ✓'
        : saveStatus === 'error'
        ? 'Kaydedilemedi - tekrar deneyin'
        : ''
  const toolBtn = 'dashboard-no-drag inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[13px] font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div>
      {canEdit && !isNarrowViewport && (
        designMode ? (
          <div className="dashboard-design-toolbar sticky z-[700] mb-3 rounded-xl border border-[#D4B26A] bg-[#1E2A38] px-3 py-2 text-white shadow-lg" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="rounded-md bg-[#D4B26A] px-2 py-0.5 text-[12px] font-black uppercase tracking-wide text-[#1E2A38]">Tasarım Modu</span>
                <span className="truncate text-[13px] font-semibold text-slate-200">
                  {selectedWidget && selectedItem
                    ? `Seçili: ${selectedWidget.title} — yön tuşları taşır, Ctrl+yön boyutlandırır (Shift: büyük adım)`
                    : 'Kutuyu tutup sürükleyin · kenar ve köşelerinden boyutlandırın · tıklayıp seçin, yön tuşlarıyla ince ayar yapın'}
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {isDirty && <span className="mr-1 text-[12px] font-bold text-[#D4B26A]">● Kaydedilmemiş değişiklik</span>}
                {statusText && <span className={`mr-1 text-[12px] font-bold ${saveStatus === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>{statusText}</span>}
                <button type="button" onClick={undo} disabled={historyPast.length === 0} title="Geri al (Ctrl+Z)" className={`${toolBtn} border-white/30 bg-white/10 text-white hover:bg-white/20`}>↶ Geri Al</button>
                <button type="button" onClick={redo} disabled={historyFuture.length === 0} title="Yinele (Ctrl+Y)" className={`${toolBtn} border-white/30 bg-white/10 text-white hover:bg-white/20`}>↷ Yinele</button>
                <button type="button" onClick={resetToDefault} disabled={!isLoaded} title="Kutuların boyut/konumunu ve gizleme durumunu ortak varsayılan tasarıma döndürür (Kaydet'e basana kadar kalıcı olmaz)" className={`${toolBtn} border-white/30 bg-white/10 text-white hover:bg-white/20`}>Varsayılana Sıfırla</button>
                {canSetDefault && (
                  <button type="button" onClick={() => void setAsSharedDefault()} disabled={!isLoaded || saveStatus === 'saving'} title="Bu tasarımı herkes için varsayılan ana sayfa düzeni yapar; kişisel düzenler silinir (yalnız yöneticiler)" className={`${toolBtn} border-[#0E7C86] bg-[#0E7C86] text-white hover:bg-[#0b6870]`}>★ Varsayılan Tasarım Yap</button>
                )}
                <span className="mx-1 h-6 w-px bg-white/25" aria-hidden="true" />
                <button type="button" onClick={cancelDesign} className={`${toolBtn} border-white/40 bg-transparent text-white hover:bg-white/10`}>Vazgeç</button>
                <button type="button" onClick={() => void saveDesign()} disabled={saveStatus === 'saving'} className={`${toolBtn} border-[#D4B26A] bg-[#D4B26A] text-[#1E2A38] hover:bg-[#e2c47f]`}>
                  {saveStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-500 shadow-sm">
            <span className="truncate">Ana sayfa düzeni kilitli. Kutuların yerini ve boyutunu değiştirmek için “Tasarım Modu”nu açın.</span>
            <div className="flex shrink-0 items-center gap-2">
              {statusText && <span className={saveStatus === 'error' ? 'text-rose-600' : 'text-emerald-700'}>{statusText}</span>}
              <button
                type="button"
                onClick={startDesignMode}
                disabled={!isLoaded}
                className="rounded-lg border border-[#1E2A38] bg-white px-3 py-1 font-bold text-[#1E2A38] shadow-sm transition-colors hover:bg-[#1E2A38] hover:text-white disabled:opacity-50"
              >
                Tasarım Modu
              </button>
            </div>
          </div>
        )
      )}
      <div ref={containerRef} onMouseEnter={measureScale}>
        {isNarrowViewport ? (
          <div>
            {canEdit && (
              <div className={`mb-2 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold shadow-sm ${mobileDesignActive ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-500'}`}>
                <span className="truncate">
                  {mobileDesignActive ? 'Sırayı ▲▼ ile değiştirin, Gizle/Göster ile ayarlayın. Bu hesaba kaydedilir.' : 'Ana sayfa düzeni'}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`transition-opacity ${saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}`}>
                    {saveStatus === 'saving' ? 'Kaydediliyor...' : saveStatus === 'error' ? 'Kaydedilemedi' : 'Kaydedildi ✓'}
                  </span>
                  {mobileDesignActive && (
                    <button
                      type="button"
                      onClick={resetMobileLayout}
                      disabled={!isLoaded}
                      className="rounded-lg border border-amber-300 bg-white px-2 py-1 font-black text-amber-700 shadow-sm hover:bg-amber-100 disabled:opacity-50"
                    >
                      Sıfırla
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMobileDesignActive((prev) => !prev)}
                    className={`rounded-lg border px-2.5 py-1 font-black uppercase tracking-wide shadow-sm transition-colors ${
                      mobileDesignActive
                        ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {mobileDesignActive ? 'Bitir' : 'Tasarım'}
                  </button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 items-start gap-3">
              {(mobileDesignActive ? mobileOrderedWidgets : mobileOrderedWidgets.filter((w) => !hiddenIds.has(w.id))).map((widget, index, arr) => {
                const isHidden = hiddenIds.has(widget.id)
                const wUnits = mobileWidthById.get(widget.id) === 1 ? 1 : mobileWidthById.get(widget.id) && (mobileWidthById.get(widget.id) as number) >= 2 ? 2 : (widget.mobileHalf ? 1 : 2)
                const halfWidth = !mobileDesignActive && wUnits === 1
                const hUnitsRaw = mobileHeightById.get(widget.id)
                const hUnits = typeof hUnitsRaw === 'number'
                  ? Math.max(MOBILE_H_MIN, Math.min(MOBILE_H_MAX, hUnitsRaw))
                  : undefined
                const explicitHeightPx = typeof hUnits === 'number' ? Math.round(hUnits * MOBILE_H_UNIT_PX) : undefined
                const btnCls = 'rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[12px] font-black leading-none text-amber-700 disabled:opacity-40'
                return (
                  <div
                    key={widget.id}
                    className={`${halfWidth ? 'col-span-1' : 'col-span-2'} flex w-full min-w-0 flex-col overflow-hidden rounded-2xl ${
                      mobileDesignActive && isHidden
                        ? 'opacity-50 ring-2 ring-dashed ring-slate-300'
                        : mobileDesignActive
                          ? 'ring-2 ring-amber-300'
                          : ''
                    }`}
                  >
                    {mobileDesignActive && (
                      <div className="flex flex-col gap-1 border-b border-amber-200 bg-amber-50 px-2 py-1.5">
                        <span className="min-w-0 truncate text-[11px] font-black text-amber-800">{widget.title}</span>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="flex items-center gap-1">
                            <span className="text-[9px] font-black uppercase text-amber-600">Sıra</span>
                            <button type="button" onClick={() => moveMobileWidget(widget.id, -1)} disabled={index === 0} className={btnCls}>▲</button>
                            <button type="button" onClick={() => moveMobileWidget(widget.id, 1)} disabled={index === arr.length - 1} className={btnCls}>▼</button>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="text-[9px] font-black uppercase text-amber-600">Boy</span>
                            <button type="button" onClick={() => resizeMobileWidget(widget.id, -MOBILE_H_STEP)} title="Kısalt" className={btnCls}>−</button>
                            <button type="button" onClick={() => resizeMobileWidget(widget.id, MOBILE_H_STEP)} title="Uzat" className={btnCls}>+</button>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="text-[9px] font-black uppercase text-amber-600">En</span>
                            <button type="button" onClick={() => resizeMobileWidgetWidth(widget.id, -1)} disabled={wUnits === 1} title="Yarım genişlik" className={btnCls}>◄</button>
                            <button type="button" onClick={() => resizeMobileWidgetWidth(widget.id, 1)} disabled={wUnits === 2} title="Tam genişlik" className={btnCls}>►</button>
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleHidden(widget.id)}
                            className={`rounded border px-2 py-0.5 text-[10px] font-black uppercase leading-none ${
                              isHidden
                                ? 'border-slate-300 bg-white text-slate-600'
                                : 'border-amber-400 bg-amber-500 text-white'
                            }`}
                          >
                            {isHidden ? 'Göster' : 'Gizle'}
                          </button>
                        </div>
                      </div>
                    )}
                    <div
                      className="min-h-0 w-full"
                      style={explicitHeightPx ? { height: `${explicitHeightPx}px` } : undefined}
                    >
                      {widget.node}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (<>
        {mounted && !isLoaded && (
          // Kayitli duzen gelene kadar grid cizilmez - once varsayilan duzenle
          // cizilip sonra "ziplama" olmasin.
          <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-10 text-xs font-bold text-slate-400">
            Düzen yükleniyor...
          </div>
        )}
        {mounted && isLoaded && (
          <div
            className={designMode ? 'dashboard-design-surface rounded-xl' : undefined}
            style={designMode && guideStepX > 0 ? {
              backgroundImage: 'linear-gradient(to right, rgba(30,42,56,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(30,42,56,0.06) 1px, transparent 1px)',
              backgroundSize: `${guideStepX}px ${guideStepY}px`,
            } : undefined}
            onMouseDown={(event) => {
              // Bos alana tiklaninca secim kalkar
              if (designMode && !(event.target as HTMLElement).closest('[data-widget-id]')) setSelectedWidgetId(null)
            }}
          >
            <Responsive
              key={gridInstanceKey}
              layouts={effectiveLayouts}
              breakpoints={BREAKPOINTS}
              cols={COLS}
              width={width}
              margin={[ROW_MARGIN, ROW_MARGIN]}
              containerPadding={[0, 0]}
              rowHeight={ROW_HEIGHT}
              positionStrategy={positionStrategy}
              compactor={verticalCompactor}
              dragConfig={{ enabled: designMode, cancel: NO_DRAG_SELECTOR }}
              resizeConfig={{ enabled: designMode, handles: ['e', 's', 'se', 'sw', 'w'] }}
              onLayoutChange={handleLayoutChange}
              onDragStart={handleInteractionStart}
              onResizeStart={handleInteractionStart}
              onDragStop={(layout) => handleInteractionStop(layout)}
              onResizeStop={(layout) => handleInteractionStop(layout)}
            >
              {widgets
                .filter((widget) => designMode || !hiddenIds.has(widget.id))
                .map((widget) => {
                const isHidden = hiddenIds.has(widget.id)
                const isSelected = designMode && selectedWidgetId === widget.id
                return (
                  <div
                    key={widget.id}
                    data-widget-id={widget.id}
                    aria-label={widget.title}
                    className={`dashboard-grid-item group relative overflow-hidden rounded-2xl ${designMode ? 'dashboard-design-mode-active' : ''} ${isSelected ? 'dashboard-item-selected' : ''} ${designMode && isHidden ? 'dashboard-item-hidden' : ''}`}
                  >
                    {designMode && (
                      <div
                        className="dashboard-design-overlay absolute inset-0 z-[500]"
                        onMouseDown={handleOverlayMouseDown}
                        onClick={handleOverlayClick(widget.id)}
                        title={`${widget.title} — sürükleyerek taşıyın, tıklayarak seçin`}
                      >
                        <span className="dashboard-design-label">
                          {widget.title}{isHidden ? ' (gizli)' : ''}
                        </span>
                      </div>
                    )}
                    {(designMode || (widget.fullReportPath && onOpenFullReport)) && (
                      <div className="dashboard-no-drag absolute right-1.5 top-1.5 z-[600] flex items-center gap-1">
                        {!designMode && widget.fullReportPath && onOpenFullReport && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenFullReport(widget.fullReportTitle || widget.title, widget.fullReportPath as string)
                            }}
                            title="Tam raporu yeni sekmede aç"
                            aria-label="Tam raporu yeni sekmede aç"
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-white/60 bg-[#101E2B]/70 text-[15px] font-black leading-none text-white shadow-md transition hover:bg-[#0E7C86]"
                          >
                            ⤢
                          </button>
                        )}
                        {designMode && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleHidden(widget.id)
                            }}
                            title={isHidden ? 'Bu alanı göster' : 'Bu alanı gizle'}
                            className={`cursor-pointer rounded-md border px-2 py-1 text-[12px] font-bold shadow-sm ${
                              isHidden
                                ? 'border-[#D4B26A] bg-[#D4B26A] text-[#1E2A38] hover:bg-[#e2c47f]'
                                : 'border-white/60 bg-[#1E2A38]/85 text-white hover:bg-[#1E2A38]'
                            }`}
                          >
                            {isHidden ? 'Göster' : 'Gizle'}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="app-visible-scroll h-full w-full overflow-y-auto">{widget.node}</div>
                  </div>
                )
              })}
            </Responsive>
          </div>
        )}
        </>)}
      </div>
    </div>
  )
}
