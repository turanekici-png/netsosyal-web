'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { formatFileNo } from '@/lib/utils'

// Kullanici istegi: "Yardım Dağılım Haritası" (eskiden sadece
// app/(modules)/assistance/map/page.tsx icinde yasiyordu) artik Ana Sayfa'da
// da "Yardım Haritası" adinda bir widget olarak gorunsun. Butun harita
// mantigi (veri cekme, Leaflet yukleme/isaretleme, filtre) BURAYA, PAYLASIMLI
// bir bilesene tasindi - hem tam sayfa (variant="page") hem de kompakt
// dashboard widget'i (variant="widget") AYNI bileseni, farkli bir kabuk/
// duzenle kullanir; boylece iki yerde ayri ayri bakim gerektiren kopya kod
// olusmaz.
type LatLngTuple = [number, number]

type MapData = {
  requestId?: string
  fileNo?: string
  requestStatus?: number | null
  address?: string
  mahalle?: string
  lat?: number | null
  lon?: number | null
  source?: string
  status?: string
  score?: number | null
  geocodedAt?: string | null
}

type AssistanceMapItem = {
  id: string
  applicant: string
  category: string
  label?: string
  mapData?: MapData
}

type AssistancePayload = {
  success?: boolean
  data?: AssistanceMapItem[]
  error?: string
}

type GeocodeBatchPayload = {
  success?: boolean
  processed?: number
  ok?: number
  error?: string
}

type LeafletPopupOpenEvent = {
  popup: { getElement: () => HTMLElement | null }
}

type LeafletMarker = {
  remove: () => void
  addTo: (map: LeafletMap) => LeafletMarker
  bindPopup: (html: string) => LeafletMarker
  on: (event: 'popupopen', handler: (e: LeafletPopupOpenEvent) => void) => LeafletMarker
}

type LeafletMap = {
  setView: (coords: LatLngTuple, zoom: number) => LeafletMap
  fitBounds: (bounds: unknown) => void
  invalidateSize: () => void
}

type LeafletLike = {
  map: (container: string | HTMLElement) => LeafletMap
  tileLayer: (url: string, options: { attribution: string }) => { addTo: (map: LeafletMap) => void }
  circleMarker: (coords: LatLngTuple, options: Record<string, string | number>) => LeafletMarker
  featureGroup: (markers: LeafletMarker[]) => { getBounds: () => { pad: (padding: number) => unknown } }
}

declare global {
  interface Window {
    L?: LeafletLike
  }
}

const SIVAS_CENTER: LatLngTuple = [39.7489, 37.0152]

const ALL_CATEGORIES_ID = 'tumu'

// Her yardım türü kendi rengiyle - hem tekli görünümde (o türün noktaları bu
// renkte) hem "Tümünü Göster" modunda (birden fazla tür aynı anda, renkle
// ayırt edilerek) kullanılır.
//
// Kullanici istegi: "Hazır Yemek" (eskiden turuncu #f57c00) ve "Destek
// Paketi" (eskiden yeşil #388e3c) noktalari haritada NET SECILMIYORDU -
// OpenStreetMap zemin dokusunda yollar zaten turuncu/sari, park/orman
// alanlari zaten yesil oldugu icin bu iki renk zeminle KARISIYORDU. Yerlerine,
// harita zemininde DOGAL OLARAK BULUNMAYAN, birbirinden VE kirmizi/maviden
// ACIKCA ayrisan mor ve neredeyse siyah tonlar secildi.
const AID_CATEGORIES = [
  { id: 'ekmek', label: 'Ekmek Yardımı', color: '#d32f2f' },
  { id: 'gida', label: 'Gıda Yardımı', color: '#1976d2' },
  { id: 'haziryemek', label: 'Hazır Yemek', color: '#8e24aa' },
  { id: 'destekpaketi', label: 'Destek Paketi', color: '#111827' },
]

// Kullanici istegi: hem Ekmek hem Gıda yardımını AYNI ANDA alan dosyalar
// haritada AYRI/BELIRGIN bir sekilde gorunsun - bu, digerleri gibi HAM bir
// "category" degeri DEGIL (bir yardim kaydi zaten ya "ekmek" ya "gida"
// turunde geliyor), bu yuzden asagida iki listenin (ekmek alanlar + gida
// alanlar) dosya no KESISIMI hesaplanip TEK bir sentetik nokta uretilir -
// boylece ayni konumda ust uste binen iki ayri nokta yerine, "ikisini de
// alan" acikca ayirt edilebilen TEK bir nokta gosterilir.
const BOTH_EKMEK_GIDA_ID = 'ekmek-gida-ikisi'
const BOTH_EKMEK_GIDA_COLOR = '#00897b'
const categoryColorById = new Map([...AID_CATEGORIES, { id: BOTH_EKMEK_GIDA_ID, label: 'Ekmek + Gıda', color: BOTH_EKMEK_GIDA_COLOR }].map((cat) => [cat.id, cat.color]))

const escapeHtml = (value?: string) => {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const getAddressQuery = (mapData?: MapData) => {
  return [mapData?.address, mapData?.mahalle, 'Sivas', 'Türkiye']
    .filter(Boolean)
    .join(', ')
}

const hasRealCoordinates = (mapData?: MapData) => {
  return typeof mapData?.lat === 'number' && typeof mapData?.lon === 'number'
}

let leafletLoadPromise: Promise<void> | null = null

// Leaflet script/CSS'i SADECE BİR KEZ yuklenir - hem tam sayfa hem widget
// (ikisi de ayni anda render edilebilir, ör. Ana Sayfa'da widget acikken
// baska bir sekmede tam sayfa da acilirsa) AYNI script/link etiketini
// tekrar tekrar eklemez, ayni yukleme Promise'ini paylaşır.
function loadLeaflet(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.L) return Promise.resolve()
  if (leafletLoadPromise) return leafletLoadPromise

  // GUVENLIK: Leaflet artik ucuncu-parti CDN'den (unpkg) DEGIL, uygulamanin
  // kendi sunucusundan yuklenir (public/vendor/leaflet/, surum 1.9.4). Boylece
  // CDN'in ele gecirilmesi/MITM riski ortadan kalkar ve CSP'den unpkg cikar.
  leafletLoadPromise = new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/vendor/leaflet/leaflet.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = '/vendor/leaflet/leaflet.js'
    script.onload = () => resolve()
    document.head.appendChild(script)
  })
  return leafletLoadPromise
}

export function AssistanceDistributionMap({ variant = 'page' }: { variant?: 'page' | 'widget' }) {
  const router = useRouter()
  const [assistances, setAssistances] = useState<AssistanceMapItem[]>([])
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeMessage, setGeocodeMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string>(ALL_CATEGORIES_ID)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markersRef = useRef<LeafletMarker[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let isCancelled = false

    loadLeaflet().then(() => {
      if (isCancelled || mapRef.current) return
      const L = window.L
      const container = mapContainerRef.current
      if (!L || !container) return
      mapRef.current = L.map(container).setView(SIVAS_CENTER, 13)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(mapRef.current)
    })

    return () => { isCancelled = true }
  }, [])

  // Kullanici istegi: Ana Sayfa'daki widget kosede tutulup buyutulup
  // kucultulebiliyor (bkz. DashboardGrid) - Leaflet, KENDI konteynerinin
  // boyutu DEGISTIGINDE bunu otomatik ALGILAMAZ (bilinen bir Leaflet
  // kisitlamasi), harita tam genislik/yukseklige oturmadan yaridan kesik
  // kalir. ResizeObserver ile konteyner boyutu her degistiginde
  // invalidateSize() cagrilarak harita dogru olculere yeniden oturtulur.
  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      mapRef.current?.invalidateSize()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setErrorMessage(null)
      try {
        const response = await fetch('/api/assistance?limit=10000')
        const payload = await response.json() as AssistancePayload
        if (payload.success && payload.data) {
          setAssistances(payload.data)
        } else {
          setErrorMessage(payload.error || 'Veri alınamadı')
        }
      } catch (error: unknown) {
        console.error('Veri yükleme hatası:', error)
        setErrorMessage(error instanceof Error ? error.message : 'Veri alınamadı')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const categorizedStats = useMemo(() => {
    const stats: Record<string, number> = {}
    AID_CATEGORIES.forEach(cat => stats[cat.id] = 0)
    assistances.forEach(item => {
      if (stats[item.category] !== undefined) stats[item.category]++
    })
    return stats
  }, [assistances])

  // Kullanici istegi: hem ekmek hem gida yardimi alan dosyalar - iki listenin
  // (kategori='ekmek' olanlar ile kategori='gida' olanlar) dosya no
  // KESISIMINE bakilip, HER kesisen dosya icin TEK bir sentetik nokta
  // uretilir (koordinat/adres bilgisi hangisinde varsa ondan alinir).
  const bothEkmekGidaRecipients = useMemo(() => {
    const byDosya = new Map<string, { ekmek?: AssistanceMapItem; gida?: AssistanceMapItem }>()
    assistances.forEach((item) => {
      if (item.category !== 'ekmek' && item.category !== 'gida') return
      const dosyaId = item.mapData?.requestId
      if (!dosyaId) return
      const entry = byDosya.get(dosyaId) || {}
      entry[item.category as 'ekmek' | 'gida'] = item
      byDosya.set(dosyaId, entry)
    })

    const combined: AssistanceMapItem[] = []
    byDosya.forEach((entry, dosyaId) => {
      if (!entry.ekmek || !entry.gida) return
      const base = hasRealCoordinates(entry.ekmek.mapData) ? entry.ekmek : entry.gida
      combined.push({
        id: `both-${dosyaId}`,
        applicant: base.applicant,
        category: BOTH_EKMEK_GIDA_ID,
        label: 'Ekmek + Gıda',
        mapData: base.mapData,
      })
    })
    return combined
  }, [assistances])

  // "Tümünü Göster" seçiliyken TÜM kategoriler birlikte (her biri kendi
  // rengiyle) gösterilir; tek bir tür seçiliyken sadece o türe filtrelenir;
  // "Ekmek + Gıda" seçiliyken ise yukarida hesaplanan sentetik kesisim
  // noktalari gösterilir.
  const filteredData = useMemo(() => {
    if (filterType === ALL_CATEGORIES_ID) return assistances
    if (filterType === BOTH_EKMEK_GIDA_ID) return bothEkmekGidaRecipients
    return assistances.filter(item => item.category === filterType)
  }, [assistances, filterType, bothEkmekGidaRecipients])

  const geocodedCount = useMemo(() => {
    return filteredData.reduce((count, item) => {
      return hasRealCoordinates(item.mapData) ? count + 1 : count
    }, 0)
  }, [filteredData])

  useEffect(() => {
    const activeMap = mapRef.current
    if (!activeMap || loading) return
    const L = window.L
    if (!L) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    filteredData.forEach((item) => {
      const mData = item.mapData || {}
      const nhName = mData.mahalle || 'Merkez'
      if (!hasRealCoordinates(mData)) return
      const coords: LatLngTuple = [mData.lat!, mData.lon!]
      const color = categoryColorById.get(item.category) || '#d32f2f'
      const fileId = mData.requestId || ''
      const displayFileNo = formatFileNo(mData.fileNo) || fileId

      const marker = L.circleMarker(coords, {
        radius: 6,
        fillColor: color,
        color: '#FFFFFF',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.95
      })
      .addTo(activeMap)
      .bindPopup(`
        <div style="font-family:sans-serif;font-size:12px;min-width:150px;">
          <b style="color:${color};font-size:14px;">${escapeHtml(item.applicant)}</b><br/>
          <span style="display:inline-block;margin-top:2px;padding:1px 6px;border-radius:9999px;background:${color};color:#fff;font-size:10px;font-weight:700;">${escapeHtml(item.label || item.category)}</span>
          <div style="margin-top:5px;border-top:1px solid #eee;padding-top:5px;">
            ${displayFileNo ? `<b>Dosya No:</b> ${escapeHtml(displayFileNo)}<br/>` : ''}
            <b>Mahalle:</b> ${escapeHtml(nhName)}<br/>
            <b>Adres:</b> ${escapeHtml(mData.address || 'Adres bilgisi yok')}<br/>
            <b>Konum:</b> ${escapeHtml(mData.source || 'Adres koordinatı')} ${mData.score ? `(${mData.score})` : ''}
          </div>
          ${fileId ? `
            <button type="button" class="open-file-link" style="margin-top:8px;width:100%;padding:6px 10px;border:none;border-radius:6px;background:#0076b6;color:#fff;font-weight:700;font-size:11px;cursor:pointer;">
              Dosya Yönetiminde Aç →
            </button>
          ` : ''}
        </div>
      `)
      // Kullanici istegi: popup icindeki "Dosya Yönetiminde Aç" butonuna
      // basinca o dosya /documents sayfasinda acilsin. Popup HTML'i Leaflet
      // tarafindan React'in DISINDA (dogrudan DOM) olusturuldugu icin normal
      // bir React onClick BURAYA baglanamaz - popup her ACILDIGINDA
      // ("popupopen"), o ANKI popup DOM'undaki butona dogrudan bir
      // addEventListener ile tiklama dinleyicisi eklenir.
      if (fileId) {
        marker.on('popupopen', (e) => {
          const button = e.popup.getElement()?.querySelector<HTMLButtonElement>('.open-file-link')
          if (button) {
            button.onclick = () => router.push(`/documents?fileId=${encodeURIComponent(fileId)}`)
          }
        })
      }
      markersRef.current.push(marker)
    })

    centerMapOnMarkers()
  }, [filteredData, loading, filterType])

  // Kullanici istegi: haritayi elle kaydirip/yakinlastirdiktan sonra
  // noktalarin tamami ekrandan cikabiliyor ("harita kayiyor") - bu fonksiyon
  // hem veriler ilk yuklendiginde/degistiginde OTOMATIK, hem de "Haritayı
  // Ortala" butonuna basilinca MANUEL cagrilir: gorunur TUM noktalari
  // kapsayacak sekilde haritayi yeniden ortalayip yakinlastirir. Hic nokta
  // yoksa (ör. filtre sonucu bos) Sivas merkezine doner.
  const centerMapOnMarkers = () => {
    const activeMap = mapRef.current
    const L = window.L
    if (!activeMap || !L) return

    if (markersRef.current.length > 0) {
      const group = L.featureGroup(markersRef.current)
      activeMap.fitBounds(group.getBounds().pad(0.1))
    } else {
      activeMap.setView(SIVAS_CENTER, 13)
    }
  }

  const reloadData = async () => {
    const response = await fetch('/api/assistance?limit=10000')
    const payload = await response.json() as AssistancePayload
    if (payload.success && payload.data) setAssistances(payload.data)
  }

  const handleGeocodeMissing = async () => {
    setGeocoding(true)
    setGeocodeMessage('Koordinatı eksik adresler işleniyor...')
    try {
      const response = await fetch('/api/geocode/beneficiaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 })
      })
      const payload = await response.json() as GeocodeBatchPayload
      if (!payload.success) {
        setGeocodeMessage(payload.error || 'Koordinatlandırma tamamlanamadı.')
        return
      }

      setGeocodeMessage(`${payload.processed || 0} adres işlendi, ${payload.ok || 0} gerçek koordinat kaydedildi.`)
      await reloadData()
    } catch (error) {
      setGeocodeMessage(error instanceof Error ? error.message : 'Koordinatlandırma tamamlanamadı.')
    } finally {
      setGeocoding(false)
    }
  }

  const handleOpenMap = async (row: AssistanceMapItem) => {
    const mData = row.mapData || {}
    const query = getAddressQuery(mData)
    const { getMapUrl } = await import('@/lib/utils')
    const url = await getMapUrl(query)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const totalCount = AID_CATEGORIES.reduce((sum, cat) => sum + (categorizedStats[cat.id] || 0), 0)

  // ONEMLI: Leaflet, kendisine verilen konteyner div'ini KENDI DOM
  // dugumleriyle (tile'lar, kontroller vb.) yonetir - bu div'in icine
  // React'in AYRICA cocuk render etmesi (ör. "yukleniyor" yazisi) React'in
  // sanal DOM'unun Leaflet'in mutasyona ugrattigi GERCEK DOM ile senkronu
  // kaybedip cakismasina (klasik "Leaflet+React" hatasi) yol acabilir. Bu
  // yuzden ref'li div HER ZAMAN bos birakilir; "yukleniyor" katmani onun
  // YANINDA (sibling), sarmalayici relative konteyner uzerinde mutlak
  // konumlandirilir.
  const mapPane = (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full" />
      {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/80 backdrop-blur-sm"><div className="text-slate-500 font-bold">Harita Verileri Hazırlanıyor...</div></div>}
      {!loading && (
        <button
          type="button"
          onClick={centerMapOnMarkers}
          title="Tüm yardım noktalarını haritanın ortasına getirip yakınlaştırır"
          className="absolute right-2 top-2 z-[401] flex items-center gap-1.5 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-black text-slate-700 shadow-md backdrop-blur-sm transition hover:bg-slate-50"
        >
          <span aria-hidden>🎯</span>
          Haritayı Ortala
        </button>
      )}
    </div>
  )

  // Kompakt widget gorunumu (Ana Sayfa) - solda dikey buyuk liste yerine
  // ustte YATAY, kucuk rozet/cip filtre satiri kullanilir ki harita alani
  // dar widget genisliginde bogulmasin; alttaki 200 satirlik "Alan Kisiler"
  // tablosu ve "Koordinatlandir" bakim butonu widget'ta gosterilmez -
  // bunlar zaten tam sayfada (bkz. app/(modules)/assistance/map/page.tsx) var.
  if (variant === 'widget') {
    return (
      // Kullanici istegi (28 Agustos 2026 - mobil): Ana Sayfa'da bu widget
      // MOBILDE sadece baslik olarak geliyordu - kok neden: mobil (dar ekran)
      // yerlesiminde DashboardGrid kutulara piksel yukseklik VERMEZ, bu kutu
      // da "h-full" (=0) oldugu icin harita alani cokuyordu. "min-h-[460px]"
      // ile mobilde de gercek bir yukseklik alir; masaustu izgarada kutu zaten
      // daha buyuk oldugu icin "h-full" gecerli kalir, min-h zararsizdir.
      <div className="flex h-full min-h-[460px] flex-col overflow-hidden rounded-2xl border border-white bg-white shadow-md ring-1 ring-slate-100 min-[900px]:min-h-0">
        <div className="dashboard-drag-handle flex shrink-0 items-center gap-2 bg-gradient-to-r from-[#d32f2f] via-[#e53935] to-[#ff5252] px-3 py-2 text-white">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15 text-sm ring-1 ring-white/30">🗺️</span>
          <div className="min-w-0">
            <h3 className="truncate text-xs font-black leading-tight">Yardım Haritası</h3>
            <p className="truncate text-[10px] font-semibold text-white/85">{totalCount} aktif yardım - il geneli</p>
          </div>
        </div>

        {errorMessage && (
          <div className="shrink-0 px-3 py-1.5 text-[11px] font-bold text-red-600">Hata: {errorMessage}</div>
        )}

        <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setFilterType(ALL_CATEGORIES_ID)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-black transition-colors ${filterType === ALL_CATEGORIES_ID ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'}`}
          >
            🎯 Tümü ({totalCount})
          </button>
          {AID_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilterType(cat.id)}
              className="rounded-full px-2 py-0.5 text-[10px] font-black text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: cat.color, opacity: filterType === cat.id ? 1 : 0.55 }}
            >
              {cat.label} ({categorizedStats[cat.id] || 0})
            </button>
          ))}
          {bothEkmekGidaRecipients.length > 0 && (
            <button
              type="button"
              onClick={() => setFilterType(BOTH_EKMEK_GIDA_ID)}
              title="Hem Ekmek hem Gıda yardımını aynı anda alan dosyalar"
              className="rounded-full px-2 py-0.5 text-[10px] font-black text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: BOTH_EKMEK_GIDA_COLOR, opacity: filterType === BOTH_EKMEK_GIDA_ID ? 1 : 0.55 }}
            >
              Ekmek + Gıda ({bothEkmekGidaRecipients.length})
            </button>
          )}
        </div>

        <div className="relative min-h-[320px] flex-1 min-[900px]:min-h-0">
          {mapPane}
          {!loading && !geocoding && filteredData.length > 0 && geocodedCount === 0 && (
            <div className="absolute inset-x-2 top-2 z-10 rounded border border-amber-200 bg-amber-50/95 px-2 py-1.5 text-[10px] font-bold text-amber-800 shadow-sm">
              Bu türde henüz haritalanmış konum yok - tam sayfa haritadan &quot;Koordinatlandır&quot;a basabilirsiniz.
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-96px)] flex-col space-y-3">
      <div className="flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border border-white bg-gradient-to-r from-[#d32f2f] via-[#e53935] to-[#ff5252] px-4 py-2.5 text-white shadow-[0_10px_28px_rgba(211,47,47,0.18)] ring-1 ring-slate-200">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-lg ring-1 ring-white/30">🗺️</div>
        <div className="min-w-0">
          <h1 className="text-base font-black leading-tight">Yardım Dağılım Haritası</h1>
          <p className="truncate text-[11px] font-semibold text-white/85">
            İl genelinde, şu an aktif olarak yardım almakta olan tüm dosyaların konumları - türüne göre renklendirilmiş.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="shrink-0 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-600">
          Hata: {errorMessage}
        </div>
      )}

      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="w-80 flex flex-col gap-4 overflow-hidden">
          <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm overflow-hidden flex flex-col">
            <h3 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">Aktif Yardım Türleri</h3>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {loading ? <div className="text-center py-10 text-slate-400 font-bold">Yükleniyor...</div> : (
                <>
                  <button
                    onClick={() => setFilterType(ALL_CATEGORIES_ID)}
                    className={`w-full flex items-center justify-between rounded-lg p-4 border-2 transition-all ${filterType === ALL_CATEGORIES_ID ? 'bg-slate-900 border-slate-900 text-white shadow-md' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-400'}`}
                  >
                    <span className="text-[15px] font-black">🎯 Tümünü Göster</span>
                    <span className={`text-xs font-black px-2.5 py-1 rounded-full ${filterType === ALL_CATEGORIES_ID ? 'bg-white/20 text-white' : 'bg-white border border-slate-200'}`}>
                      {totalCount}
                    </span>
                  </button>
                  <div className="my-1 border-t border-dashed border-slate-200" />
                  {AID_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setFilterType(cat.id)}
                      style={filterType === cat.id ? { borderColor: cat.color, boxShadow: `0 0 0 1px ${cat.color}33` } : undefined}
                      className={`w-full flex items-center justify-between rounded-lg p-4 border-2 transition-all ${filterType === cat.id ? 'bg-slate-50 shadow-md' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-300'}`}
                    >
                      <span className="flex items-center gap-2 text-[15px] font-black" style={filterType === cat.id ? { color: cat.color } : undefined}>
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
                        {cat.label}
                      </span>
                      <span className="text-xs font-black px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: cat.color }}>{categorizedStats[cat.id] || 0}</span>
                    </button>
                  ))}
                  {bothEkmekGidaRecipients.length > 0 && (
                    <>
                      <div className="my-1 border-t border-dashed border-slate-200" />
                      <button
                        onClick={() => setFilterType(BOTH_EKMEK_GIDA_ID)}
                        title="Hem Ekmek hem Gıda yardımını aynı anda alan dosyalar"
                        style={filterType === BOTH_EKMEK_GIDA_ID ? { borderColor: BOTH_EKMEK_GIDA_COLOR, boxShadow: `0 0 0 1px ${BOTH_EKMEK_GIDA_COLOR}33` } : undefined}
                        className={`w-full flex items-center justify-between rounded-lg p-4 border-2 transition-all ${filterType === BOTH_EKMEK_GIDA_ID ? 'bg-slate-50 shadow-md' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-300'}`}
                      >
                        <span className="flex items-center gap-2 text-[15px] font-black" style={filterType === BOTH_EKMEK_GIDA_ID ? { color: BOTH_EKMEK_GIDA_COLOR } : undefined}>
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: BOTH_EKMEK_GIDA_COLOR }} />
                          Ekmek + Gıda (İkisini de Alan)
                        </span>
                        <span className="text-xs font-black px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: BOTH_EKMEK_GIDA_COLOR }}>{bothEkmekGidaRecipients.length}</span>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          <div className="flex-1 relative rounded-xl border-2 border-slate-200 shadow-inner overflow-hidden z-0">
             {mapPane}
             {!loading && geocoding && <div className="absolute left-3 top-3 z-10 rounded border border-red-100 bg-white/95 px-3 py-1.5 text-[11px] font-black text-red-700 shadow-sm">Adres koordinatları kaydediliyor...</div>}
             {!loading && geocodeMessage && <div className="absolute left-3 top-12 z-10 max-w-sm rounded border border-amber-200 bg-amber-50/95 px-3 py-2 text-[11px] font-bold text-amber-800 shadow-sm">{geocodeMessage}</div>}
             {!loading && !geocoding && filteredData.length > 0 && geocodedCount === 0 && <div className="absolute inset-x-3 top-3 z-10 rounded border border-amber-200 bg-amber-50/95 px-3 py-2 text-[12px] font-bold text-amber-800 shadow-sm">Kayıt var, fakat henüz veritabanına kaydedilmiş gerçek koordinat yok - &quot;Koordinatlandır&quot;a basarak işleyebilirsiniz.</div>}
          </div>

          <div className="h-52 shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
            <div className="bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">
                {filterType === ALL_CATEGORIES_ID
                  ? 'Tüm Yardım Türlerini'
                  : filterType === BOTH_EKMEK_GIDA_ID
                    ? 'Ekmek + Gıda (İkisini de)'
                    : AID_CATEGORIES.find(c => c.id === filterType)?.label} Alan Kişiler
              </h3>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleGeocodeMissing} disabled={geocoding} className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60">Koordinatlandır</button>
                <span className="text-[11px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-300">{geocodedCount}/{filteredData.length} Haritada</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-white border-b border-slate-100 text-slate-400 uppercase font-black text-[10px] z-10">
                  <tr>
                    {filterType === ALL_CATEGORIES_ID && <th className="px-4 py-2">Tür</th>}
                    <th className="px-4 py-2">Müracaatçı</th>
                    <th className="px-4 py-2">Mahalle</th>
                    <th className="px-4 py-2">Güncel Adres</th>
                    <th className="px-4 py-2 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 font-bold text-slate-700">
                  {filteredData.slice(0, 200).map((row) => {
                    const color = categoryColorById.get(row.category) || '#64748b'
                    return (
                      <tr key={row.id} className="transition-colors hover:bg-slate-50">
                        {filterType === ALL_CATEGORIES_ID && (
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-black text-white" style={{ backgroundColor: color }}>
                              {row.label || row.category}
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-2 text-slate-900">{row.applicant}</td>
                        <td className="px-4 py-2">{row.mapData?.mahalle || '-'}</td>
                        <td className="px-4 py-2 truncate max-w-[250px]">{row.mapData?.address || 'Adres yok'}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => handleOpenMap(row)} className="font-black text-slate-600 underline decoration-dotted hover:text-slate-900">Haritada Aç</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
