'use client'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Responsive, useContainerWidth, getCompactor, type Layout } from 'react-grid-layout'
import { useUiScale } from '@/components/layout/ScaleContext'
import { createParentAwareScaledStrategy } from '@/components/shared/rglParentAwareScaledStrategy'

// Kullanici istegi (28 Agustos 2026 - guncelleme): bir kutuyu ASAGI DOGRU
// BUYUTUNCE (yeniden boyutlandirinca) ALTINDAKI tum kutular da AYNI kadar
// asagi KAYSIN (ust uste binmesin). Bunun icin "preventCollision" kapatildi
// (artik false) - boylece react-grid-layout carpisan kutulari yolundan
// iter. compactType hala "null": yani ittikten sonra kutular YUKARI geri
// SICRAMAZ (yer cekimi/otomatik sikistirma yok), kullanicinin bilerek
// biraktigi bosluklar korunur; SADECE gercek carpismada itme olur.
// (Onceki surumde "preventCollision: true" idi - o zaman itme hic yoktu ama
// asagi buyutunce alttakinin USTUNE biniyordu.)
const noCollisionCompactor = getCompactor(null, false, false)

// Kullanici istegi: Ana Sayfa'daki rapor kutularini kosesinden tutup
// buyutup kucultebilsin, yerlerini degistirebilsin ve bu duzeni
// kaydedebilsin - HER KULLANICI kendine gore. Bu bilesen, verilen widget
// listesini react-grid-layout ile saran, surukle/yeniden-boyutlandir/
// sifirla destekli genel amacli bir sargidir - dashboard/page.tsx'teki
// mevcut widget bilesenlerinin HICBIRINE dokunmadan, onlari sadece bu
// sarmalayicinin icine yerlestirir.
//
// Kullanici istegi (2. tur): Dosya Yonetimi sayfasindaki "Tasarim Modu"
// (bkz. components/shared/LocalDesignGrid.tsx) ile AYNI mantik/isleyis
// Ana Sayfa'ya da uygulandi:
//  - Surukleme/boyutlandirma artik yetkiye sahip olan HERKESTE HER ZAMAN
//    acik degil - ACIKCA "Tasarim Modu" acilmadan kutular surunmez/
//    boyutlandirilmaz (yanlislikla kutu tasima riski azalir).
//  - Kutular Tasarim Modu'nda GIZLENIP tekrar GOSTERILEBILIR ("alan
//    ekleyip kaldirabilme") - gizli kutular normal goruntulemede hic yer
//    kaplamaz, Tasarim Modu'nda ise soluk/kesikli cerceveyle secilebilir
//    kalir.
//
// Kullanici istegi (3. tur): duzen KESINLIKLE KULLANICI HESABINA gore
// saklanmalidir - bir ARA denemede (tarayici localStorage'ina tasima)
// bunun YANLIS oldugu ortaya cikti: AYNI bilgisayardan FARKLI hesaplarla
// giren personel, hesap FARKLI olsa bile AYNI (o bilgisayara ait) duzeni
// goruyordu; istenen ise "HANGI HESAPLA girilirse o hesabin KENDI duzeni"
// idi. Bu yuzden kayit YENIDEN sunucu tarafina (bkz.
// app/api/dashboard-layout/route.ts, kullaniciId bazinda) alindi - artik
// hangi bilgisayardan girilirse girilsin AYNI hesap HER ZAMAN kendi
// duzenini gorur, farkli bir hesap (ayni bilgisayardan bile olsa) KENDI
// (ya da hic yoksa varsayilan) duzenini gorur.
const DASHBOARD_LAYOUT_GRID_ID = 'dashboard'

export type DashboardWidget = {
  id: string
  title: string
  node: ReactNode
  // Mobil (dar ekran) dizilimde bu kutu YARIM genislik kaplasin - ardisik
  // iki "yarim" kutu yan yana gelir (ör. Dosya Ozeti + Birey Ozeti).
  mobileHalf?: boolean
  // Kullanici istegi (2026-09-12): "Yardım Haritası, Yardım Türleri gibi
  // tüm raporların köşesine bir buton eklensin, istenirse rapor tam sayfa
  // olarak yeni pencerede/sekmede görünebilsin" - bu alan verilen widget'lar
  // icin kartin sag-ust kosesinde HER ZAMAN (Tasarim Modu'ndan bagimsiz)
  // gorunen kucuk bir "⤢" dugmesi ekler; tiklaninca onOpenFullReport
  // (dashboard/page.tsx'teki mevcut addTab/openReportInNewTab mekanizmasi -
  // uygulamadaki TUM diger "raporu ac" eylemleriyle AYNI) bu rota/basligi
  // yeni bir sekmede acar. Verilmezse (cogu KPI/ozet karti gibi tek bir
  // "tam" rapor sayfasina karsilik gelmeyen widget'larda) hicbir sey
  // degismez - dugme hic render edilmez.
  fullReportPath?: string
  fullReportTitle?: string
}

const BREAKPOINTS = { lg: 1100, sm: 0 }
// Kullanici istegi: kutular boyutlandirilirken adimlar COK KABA kalıyordu
// ("sekme sekme" degisiyor, komsu kutuyla TAM hizalanamiyordu) - bu yuzden
// sutun sayisi 12'den 48'e cikarildi VE satir birimi de AYNI oranda (4 kat)
// kucultuldu (rowHeight 20->5, margin 16->4) - boylece surukleme neredeyse
// piksel hassasiyetinde, komsu kutularla tam esitlemek cok daha kolay.
// ONCEDEN kaydedilmis (eski, 12 sutunluk) duzenler bu degisiklikten
// ETKILENMEZ - app/api/dashboard-layout/route.ts GET sirasinda bunlari
// GORUNMEZ bir sekilde (kullaniciya sifirlanmis gibi HISSETTIRMEDEN) yeni
// olcege otomatik yukseltir (bkz. oradaki "gridVersion" notu).
const COLS = { lg: 48, sm: 1 }
const ROW_HEIGHT = 5
const ROW_MARGIN = 4
// Kullanici istegi: kutu, kendi RENKLI BASLIK cubugundan tutulup
// tasinabilsin - ayri/fazladan bir tutamac cubugu EKLENMEDEN, her widget
// bilesenindeki MEVCUT renkli baslik barina bu sinif eklendi (bkz. Section,
// SummaryListPanel, AssistanceAlertCard vb. - hepsinde ".dashboard-drag-handle"
// classi var). Baslik AYNI ZAMANDA bir buton/link ise (ör. "Kullanici
// Performansi" basligindaki "Tumunu Gor") tek tiklama esigi (3px)
// asilmadigi surece normal calismaya devam eder, sadece gercekten
// SURUKLENIRSE kutu tasinir.
const DRAG_HANDLE_SELECTOR = '.dashboard-drag-handle'
const DRAG_CLICK_SUPPRESS_DISTANCE = 5

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

// Kullanici istegi (2026-09-12): "Tasarım modundayken bir alanın yerini ve
// boyutunu aynı zamanda yön tuşları ile de ayarlayabilelim" - LocalDesignGrid.
// tsx'teki (Dosya Yonetimi) AYNI klavye-ile-hassas-tasima/boyutlandirma
// ozelligi Ana Sayfa'ya da eklendi (tutarli/"profesyonel" bir Tasarim Modu
// deneyimi icin - fare ile suruklemek bazen zor/hatali oluyordu). Secili bir
// kutu, BASKA bir kutuyle CAKISIRSA (dikdortgen kesisimi) hareket etmez -
// fareyle suruklemenin aksine ASLA komsu kutuyu itmez.
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function DashboardGrid({
  widgets,
  defaultLayout,
  canEdit,
  onOpenFullReport,
}: {
  widgets: DashboardWidget[]
  defaultLayout: Layout
  // Kullanici istegi: kutularin yerini/boyutunu degistirebilme/gizleyebilme
  // SADECE "Ana sayfa duzenini degistirme" yetkisi acik olan personelde
  // gorunsun/calissin - digerleri (kayitli varsa kendi, yoksa varsayilan)
  // duzeni GORUR ama Tasarim Modu'nu hic ACAMAZ. Sunucu tarafinda da
  // AYRICA zorunlu kilinir (bkz. app/api/dashboard-layout/route.ts) - bu
  // prop sadece arayuzu (Tasarim Modu dugmesini) buna gore acar-kapar.
  canEdit: boolean
  // Kullanici istegi (2026-09-12): widget.fullReportPath verilen kartlarin
  // kosesindeki "⤢" dugmesine tiklaninca cagrilir - cagiran sayfa (bkz.
  // dashboard/page.tsx) kendi addTab/openReportInNewTab fonksiyonunu verir,
  // boylece TUM diger "raporu ac" eylemleriyle AYNI mekanizma kullanilir.
  onOpenFullReport?: (title: string, path: string) => void
}) {
  const { width, containerRef, mounted } = useContainerWidth()
  // Ayni fare-oransizligi duzeltmesi (bkz. LocalDesignGrid.tsx'teki
  // ayrintili yorum) - kabuk CSS `zoom` ile olceklendiginde react-grid-
  // layout'un surukleme/boyutlandirma matematigi bu katsayidan haberdar
  // olmali.
  const uiZoomScale = useUiScale()
  // Mobil / dar ekran: react-grid-layout (mutlak konumlu, sabit piksel) kutulari
  // ust uste bindiriyor. Bu genislikte grid tamamen devre disi - kutular
  // DOGAL yukseklikte, dikey alt alta; Tasarim Modu da anlamsiz.
  // Hata (Eylul 2026): esik SABIT 900 idi ama <Responsive>'in kendi
  // BREAKPOINTS.lg esigi 1100 - 900-1100px arasi TABLETLERDE isNarrowViewport
  // "genis" (false) deyip RGL dalina geciyor, RGL de bu genislikte "sm"
  // (cols=1) breakpoint'ine dusuyor -> kutular/tablolar TEK sutunda UST USTE
  // biniyordu. Iki esik ARTIK AYNI (BREAKPOINTS.lg). (Bkz. LocalDesignGrid.tsx
  // AYNI duzeltme.)
  const isNarrowViewport = mounted && width > 0 && width < BREAKPOINTS.lg
  const pointerDownRef = useRef<{ x: number; y: number; onHandle: boolean } | null>(null)
  const [designModeState, setDesignMode] = useState(false)
  const designMode = designModeState && !isNarrowViewport
  // Mobil (dar ekran) icin ayri bir "Tasarim" modu - serbest grid yerine
  // sadece sira degistirme + gizleme.
  const [mobileDesignActive, setMobileDesignActive] = useState(false)
  // Kullanici istegi (2026-09-12): bir kutuyu tutamacindan GERCEKTEN
  // tiklayarak (surukleme DEGIL) SECEBILSIN - secili kutu yon tuslariyla
  // (Ctrl+yon ile boyutlandirma) hassas ayarlanabilsin (bkz. LocalDesignGrid.
  // tsx - AYNI mantik).
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)

  useEffect(() => {
    if (!designMode) return
    const container = containerRef.current
    if (!container) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      pointerDownRef.current = {
        x: event.clientX,
        y: event.clientY,
        onHandle: Boolean(target?.closest(DRAG_HANDLE_SELECTOR)),
      }
    }

    const handleClickCapture = (event: MouseEvent) => {
      const start = pointerDownRef.current
      pointerDownRef.current = null
      if (!start) return

      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
      const wasDrag = distance > DRAG_CLICK_SUPPRESS_DISTANCE

      if (!start.onHandle) {
        setSelectedWidgetId(null)
        return
      }

      if (wasDrag) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      const target = event.target as HTMLElement | null
      const widgetId = target?.closest<HTMLElement>('[data-widget-id]')?.dataset.widgetId
      setSelectedWidgetId(widgetId ?? null)
    }

    container.addEventListener('mousedown', handlePointerDown, true)
    container.addEventListener('click', handleClickCapture, true)
    return () => {
      container.removeEventListener('mousedown', handlePointerDown, true)
      container.removeEventListener('click', handleClickCapture, true)
    }
  }, [containerRef, designMode])

  useEffect(() => {
    if (!designMode) setSelectedWidgetId(null)
  }, [designMode])

  // Mobil "sm" varsayilani: tek sutun; w=1 SADECE mobileHalf kutulari (yan
  // yana ciftler), digerleri w=2 (tam genislik). Kullanici mobil Tasarim
  // Modu'nda h/w'yi degistirdikce bu korunur.
  const buildDefaultMobileSm = (lg: Layout): Layout => {
    const half = new Set(widgets.filter((w) => w.mobileHalf).map((w) => w.id))
    return buildSingleColumnLayout(lg).map((it) => ({ ...it, w: half.has(it.i) ? 1 : 2 }))
  }
  const [layouts, setLayouts] = useState<Partial<Record<string, Layout>>>({
    lg: defaultLayout,
    sm: buildDefaultMobileSm(defaultLayout),
  })
  // Kullanici istegi: "Varsayılan Düzene Sıfırla" bazen TEMIZ varsayilan
  // duzeni degil, her kutunun BIRBIRINDEN FARKLI/BOZUK yerlere sicradigi bir
  // sonuc veriyordu. Kok neden: react-grid-layout, kontrollu "layouts" prop'u
  // programatik olarak (surukleme DEGIL) DEGISTIRILDIGINDE bile, kendi
  // ICINDEKI eski/bozuk yerlesim durumunu tam sifirlamayabiliyor - "reset"
  // sonrasi ilk onLayoutChange, verdigimiz TEMIZ defaultLayout yerine, bu
  // eski ic duruma gore YENIDEN HESAPLANMIS (ve bazen BOZUK) bir sonuc
  // dondurup bunu (skipNextSaveRef=false oldugu icin) KAYDEDIYORDU - biz de
  // bu bozuk sonucu "yeni varsayilan" sanip saklıyorduk. Kesin/guvenilir
  // cozum: sifirlamada <Responsive>'i (asagida key={gridInstanceKey} ile)
  // TAMAMEN YENIDEN MONTE ETMEK - boylece kutuphanenin ic durumu SIFIRDAN
  // baslar, eski/bozuk hicbir kalinti tasimaz.
  const [gridInstanceKey, setGridInstanceKey] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  // Kullanici istegi: istedigi kutuyu gizleyip istedigini gosterebilsin
  // ("alan ekleyip kaldirabilme") - digerleri gibi HER KULLANICI HESABINA
  // OZEL sunucuda saklanir (bkz. app/api/dashboard-layout/route.ts).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextSaveRef = useRef(true)

  // Kayitli (sunucudaki, bu HESABA ozel) duzeni yukle - eger daha once bu
  // widget id'si KAYITLI DUZENDE yoksa (ileride yeni bir rapor kutusu
  // eklenirse) o widget'in varsayilan konumu korunur, kaybolmaz.
  useEffect(() => {
    let isCancelled = false

    fetch(`/api/dashboard-layout?grid=${DASHBOARD_LAYOUT_GRID_ID}`)
      .then((res) => res.json())
      .then((payload) => {
        if (isCancelled) return
        const savedLg: Layout | undefined = payload?.success ? payload.data?.layouts?.lg : undefined
        const savedSm: Layout | undefined = payload?.success ? payload.data?.layouts?.sm : undefined
        const savedHidden: string[] = payload?.success && Array.isArray(payload.data?.hiddenIds) ? payload.data.hiddenIds : []
        setHiddenIds(new Set(savedHidden))
        if (!Array.isArray(savedLg) || savedLg.length === 0) return

        const savedIds = new Set(savedLg.map((item) => item.i))
        const missingDefaults = defaultLayout.filter((item) => !savedIds.has(item.i))
        const mergedLg = [...savedLg, ...missingDefaults]

        // Mobil sira: kayitli "sm" varsa ONUN sirasini koru (kullanici
        // mobilde elle dizmis olabilir); yoksa masaustu duzeninden turet.
        // Kullanici istegi (28 Agu 2026): mobil Tasarim Modu'nda kutu
        // YUKSEKLIGI (h) ve GENISLIGI (w: 1=yarim / 2=tam sutun) ayarlanabilir
        // - bu yuzden kayitli sm'in h/w degerleri ARTIK KORUNUR (eskiden
        // yukleme sirasinda lg'den yeniden turetiliyor, kaybediliyordu).
        const mobileHalfIds = new Set(widgets.filter((w) => w.mobileHalf).map((w) => w.id))
        const savedSmById = new Map((Array.isArray(savedSm) ? savedSm : []).map((it) => [it.i, it]))
        // Eski kayitlarda TUM sm.w === 1 idi (buildSingleColumnLayout ciktisi) -
        // bu "kullanici genislik secmedi" demektir, varsayilana (mobileHalf?1:2) don.
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

        skipNextSaveRef.current = true
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

  const persistLayouts = (next: Partial<Record<string, Layout>>, nextHiddenIds?: Set<string>) => {
    setSaveStatus('saving')
    fetch('/api/dashboard-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid: DASHBOARD_LAYOUT_GRID_ID, layouts: next, hiddenIds: Array.from(nextHiddenIds ?? hiddenIds) }),
    })
      .then((res) => res.json())
      .then((payload) => {
        setSaveStatus(payload?.success ? 'saved' : 'idle')
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
        statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      })
      .catch(() => setSaveStatus('idle'))
  }

  // Kullanici istegi: secili kutuyu yon tuslariyla (Shift ile 5'er birim,
  // normalde 1'er birim) hassas tasima - baska bir kutuyla cakisirsa
  // (rectsOverlap) hareket sessizce yoksayilir.
  const moveSelectedWidget = (dx: number, dy: number) => {
    if (!selectedWidgetId) return
    setLayouts((prev) => {
      const lg = prev.lg
      if (!lg) return prev
      const current = lg.find((item) => item.i === selectedWidgetId)
      if (!current) return prev

      const nextX = Math.min(Math.max(0, current.x + dx), Math.max(0, COLS.lg - current.w))
      const nextY = Math.max(0, current.y + dy)
      if (nextX === current.x && nextY === current.y) return prev

      const candidate = { ...current, x: nextX, y: nextY }
      const collides = lg.some((item) => item.i !== selectedWidgetId && rectsOverlap(candidate, item))
      if (collides) return prev

      const nextLg = lg.map((item) => (item.i === selectedWidgetId ? candidate : item))
      const next = { ...prev, lg: nextLg }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => persistLayouts(next), 600)
      return next
    })
  }

  // Kullanici istegi: secili kutuyu Ctrl+yon tuslariyla (Shift ile 5'er
  // birim, normalde 1'er birim) hassas BOYUTLANDIRMA - fareyle
  // boyutlandirmanin aksine ASLA baska bir kutuya carpmaz/onu itmez.
  const resizeSelectedWidget = (dw: number, dh: number) => {
    if (!selectedWidgetId) return
    setLayouts((prev) => {
      const lg = prev.lg
      if (!lg) return prev
      const current = lg.find((item) => item.i === selectedWidgetId)
      if (!current) return prev

      const minW = current.minW ?? 1
      const minH = current.minH ?? 1
      const maxW = Math.max(minW, COLS.lg - current.x)
      const nextW = Math.min(Math.max(minW, current.w + dw), maxW)
      const nextH = Math.max(minH, current.h + dh)
      if (nextW === current.w && nextH === current.h) return prev

      const candidate = { ...current, w: nextW, h: nextH }
      const collides = lg.some((item) => item.i !== selectedWidgetId && rectsOverlap(candidate, item))
      if (collides) return prev

      const nextLg = lg.map((item) => (item.i === selectedWidgetId ? candidate : item))
      const next = { ...prev, lg: nextLg }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => persistLayouts(next), 600)
      return next
    })
  }

  useEffect(() => {
    if (!designMode || !selectedWidgetId) return

    const ARROW_DELTAS: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const delta = ARROW_DELTAS[event.key]
      if (!delta) return

      const activeTag = (document.activeElement?.tagName || '').toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return

      event.preventDefault()
      const step = event.shiftKey ? 5 : 1
      if (event.ctrlKey || event.metaKey) {
        resizeSelectedWidget(delta[0] * step, delta[1] * step)
      } else {
        moveSelectedWidget(delta[0] * step, delta[1] * step)
      }
    }

    const handleKeyDownEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedWidgetId(null)
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keydown', handleKeyDownEscape)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keydown', handleKeyDownEscape)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designMode, selectedWidgetId, layouts.lg])

  // onLayoutChange, surukleme/boyutlandirma sirasinda (yerlesim yeniden
  // hesaplandikca) sik cagrilabilir - sunucuya HER cagrida degil, kullanici
  // birakip 600ms boyunca baska bir degisiklik yapmayinca (debounce) kaydeder.
  const handleLayoutChange = (_current: Layout, allLayouts: Partial<Record<string, Layout>>) => {
    if (!designMode) {
      // Tasarim modu kapaliyken surukleme/boyutlandirma zaten devre disi
      // (asagida dragConfig/resizeConfig enabled=false) - bu, sadece ilk
      // yerlesim/sikistirma hesaplamasi olabilir, kullanici degisikligi
      // OLAMAZ - HICBIR SEKILDE sunucuya kaydedilmeye calisilmaz.
      setLayouts(allLayouts)
      return
    }

    if (skipNextSaveRef.current) {
      // Sayfa ilk yuklenirken / kayitli duzen uygulanirken tetiklenen ilk
      // onLayoutChange, kullanicinin YAPTIGI bir degisiklik degildir -
      // bunu sunucuya "kaydetme" olarak saymamak icin bir kez atlanir.
      skipNextSaveRef.current = false
      setLayouts(allLayouts)
      return
    }

    setLayouts(allLayouts)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => persistLayouts(allLayouts), 600)
  }

  // Kullanici istegi: surukleme/boyutlandirma TAMAMEN BITTIGINDE (fare
  // birakildiginda) o anki KESIN/NIHAI durumu, ara adimlarin (debounce)
  // atlanma ihtimaline karsi AYRICA garantiye alarak kaydeder.
  const commitCurrentLayout = () => {
    if (!designMode) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setLayouts((current) => {
      persistLayouts(current)
      return current
    })
  }

  const toggleHidden = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persistLayouts(layouts, next)
      return next
    })
  }

  const resetToDefault = () => {
    if (!designMode) return
    const next = { lg: defaultLayout, sm: buildDefaultMobileSm(defaultLayout) }
    // skipNextSaveRef=true: <Responsive> yeniden monte olurken ilk kez
    // ateslenecek onLayoutChange, sayfa ilk yuklenirkenkiyle AYNI mantikla,
    // kullanici degisikligi SAYILMAZ - kaydedilmeye calisilmaz (zaten
    // asagida TEMIZ defaultLayout'u dogrudan biz kaydediyoruz).
    skipNextSaveRef.current = true
    setLayouts(next)
    setHiddenIds(new Set())
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    persistLayouts(next, new Set())
    setGridInstanceKey((prev) => prev + 1)
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    }
  }, [])

  // Mobil: kutulari kayitli sıraya göre diz. Sıra "sm" duzeninden;
  // eksik/yeni kutular sona eklenir.
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
  // her kutunun GERCEK w/h'si (lg'den, yoksa varsayilandan) korunur; SADECE
  // y sirasi degisir. Boylece bu "sm", masaustunde 900-1100px arasi
  // pencerede <Responsive> tarafindan kullanilsa bile bozuk gorunmez ve
  // masaustu ("lg") duzenine HIC dokunulmaz.
  const buildMobileSm = (orderedIds: string[]): Layout => {
    const source = (layouts.lg && layouts.lg.length ? layouts.lg : defaultLayout)
    const byId = new Map(source.map((item) => [item.i, item]))
    // Kullanicinin mobilde ayarladigi h (yukseklik) ve w (1=yarim/2=tam)
    // sira degistirirken KORUNUR.
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
    skipNextSaveRef.current = true
    setLayouts(next)
    persistLayouts(next, hiddenIds)
  }

  // Kullanici istegi (28 Agustos 2026): mobil Tasarim Modu'nda kutu
  // YUKSEKLIGI de ayarlanabilsin (eskiden sadece sira + gizle vardi;
  // "hicbir alanin boyutunu degistiremiyorum" sikayeti). Serbest surukleme
  // dokunmatik kucuk ekranda pratik degil - bunun yerine kutu basina - / +
  // dugmeleriyle yukseklik (sm duzenindeki "h", 1 birim = 9px) degistirilir.
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
    skipNextSaveRef.current = true
    setLayouts(next)
    persistLayouts(next, hiddenIds)
  }
  // Kullanici istegi (28 Agu 2026): YANLARDAN da kucult/buyut - mobilde
  // "genislik" = kutu 1 sutun (yarim) mu 2 sutun (tam) mu kaplasin.
  // dir=-1 -> yarim (yaninda baska bir yarim kutu olabilir), dir=+1 -> tam.
  const resizeMobileWidgetWidth = (id: string, dir: -1 | 1) => {
    const ids = mobileOrderedWidgets.map((w) => w.id)
    const currentSm = Array.isArray(layouts.sm) ? layouts.sm : buildMobileSm(ids)
    const nextSm = currentSm.map((item) => {
      if (item.i !== id) return item
      const cur = item.w === 1 ? 1 : 2
      return { ...item, w: Math.max(1, Math.min(2, cur + dir)) }
    })
    const next = { ...layouts, sm: nextSm }
    skipNextSaveRef.current = true
    setLayouts(next)
    persistLayouts(next, hiddenIds)
  }

  const resetMobileLayout = () => {
    // Sadece MOBIL SIRAYI varsayilana dondurur - masaustu ("lg") duzenine
    // ve gizli/gosterilen kutu tercihine (hiddenIds, iki taraf ortak)
    // DOKUNMAZ.
    const baseLg = layouts.lg && layouts.lg.length ? layouts.lg : defaultLayout
    const next = { ...layouts, sm: buildDefaultMobileSm(baseLg) }
    skipNextSaveRef.current = true
    setLayouts(next)
    persistLayouts(next, hiddenIds)
  }

  return (
    <div>
      {canEdit && !isNarrowViewport && (
        <div className={`mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold shadow-sm ${designMode ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-500'}`}>
          <span className="truncate">
            {designMode
              ? 'Tasarım modunu değiştiriyorsunuz - kutuların başlığından tutup sürükleyin, sağ-alt köşeden boyutlandırın. Başlığa tıklayıp seçtiğiniz kutuyu yön tuşlarıyla (Shift ile daha hızlı) taşıyabilir, Ctrl+yön tuşlarıyla boyutlandırabilirsiniz. Bu düzen hesabınıza kaydedilir.'
              : 'Ana sayfa düzeni kilitli. Yerleşimi değiştirmek için "Tasarım Modu"nu açın.'}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`transition-opacity ${saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}`}>
              {saveStatus === 'saving' ? 'Düzen kaydediliyor...' : 'Düzen kaydedildi ✓'}
            </span>
            {designMode && (
              <button
                type="button"
                onClick={resetToDefault}
                disabled={!isLoaded}
                title="Kutuların boyut/konumunu ve gizleme durumunu varsayılana döndürür"
                className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-black text-amber-700 shadow-sm hover:bg-amber-100 disabled:opacity-50"
              >
                Varsayılan Düzene Sıfırla
              </button>
            )}
            <button
              type="button"
              onClick={() => setDesignMode((prev) => !prev)}
              className={`rounded-lg border px-3 py-1 font-black uppercase tracking-wide shadow-sm transition-colors ${
                designMode
                  ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {designMode ? 'Tasarım Modunu Kapat' : 'Tasarım Modu'}
            </button>
          </div>
        </div>
      )}
      <div ref={containerRef}>
        {isNarrowViewport ? (
          <div>
            {canEdit && (
              <div className={`mb-2 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold shadow-sm ${mobileDesignActive ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-500'}`}>
                <span className="truncate">
                  {mobileDesignActive ? 'Sırayı ▲▼ ile değiştirin, Gizle/Göster ile ayarlayın. Bu cihaza kaydedilir.' : 'Ana sayfa düzeni'}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`transition-opacity ${saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}`}>
                    {saveStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydedildi ✓'}
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
          // Kullanici istegi: Ana Sayfa sekmesine gecip geri donuldugunde
          // tasarim "bozuluyordu" - kok neden, kayitli (sunucudaki) duzen
          // fetch ile gelene kadar (ag gecikmesi kadar) sayfanin ONCE
          // VARSAYILAN duzenle cizilip, veri gelince kayitli duzene
          // "zipliyor" olmasiydi - bu zipla, kullaniciya tasarimin bozulup
          // duzeldigi seklinde gorunuyordu. Artik kayitli duzen tam olarak
          // gelip state'e yansiyana kadar grid HIC cizilmiyor - boylece
          // kutular DOGRUDAN kayitli/dogru boyutlariyla belirir, arada
          // yanlis (varsayilan) bir kare bile gorunmez.
          <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-10 text-xs font-bold text-slate-400">
            Düzen yükleniyor...
          </div>
        )}
        {mounted && isLoaded && (
          <Responsive
            key={gridInstanceKey}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            width={width}
            margin={[ROW_MARGIN, ROW_MARGIN]}
            containerPadding={[0, 0]}
            rowHeight={ROW_HEIGHT}
            positionStrategy={uiZoomScale !== 1 ? createParentAwareScaledStrategy(uiZoomScale, containerRef) : undefined}
            // Kullanici istegi (Dosya Yonetimi'ndeki AYNI sorunun Ana
            // Sayfa'ya da uygulanan cozumu - bkz. LocalDesignGrid.tsx):
            // kutular istenen yere (ustunde bosluk birakarak) tasinamiyordu,
            // react-grid-layout'un varsayilan "vertical" sikistirmasi
            // birakilir birakilmaz yukari itiyordu. Ana Sayfa'daki
            // kutularin (Dosya Yonetimi'nin auto-fit panellerinin aksine)
            // icerige gore CANLI degisen bir yuksekligi YOK - hepsi HER
            // ZAMAN duzende belirtilen boyutu (h-full/w-full) doldurur -
            // bu yuzden sikistirmanin burada hicbir zaman gercek bir
            // faydasi (kapatilacak "canli" bir bosluk) olmuyor, sadece
            // kullanicinin bilerek biraktigi boslugu bozuyordu. Bu yuzden
            // burada KOSULSUZ olarak kapatildi.
            compactor={noCollisionCompactor}
            dragConfig={{ enabled: designMode, handle: DRAG_HANDLE_SELECTOR }}
            resizeConfig={{ enabled: designMode, handles: ['se'] }}
            onLayoutChange={handleLayoutChange}
            onDragStop={commitCurrentLayout}
            onResizeStop={commitCurrentLayout}
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
                  // Kullanici istegi (15 Eylul 2026, 26. tur): "cursor-move" onceden
                  // Tailwind'in "[&_.dashboard-drag-handle]" turev-secici (arbitrary
                  // descendant selector) sinifiyla veriliyordu - bu, Turbopack/
                  // Lightning CSS derlemesinde bozuk baytli bir CSS secici uretip
                  // "3 uyari"ya (her build'de gorulen, ZARARSIZ ama "next dev"de
                  // FATAL hataya donen) yol aciyordu. ".dashboard-drag-handle" pek
                  // cok FARKLI bilesende (SummaryListPanel, AssistanceAlertCard vb.)
                  // kullanildigi icin dogrudan tek bir elemente tasinamaz - bunun
                  // yerine duz bir isaretleyici sinif + app/globals.css'te SAF CSS
                  // kurali kullanildi (bkz. globals.css ".dashboard-design-mode-active").
                  className={`dashboard-grid-item group relative overflow-hidden rounded-2xl ${designMode ? 'dashboard-design-mode-active' : ''} ${designMode && isHidden ? 'opacity-50 ring-2 ring-dashed ring-slate-300 ring-offset-2' : isSelected ? 'ring-2 ring-sky-500 ring-offset-2' : designMode ? 'ring-2 ring-amber-300 ring-offset-2' : ''}`}
                >
                  {(designMode || (widget.fullReportPath && onOpenFullReport)) && (
                    <div className="absolute right-1.5 top-1.5 z-[600] flex items-center gap-1">
                      {widget.fullReportPath && onOpenFullReport && (
                        <button
                          type="button"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpenFullReport(widget.fullReportTitle || widget.title, widget.fullReportPath as string)
                          }}
                          title="Tam sayfa olarak yeni sekmede aç"
                          className="cursor-pointer rounded border border-white/40 bg-black/30 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm hover:bg-black/45"
                        >
                          ⤢
                        </button>
                      )}
                      {designMode && (
                        <button
                          type="button"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleHidden(widget.id)
                          }}
                          title={isHidden ? 'Bu alanı göster' : 'Bu alanı gizle'}
                          className={`cursor-pointer rounded border px-1.5 py-0.5 text-[9px] font-black uppercase shadow-sm ${
                            isHidden
                              ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                              : 'border-white/40 bg-black/30 text-white hover:bg-black/45'
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
        )}
        </>)}
      </div>
    </div>
  )
}
