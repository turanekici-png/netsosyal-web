'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { formatFileNo } from '@/lib/utils'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

type GuncellemeRow = {
  id: string
  dosyaid: string | null
  dosyaNo: string | null
  dosyaSahibi: string | null
  telefon: string | null
  adres: string | null
  islemYapan: string | null
  formTarihi: string | null
  sonuc: string | null
  aciklama: string | null
  islemtarihi: string | null
}

type OnIncelemeRow = {
  id: string
  dosyaid: string | null
  dosyaNo: string | null
  dosyaSahibi: string | null
  telefon: string | null
  adres: string | null
  islemYapan: string | null
  tarih: string | null
  sonuc: string | null
  aciklama: string | null
  islemtarihi: string | null
}

type IncelemeRow = {
  id: string
  dosyaid: string | null
  dosyaNo: string | null
  dosyaSahibi: string | null
  telefon: string | null
  adres: string | null
  islemYapan: string | null
  formTarihi: string | null
  adSoyad: string | null
  toplamPuan: number | null
  otomatikSonuc: string | null
  komisyonKarari: string | null
  inceleyenAdSoyad: string | null
  islemtarihi: string | null
}

type SummaryData = {
  totals: { guncelleme: number; onInceleme: number; inceleme: number; all: number }
  bySonuc: Array<{ type: string; sonuc: string; count: number }>
}

// "Sonuç Özeti" sekmesindeki detay tablosu icin: her form turunden gelen
// satirlari TEK bir listede birlestirir - hangi dosyada, kim tarafindan,
// ne sonuçla islem yapildigini tek yerden gorebilmek icin.
// Kullanici istegi (13 Eylul 2026): "herhangi bir ön inceleme yada tahkikat
// gibi bir rapor düzenlenebilsin yada silinebilsin yada iptal edilebilsin" -
// hangi API'nin cagrilacagini bilmek icin her birlesik satirin gercek
// kaynak turu ve HAM (prefiksiz) id'si de tasiniyor.
type ReportSourceType = 'guncelleme' | 'onInceleme' | 'inceleme'

type CombinedRow = {
  id: string
  rawId: string
  sourceType: ReportSourceType
  formTuru: string
  tarih: string | null
  dosyaid: string | null
  dosyaNo: string | null
  dosyaSahibi: string | null
  telefon: string | null
  adres: string | null
  sonuc: string | null
  islemYapan: string | null
}

type TabId = 'guncelleme' | 'onInceleme' | 'inceleme' | 'summary' | 'grouped'

const TABS: Array<{ id: TabId; label: string; accent: 'indigo' | 'amber' | 'teal' | 'violet' }> = [
  { id: 'grouped', label: 'Dosyaya Göre Gruplu', accent: 'violet' },
  { id: 'guncelleme', label: 'Sonuç Bekleyen Raporları', accent: 'indigo' },
  { id: 'onInceleme', label: 'Ön İnceleme Formları', accent: 'amber' },
  { id: 'inceleme', label: 'Tahkikat Formları', accent: 'teal' },
  { id: 'summary', label: 'Sonuç Özeti', accent: 'violet' },
]

const TAB_ACCENT_CLASSES: Record<'indigo' | 'amber' | 'teal' | 'violet', { active: string; inactive: string; head: string; row: string; gradient: string; border: string }> = {
  indigo: { active: 'border-indigo-600 bg-indigo-600 text-white', inactive: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100', head: 'bg-indigo-50 text-indigo-700', row: 'hover:bg-indigo-50/50', gradient: 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-indigo-400', border: 'border-indigo-200' },
  amber: { active: 'border-amber-600 bg-amber-600 text-white', inactive: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100', head: 'bg-amber-50 text-amber-700', row: 'hover:bg-amber-50/50', gradient: 'bg-gradient-to-r from-amber-600 via-amber-500 to-amber-400', border: 'border-amber-200' },
  teal: { active: 'border-teal-600 bg-teal-600 text-white', inactive: 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100', head: 'bg-teal-50 text-teal-700', row: 'hover:bg-teal-50/50', gradient: 'bg-gradient-to-r from-teal-600 via-teal-500 to-teal-400', border: 'border-teal-200' },
  violet: { active: 'border-violet-600 bg-violet-600 text-white', inactive: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100', head: 'bg-violet-50 text-violet-700', row: 'hover:bg-violet-50/50', gradient: 'bg-gradient-to-r from-violet-600 via-violet-500 to-indigo-500', border: 'border-violet-200' },
}

function normalizeTr(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
}

function sonucBadgeClass(sonuc: string) {
  const normalized = normalizeTr(sonuc)
  if (normalized.includes('uygun degil') || normalized.includes('iptal') || normalized.includes('yardim yapilamaz')) return 'bg-rose-600'
  if (!normalized || normalized === 'belirtilmemis') return 'bg-slate-400'
  return 'bg-emerald-600'
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('tr-TR')
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isoDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Her sekmedeki tablo aynı "sütun başlığına tıkla → sırala, başlığın
// altındaki kutuya yaz → filtrele" davranışını paylaşır. Veri zaten
// istemciye tam olarak (tarih aralığına göre, en fazla 1000 satır) çekildiği
// için sıralama/filtreleme sunucuya gitmeden, tarayıcıda çalışır.
type ColumnDef<T> = {
  key: string
  label: string
  align?: 'left' | 'right'
  filterText: (row: T) => string
  sortValue?: (row: T) => string | number
  render: (row: T) => ReactNode
  headClassName?: string
}

function useSortableFilterableRows<T>(rows: T[], columns: ColumnDef<T>[]) {
  // Filtre/siralama durumu bilerek sekme basina AYRI bir React state'i olarak
  // yasiyor: her sekme kendi <DataTable> ornegini sadece o sekme aktifken
  // mount ediyor (asagida `{activeTab === 'guncelleme' && <DataTable ... />}`
  // deseni) - sekme degisince eski tablo tamamen unmount olup yenisi sifir
  // durumla mount oluyor. Ayrica bir "sekme degisince sifirla" efektine
  // gerek yok; boyle bir efekt (columns her render'da yeni bir dizi
  // referansi aldigi icin) kullanici filtre kutusuna her harf yazdiginda
  // yanlislikla filtreyi sifirlardi.
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, value]) => value.trim() !== '')
    if (activeFilters.length === 0) return rows

    return rows.filter((row) => activeFilters.every(([key, value]) => {
      const column = columns.find((col) => col.key === key)
      if (!column) return true
      return normalizeTr(column.filterText(row)).includes(normalizeTr(value.trim()))
    }))
  }, [rows, filters, columns])

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows
    const column = columns.find((col) => col.key === sortKey)
    if (!column) return filteredRows

    const getValue = column.sortValue || column.filterText
    const result = [...filteredRows].sort((a, b) => {
      const av = getValue(a)
      const bv = getValue(b)
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv), 'tr-TR')
    })
    if (sortDir === 'desc') result.reverse()
    return result
  }, [filteredRows, sortKey, sortDir, columns])

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return }
    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  }

  return { rows: sortedRows, filters, setFilters, sortKey, sortDir, toggleSort }
}

function DataTable<T extends { id: string }>({
  rows, columns, accent, emptyMessage, minWidth, title, description,
}: {
  rows: T[]
  columns: ColumnDef<T>[]
  accent: 'indigo' | 'amber' | 'teal' | 'violet'
  emptyMessage: string
  minWidth: number
  title?: string
  description?: string
}) {
  const { rows: visibleRows, filters, setFilters, sortKey, sortDir, toggleSort } = useSortableFilterableRows(rows, columns)
  const accentClasses = TAB_ACCENT_CLASSES[accent]
  const activeFilterCount = Object.values(filters).filter((value) => value.trim() !== '').length

  return (
    <div className={`overflow-hidden rounded-xl border shadow-sm ${accentClasses.border}`}>
      {title && (
        <div className={`flex flex-col gap-1 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between ${accentClasses.gradient}`}>
          <div className="min-w-0">
            <h2 className="text-sm font-black uppercase tracking-wide text-white">{title}</h2>
            {description && <p className="mt-0.5 text-xs font-semibold text-white/85">{description}</p>}
          </div>
          <span className="inline-flex w-fit items-center justify-center rounded-full border border-white/40 bg-white/15 px-3 py-1 text-xs font-black text-white">
            {visibleRows.length.toLocaleString('tr-TR')} kayıt
          </span>
        </div>
      )}
      <div className={`flex items-center justify-between border-b bg-slate-50/80 px-4 py-2 ${accentClasses.border}`}>
        <p className="text-[11px] font-semibold text-slate-500">Başlığa tıklayarak sırala, kutuya yazarak filtrele.</p>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-600 hover:bg-rose-100"
            >
              Filtreleri temizle ({activeFilterCount})
            </button>
          )}
          {!title && (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{visibleRows.length.toLocaleString('tr-TR')} kayıt</span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" style={{ minWidth }}>
          <thead className={`text-[11px] font-black uppercase ${accentClasses.head}`}>
            <tr className={`border-b ${accentClasses.border}`}>
              {columns.map((column) => (
                <th key={column.key} className={`px-4 py-3 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className={`inline-flex items-center gap-1.5 transition-colors hover:opacity-70 ${sortKey === column.key ? 'text-slate-950' : ''}`}
                  >
                    {column.label}
                    <span className={`text-[10px] ${sortKey === column.key ? 'opacity-100' : 'opacity-40'}`}>{sortKey === column.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                  </button>
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((column) => (
                <th key={`${column.key}-filter`} className="bg-white px-3 py-2">
                  <input
                    value={filters[column.key] || ''}
                    onChange={(event) => setFilters((prev) => ({ ...prev, [column.key]: event.target.value }))}
                    placeholder="Filtrele..."
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 normal-case outline-none focus:border-[#0076b6] focus:bg-white"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.length > 0 ? visibleRows.map((row) => (
              <tr key={row.id} className={`odd:bg-white even:bg-slate-50/60 transition-colors ${accentClasses.row}`}>
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-3.5 align-top ${column.align === 'right' ? 'text-right' : ''}`}>{column.render(row)}</td>
                ))}
              </tr>
            )) : (
              <tr><td colSpan={columns.length} className="px-4 py-14 text-center">
                <p className="text-sm font-black text-slate-500">{emptyMessage}</p>
                <p className="mt-1 text-xs font-semibold text-slate-400">Tarih aralığını veya filtreleri değiştirerek tekrar deneyin.</p>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Kullanici istegi (13 Eylul 2026): "tüm yapılan ön inceleme, tahkikat ve
// sonuç bekleyen raporları GRUPLAR HALİNDE görünsün" - dosyaya gore
// gruplanmis, her dosya icin acilir/kapanir (native <details>) bir bolum,
// icinde o dosyanin TUM raporlarini (turu ne olursa olsun) tarihe gore en
// yeniden eskiye siralar ve her satirda Düzenle/İptal Et/Sil aksiyonlarini
// gosterir.
function GroupedByFileView({ rows, onOpenFile, onEdit, onCancel, onDelete, formTuruBadgeClass, sonucBadgeClass }: {
  rows: CombinedRow[]
  onOpenFile: (dosyaid: string | null, dosyaNo: string | null) => void
  onEdit: (row: CombinedRow) => void
  onCancel: (row: CombinedRow) => void
  onDelete: (row: CombinedRow) => void
  formTuruBadgeClass: Record<ReportSourceType, string>
  sonucBadgeClass: (sonuc: string) => string
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { dosyaid: string | null; dosyaNo: string | null; dosyaSahibi: string | null; rows: CombinedRow[] }>()
    for (const row of rows) {
      const key = row.dosyaid || row.dosyaNo || `bilinmiyor-${row.id}`
      const existing = map.get(key)
      if (existing) {
        existing.rows.push(row)
        if (!existing.dosyaSahibi && row.dosyaSahibi) existing.dosyaSahibi = row.dosyaSahibi
      } else {
        map.set(key, { dosyaid: row.dosyaid, dosyaNo: row.dosyaNo, dosyaSahibi: row.dosyaSahibi, rows: [row] })
      }
    }
    return [...map.values()]
      .map((group) => ({ ...group, rows: [...group.rows].sort((a, b) => (b.tarih || '').localeCompare(a.tarih || '')) }))
      .sort((a, b) => (b.rows[0]?.tarih || '').localeCompare(a.rows[0]?.tarih || ''))
  }, [rows])

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500 shadow-sm">
        Seçilen aralıkta kayıt bulunamadı.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-700">
        {groups.length.toLocaleString('tr-TR')} dosya, toplam {rows.length.toLocaleString('tr-TR')} rapor
      </div>
      {groups.map((group) => (
        <details key={group.dosyaid || group.dosyaNo || group.rows[0].id} className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-gradient-to-r from-violet-600 via-violet-500 to-indigo-500 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={(event) => { event.preventDefault(); onOpenFile(group.dosyaid, group.dosyaNo) }}
                className="shrink-0 rounded-full border border-white/50 bg-white/15 px-3 py-1 text-xs font-black hover:bg-white/25"
              >
                {formatFileNo(group.dosyaNo) || `#${group.dosyaid}`}
              </button>
              <span className="truncate text-sm font-black">{group.dosyaSahibi || 'Ad Soyad Belirtilmemiş'}</span>
            </div>
            <span className="shrink-0 rounded-full border border-white/40 bg-white/15 px-3 py-1 text-[11px] font-black">
              {group.rows.length} rapor
            </span>
          </summary>
          <div className="divide-y divide-slate-100">
            {group.rows.map((row) => (
              <div key={row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${formTuruBadgeClass[row.sourceType]}`}>{row.formTuru}</span>
                  <span className="text-xs font-bold text-slate-500">{formatDate(row.tarih)}</span>
                  {row.sonuc && <span className={`rounded-full px-2.5 py-1 text-[11px] font-black text-white ${sonucBadgeClass(row.sonuc)}`}>{row.sonuc}</span>}
                  {row.islemYapan && <span className="text-xs font-semibold text-slate-500">İşlemi yapan: {row.islemYapan}</span>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {row.sourceType === 'inceleme' ? (
                    <button type="button" onClick={() => onCancel(row)} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase text-amber-700 hover:bg-amber-100">İptal Et</button>
                  ) : (
                    <button type="button" onClick={() => onEdit(row)} className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-black uppercase text-sky-700 hover:bg-sky-100">Düzenle</button>
                  )}
                  <button type="button" onClick={() => onDelete(row)} className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black uppercase text-rose-700 hover:bg-rose-100">Sil</button>
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

export default function WorkflowSonucPage() {
  const { addTab } = useTabs()
  const [activeTab, setActiveTab] = useState<TabId>('grouped')
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(30))
  const [dateTo, setDateTo] = useState(todayIso())
  const [search, setSearch] = useState('')

  const [guncelleme, setGuncelleme] = useState<GuncellemeRow[]>([])
  const [onInceleme, setOnInceleme] = useState<OnIncelemeRow[]>([])
  const [inceleme, setInceleme] = useState<IncelemeRow[]>([])
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setError('')

    const query = new URLSearchParams()
    if (dateFrom) query.set('dateFrom', dateFrom)
    if (dateTo) query.set('dateTo', dateTo)
    if (search.trim()) query.set('search', search.trim())

    Promise.all([
      fetch(`/api/workflow/sonuc-raporu?type=guncelleme&${query.toString()}`, { signal: controller.signal, cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/workflow/sonuc-raporu?type=on-inceleme&${query.toString()}`, { signal: controller.signal, cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/workflow/sonuc-raporu?type=inceleme&${query.toString()}`, { signal: controller.signal, cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/workflow/sonuc-raporu?type=summary&${query.toString()}`, { signal: controller.signal, cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([g, o, i, s]) => {
        if (!g.success || !o.success || !i.success || !s.success) {
          throw new Error(g.error || o.error || i.error || s.error || 'Rapor alınamadı.')
        }
        setGuncelleme(g.data)
        setOnInceleme(o.data)
        setInceleme(i.data)
        setSummary(s.data)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Rapor alınamadı.')
      })
      .finally(() => setIsLoading(false))

    return () => controller.abort()
  }, [dateFrom, dateTo, search])

  const tabCounts = useMemo(() => ({
    guncelleme: guncelleme.length,
    onInceleme: onInceleme.length,
    inceleme: inceleme.length,
    summary: summary?.totals.all ?? 0,
    grouped: guncelleme.length + onInceleme.length + inceleme.length,
  }), [guncelleme, onInceleme, inceleme, summary])

  // Kullanici istegi (13 Eylul 2026): "silinebilsin yada iptal edilebilsin" -
  // her rapor turunun GERCEKTEN sahip oldugu backend islemine baglanir:
  // Ön İnceleme -> DELETE (on_inceleme_raporlari), Tahkikat -> DELETE
  // (inceleme_degerlendirme_formu) VEYA "İptal Et" (onay_durumu='reddedildi'
  // PATCH'i - zaten var olan onay mekanizmasi), Sonuç Bekleyen/Komisyon
  // Raporu (tahkikatraporlari, Prisma "Report") -> DELETE (/api/reports/[id],
  // zaten var olan CRUD).
  const [actionError, setActionError] = useState('')

  const deleteGuncelleme = async (id: string) => {
    if (!(await confirmDialog('Bu Sonuç Bekleyen raporunu silmek istediğinize emin misiniz?'))) return
    setActionError('')
    try {
      const response = await fetch(`/api/reports/${id}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Rapor silinemedi.')
      setGuncelleme((rows) => rows.filter((row) => row.id !== id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Rapor silinemedi.')
    }
  }

  const deleteOnInceleme = async (id: string) => {
    if (!(await confirmDialog('Bu Ön İnceleme raporunu silmek istediğinize emin misiniz?'))) return
    setActionError('')
    try {
      const response = await fetch(`/api/workflow/on-inceleme/report?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Rapor silinemedi.')
      setOnInceleme((rows) => rows.filter((row) => row.id !== id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Rapor silinemedi.')
    }
  }

  const deleteInceleme = async (id: string) => {
    if (!(await confirmDialog('Bu Tahkikat Formu kaydını silmek istediğinize emin misiniz?'))) return
    setActionError('')
    try {
      const response = await fetch(`/api/documents/inceleme-degerlendirme/${id}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Form silinemedi.')
      setInceleme((rows) => rows.filter((row) => row.id !== id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Form silinemedi.')
    }
  }

  const cancelInceleme = async (id: string) => {
    if (!(await confirmDialog('Bu Tahkikat Formu kaydını iptal edip "Reddedildi" olarak işaretlemek istediğinize emin misiniz?'))) return
    setActionError('')
    try {
      const response = await fetch(`/api/documents/inceleme-degerlendirme/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onayDurumu: 'reddedildi' }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'İptal edilemedi.')
      setInceleme((rows) => rows.map((row) => (row.id === id ? { ...row, komisyonKarari: 'Reddedildi' } : row)))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'İptal edilemedi.')
    }
  }

  const deleteBySourceType = (row: { sourceType: ReportSourceType; rawId: string }) => {
    if (row.sourceType === 'guncelleme') return deleteGuncelleme(row.rawId)
    if (row.sourceType === 'onInceleme') return deleteOnInceleme(row.rawId)
    return deleteInceleme(row.rawId)
  }

  const openDosya = (dosyaid: string | null, dosyaNo: string | null) => {
    if (!dosyaid) return
    addTab({ title: dosyaNo ? `Dosya ${formatFileNo(dosyaNo)}` : 'Dosya', path: `/documents?fileId=${dosyaid}` })
  }

  // Kullanici istegi (13 Eylul 2026): "düzenlenebilsin" - Ön İnceleme (PATCH
  // /api/workflow/on-inceleme/report: tarih/aciklama) ve Sonuç Bekleyen/
  // Komisyon Raporu (PUT /api/reports/[id]: date/title/content) zaten icerik
  // guncelleyebilen bir API'ye sahip - bu ikisi icin ayni kucuk duzenleme
  // modalini kullaniyoruz. Tahkikat Formu'nun (inceleme_degerlendirme_formu)
  // ise sadece onay_durumu guncellenebiliyor (bkz. yukaridaki cancelInceleme) -
  // tum cevaplarini yeniden acip duzenleyen ayri bir rota yok.
  const [editTarget, setEditTarget] = useState<{ type: 'onInceleme' | 'guncelleme'; id: string; dosyaNo: string | null } | null>(null)
  const [editForm, setEditForm] = useState({ tarih: '', konu: '', metin: '' })
  const [editStatus, setEditStatus] = useState<'idle' | 'saving'>('idle')
  const [editError, setEditError] = useState('')

  const openEditOnInceleme = (row: OnIncelemeRow) => {
    setEditTarget({ type: 'onInceleme', id: row.id, dosyaNo: row.dosyaNo })
    setEditForm({ tarih: (row.tarih || '').slice(0, 10), konu: '', metin: row.aciklama || '' })
    setEditError('')
  }

  const openEditGuncelleme = (row: GuncellemeRow) => {
    setEditTarget({ type: 'guncelleme', id: row.id, dosyaNo: row.dosyaNo })
    setEditForm({ tarih: (row.formTarihi || '').slice(0, 10), konu: row.sonuc || '', metin: row.aciklama || '' })
    setEditError('')
  }

  const closeEditModal = () => {
    if (editStatus === 'saving') return
    setEditTarget(null)
    setEditError('')
  }

  const saveEdit = async () => {
    if (!editTarget) return
    setEditStatus('saving')
    setEditError('')
    try {
      if (editTarget.type === 'onInceleme') {
        const response = await fetch('/api/workflow/on-inceleme/report', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editTarget.id, date: editForm.tarih, aciklama: editForm.metin }),
        })
        const payload = await response.json()
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Rapor güncellenemedi.')
        setOnInceleme((rows) => rows.map((row) => (row.id === editTarget.id ? { ...row, tarih: editForm.tarih, aciklama: editForm.metin } : row)))
      } else {
        if (!editForm.konu.trim() || !editForm.metin.trim()) {
          throw new Error('Konu ve rapor alanları zorunludur.')
        }
        const response = await fetch(`/api/reports/${editTarget.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: editForm.tarih ? new Date(editForm.tarih) : undefined, title: editForm.konu, content: editForm.metin }),
        })
        const payload = await response.json()
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Rapor güncellenemedi.')
        setGuncelleme((rows) => rows.map((row) => (row.id === editTarget.id ? { ...row, formTarihi: editForm.tarih, sonuc: editForm.konu, aciklama: editForm.metin } : row)))
      }
      setEditTarget(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Rapor güncellenemedi.')
    } finally {
      setEditStatus('idle')
    }
  }

  const dosyaNoCell = (dosyaid: string | null, dosyaNo: string | null, tone: 'indigo' | 'amber' | 'teal') => {
    const toneClasses = { indigo: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100', amber: 'bg-amber-50 text-amber-700 hover:bg-amber-100', teal: 'bg-teal-50 text-teal-700 hover:bg-teal-100' }
    return (
      <button type="button" onClick={() => openDosya(dosyaid, dosyaNo)} className={`rounded-full px-2.5 py-1 text-xs font-black ${toneClasses[tone]}`}>
        {formatFileNo(dosyaNo) || `#${dosyaid}`}
      </button>
    )
  }

  const sonucCell = (sonuc: string | null) => (
    sonuc ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-black text-white ${sonucBadgeClass(sonuc)}`}>{sonuc}</span> : <span className="text-xs text-slate-400">-</span>
  )

  // Kullanici istegi (13 Eylul 2026): "düzenlenebilsin yada silinebilsin
  // yada iptal edilebilsin" - her tabloda bir "İşlem" sutunu.
  const actionButtonClass = 'rounded-md border px-2 py-1 text-[10px] font-black uppercase shadow-sm transition'

  const guncellemeColumns: ColumnDef<GuncellemeRow>[] = [
    { key: 'formTarihi', label: 'Tarih', filterText: (r) => formatDate(r.formTarihi), sortValue: (r) => r.formTarihi || '', render: (r) => <span className="whitespace-nowrap text-xs font-bold text-slate-500">{formatDate(r.formTarihi)}</span> },
    { key: 'dosyaNo', label: 'Dosya No', filterText: (r) => r.dosyaNo || '', render: (r) => dosyaNoCell(r.dosyaid, r.dosyaNo, 'indigo') },
    { key: 'dosyaSahibi', label: 'Dosya Sahibi', filterText: (r) => r.dosyaSahibi || '', render: (r) => <span className="text-xs font-bold text-slate-700">{r.dosyaSahibi || '-'}</span> },
    { key: 'telefon', label: 'Telefon', filterText: (r) => r.telefon || '', render: (r) => <span className="text-xs font-semibold text-slate-600">{r.telefon || '-'}</span> },
    { key: 'adres', label: 'Adres', filterText: (r) => r.adres || '', render: (r) => <span className="block max-w-[220px] truncate text-xs font-semibold text-slate-600" title={r.adres || ''}>{r.adres || '-'}</span> },
    { key: 'sonuc', label: 'Sonuç', filterText: (r) => r.sonuc || '', render: (r) => sonucCell(r.sonuc) },
    { key: 'aciklama', label: 'Açıklama', filterText: (r) => r.aciklama || '', render: (r) => <span className="block max-w-md text-xs font-semibold leading-5 text-slate-600">{r.aciklama || '-'}</span> },
    { key: 'islemYapan', label: 'İşlemi Yapan', filterText: (r) => r.islemYapan || '', render: (r) => <span className="text-xs font-bold text-slate-700">{r.islemYapan || '-'}</span> },
    { key: 'islemtarihi', label: 'İşlem Zamanı', filterText: (r) => formatDateTime(r.islemtarihi), sortValue: (r) => r.islemtarihi || '', render: (r) => <span className="whitespace-nowrap text-xs font-bold text-slate-400">{formatDateTime(r.islemtarihi)}</span> },
    { key: 'action', label: 'İşlem', filterText: () => '', render: (r) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => openEditGuncelleme(r)} className={`${actionButtonClass} border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}>Düzenle</button>
        <button type="button" onClick={() => void deleteGuncelleme(r.id)} className={`${actionButtonClass} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}>Sil</button>
      </div>
    ) },
  ]

  const onIncelemeColumns: ColumnDef<OnIncelemeRow>[] = [
    { key: 'tarih', label: 'Tarih', filterText: (r) => formatDate(r.tarih), sortValue: (r) => r.tarih || '', render: (r) => <span className="whitespace-nowrap text-xs font-bold text-slate-500">{formatDate(r.tarih)}</span> },
    { key: 'dosyaNo', label: 'Dosya No', filterText: (r) => r.dosyaNo || '', render: (r) => dosyaNoCell(r.dosyaid, r.dosyaNo, 'amber') },
    { key: 'dosyaSahibi', label: 'Dosya Sahibi', filterText: (r) => r.dosyaSahibi || '', render: (r) => <span className="text-xs font-bold text-slate-700">{r.dosyaSahibi || '-'}</span> },
    { key: 'telefon', label: 'Telefon', filterText: (r) => r.telefon || '', render: (r) => <span className="text-xs font-semibold text-slate-600">{r.telefon || '-'}</span> },
    { key: 'adres', label: 'Adres', filterText: (r) => r.adres || '', render: (r) => <span className="block max-w-[220px] truncate text-xs font-semibold text-slate-600" title={r.adres || ''}>{r.adres || '-'}</span> },
    { key: 'sonuc', label: 'Sonuç', filterText: (r) => r.sonuc || '', render: (r) => sonucCell(r.sonuc) },
    { key: 'aciklama', label: 'Açıklama', filterText: (r) => r.aciklama || '', render: (r) => <span className="block max-w-md text-xs font-semibold leading-5 text-slate-600">{r.aciklama || '-'}</span> },
    { key: 'islemYapan', label: 'İşlemi Yapan', filterText: (r) => r.islemYapan || '', render: (r) => <span className="text-xs font-bold text-slate-700">{r.islemYapan || '-'}</span> },
    { key: 'islemtarihi', label: 'İşlem Zamanı', filterText: (r) => formatDateTime(r.islemtarihi), sortValue: (r) => r.islemtarihi || '', render: (r) => <span className="whitespace-nowrap text-xs font-bold text-slate-400">{formatDateTime(r.islemtarihi)}</span> },
    { key: 'action', label: 'İşlem', filterText: () => '', render: (r) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => openEditOnInceleme(r)} className={`${actionButtonClass} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}>Düzenle</button>
        <button type="button" onClick={() => void deleteOnInceleme(r.id)} className={`${actionButtonClass} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}>Sil</button>
      </div>
    ) },
  ]

  const incelemeColumns: ColumnDef<IncelemeRow>[] = [
    { key: 'formTarihi', label: 'Tarih', filterText: (r) => formatDate(r.formTarihi), sortValue: (r) => r.formTarihi || '', render: (r) => <span className="whitespace-nowrap text-xs font-bold text-slate-500">{formatDate(r.formTarihi)}</span> },
    { key: 'dosyaNo', label: 'Dosya No', filterText: (r) => r.dosyaNo || '', render: (r) => dosyaNoCell(r.dosyaid, r.dosyaNo, 'teal') },
    { key: 'dosyaSahibi', label: 'Dosya Sahibi', filterText: (r) => r.dosyaSahibi || r.adSoyad || '', render: (r) => <span className="text-xs font-bold text-slate-700">{r.dosyaSahibi || r.adSoyad || '-'}</span> },
    { key: 'telefon', label: 'Telefon', filterText: (r) => r.telefon || '', render: (r) => <span className="text-xs font-semibold text-slate-600">{r.telefon || '-'}</span> },
    { key: 'adres', label: 'Adres', filterText: (r) => r.adres || '', render: (r) => <span className="block max-w-[200px] truncate text-xs font-semibold text-slate-600" title={r.adres || ''}>{r.adres || '-'}</span> },
    { key: 'toplamPuan', label: 'Puan', align: 'right', filterText: (r) => String(r.toplamPuan ?? ''), sortValue: (r) => r.toplamPuan ?? 0, render: (r) => <span className="text-xs font-black text-slate-700">{r.toplamPuan ?? '-'}</span> },
    { key: 'otomatikSonuc', label: 'Otomatik Sonuç', filterText: (r) => r.otomatikSonuc || '', render: (r) => sonucCell(r.otomatikSonuc) },
    { key: 'komisyonKarari', label: 'Onay Durumu', filterText: (r) => r.komisyonKarari || '', render: (r) => <span className="block max-w-xs text-xs font-semibold leading-5 text-slate-600">{r.komisyonKarari || '-'}</span> },
    { key: 'islemYapan', label: 'İşlemi Yapan', filterText: (r) => r.islemYapan || '', render: (r) => <span className="text-xs font-bold text-slate-700">{r.islemYapan || '-'}</span> },
    { key: 'action', label: 'İşlem', filterText: () => '', render: (r) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => void cancelInceleme(r.id)} className={`${actionButtonClass} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}>İptal Et</button>
        <button type="button" onClick={() => void deleteInceleme(r.id)} className={`${actionButtonClass} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}>Sil</button>
      </div>
    ) },
  ]

  const combinedRows: CombinedRow[] = useMemo(() => [
    ...guncelleme.map((r): CombinedRow => ({ id: `g-${r.id}`, rawId: r.id, sourceType: 'guncelleme', formTuru: 'Sonuç Bekleyen', tarih: r.formTarihi, dosyaid: r.dosyaid, dosyaNo: r.dosyaNo, dosyaSahibi: r.dosyaSahibi, telefon: r.telefon, adres: r.adres, sonuc: r.sonuc, islemYapan: r.islemYapan })),
    ...onInceleme.map((r): CombinedRow => ({ id: `o-${r.id}`, rawId: r.id, sourceType: 'onInceleme', formTuru: 'Ön İnceleme', tarih: r.tarih, dosyaid: r.dosyaid, dosyaNo: r.dosyaNo, dosyaSahibi: r.dosyaSahibi, telefon: r.telefon, adres: r.adres, sonuc: r.sonuc, islemYapan: r.islemYapan })),
    ...inceleme.map((r): CombinedRow => ({ id: `i-${r.id}`, rawId: r.id, sourceType: 'inceleme', formTuru: 'Tahkikat', tarih: r.formTarihi, dosyaid: r.dosyaid, dosyaNo: r.dosyaNo, dosyaSahibi: r.dosyaSahibi || r.adSoyad, telefon: r.telefon, adres: r.adres, sonuc: r.otomatikSonuc, islemYapan: r.islemYapan })),
  ], [guncelleme, onInceleme, inceleme])

  const formTuruBadgeClass: Record<ReportSourceType, string> = {
    guncelleme: 'bg-indigo-50 text-indigo-700',
    onInceleme: 'bg-amber-50 text-amber-700',
    inceleme: 'bg-teal-50 text-teal-700',
  }

  const combinedColumns: ColumnDef<CombinedRow>[] = [
    { key: 'tarih', label: 'Tarih', filterText: (r) => formatDate(r.tarih), sortValue: (r) => r.tarih || '', render: (r) => <span className="whitespace-nowrap text-xs font-bold text-slate-500">{formatDate(r.tarih)}</span> },
    { key: 'formTuru', label: 'Form Türü', filterText: (r) => r.formTuru, render: (r) => <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${formTuruBadgeClass[r.sourceType]}`}>{r.formTuru}</span> },
    { key: 'dosyaNo', label: 'Dosya No', filterText: (r) => r.dosyaNo || '', render: (r) => dosyaNoCell(r.dosyaid, r.dosyaNo, 'teal') },
    { key: 'dosyaSahibi', label: 'Ad Soyad', filterText: (r) => r.dosyaSahibi || '', render: (r) => <span className="text-xs font-bold text-slate-700">{r.dosyaSahibi || '-'}</span> },
    { key: 'telefon', label: 'Telefon', filterText: (r) => r.telefon || '', render: (r) => <span className="text-xs font-semibold text-slate-600">{r.telefon || '-'}</span> },
    { key: 'adres', label: 'Adres', filterText: (r) => r.adres || '', render: (r) => <span className="block max-w-[220px] truncate text-xs font-semibold text-slate-600" title={r.adres || ''}>{r.adres || '-'}</span> },
    { key: 'sonuc', label: 'Sonuç', filterText: (r) => r.sonuc || '', render: (r) => sonucCell(r.sonuc) },
    { key: 'islemYapan', label: 'İşlemi Yapan', filterText: (r) => r.islemYapan || '', render: (r) => <span className="text-xs font-bold text-slate-700">{r.islemYapan || '-'}</span> },
    { key: 'action', label: 'İşlem', filterText: () => '', render: (r) => (
      <div className="flex flex-wrap items-center gap-1.5">
        {r.sourceType === 'inceleme' ? (
          <button type="button" onClick={() => void cancelInceleme(r.rawId)} className={`${actionButtonClass} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}>İptal Et</button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (r.sourceType === 'guncelleme') {
                const source = guncelleme.find((row) => row.id === r.rawId)
                if (source) openEditGuncelleme(source)
              } else {
                const source = onInceleme.find((row) => row.id === r.rawId)
                if (source) openEditOnInceleme(source)
              }
            }}
            className={`${actionButtonClass} border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100`}
          >
            Düzenle
          </button>
        )}
        <button type="button" onClick={() => void deleteBySourceType(r)} className={`${actionButtonClass} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}>Sil</button>
      </div>
    ) },
  ]

  return (
    <main className="min-h-screen w-full bg-gradient-to-br from-sky-50 via-white to-emerald-50 px-3 py-5 text-slate-900 sm:px-5 lg:px-8">
      <div className="mx-auto w-full max-w-[1900px] space-y-5">
        <div className="rounded-lg border border-[#8fd167] bg-gradient-to-r from-[#087fb2] via-[#309690] to-[#6fb744] px-5 py-4 text-white shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/85">İş Akışı</p>
              <h1 className="mt-1 text-2xl font-black leading-tight text-white lg:text-3xl">İnceleme Formları Raporu</h1>
              <p className="mt-2 max-w-2xl text-xs font-semibold leading-5 text-white/85">
                Seçilen tarih aralığında doldurulmuş tüm Ön İnceleme, Tahkikat ve Sonuç Bekleyen (Komisyon) raporlarını, dosya bilgilerini ve sonuçlarını dosyaya göre gruplu ya da liste halinde gösterir; buradan düzenlenebilir, iptal edilebilir veya silinebilir.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-md border border-white/50 bg-white/15 px-3 py-1.5 text-xs font-black text-white">
                Toplam: {tabCounts.summary.toLocaleString('tr-TR')} işlem
              </span>
            </div>
          </div>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[160px_160px_1fr_auto_auto] lg:items-end">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Başlangıç</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
              />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Bitiş</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
              />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Dosya no ara</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Dosya no"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
              />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setDateFrom(todayIso()); setDateTo(todayIso()) }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:border-[#0076b6] hover:text-[#0076b6]">Bugün</button>
              <button type="button" onClick={() => { setDateFrom(isoDaysAgo(7)); setDateTo(todayIso()) }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:border-[#0076b6] hover:text-[#0076b6]">Son 7 Gün</button>
              <button type="button" onClick={() => { setDateFrom(isoDaysAgo(30)); setDateTo(todayIso()) }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:border-[#0076b6] hover:text-[#0076b6]">Son 30 Gün</button>
            </div>
            <button
              type="button"
              onClick={() => { setDateFrom(''); setDateTo(''); setSearch('') }}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:border-rose-200 hover:text-rose-600"
            >
              Temizle
            </button>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const accent = TAB_ACCENT_CLASSES[tab.accent]
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md border px-3 py-2 text-sm font-black transition-colors ${isActive ? accent.active : accent.inactive}`}
              >
                {tab.label} ({tabCounts[tab.id].toLocaleString('tr-TR')})
              </button>
            )
          })}
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
        )}

        {actionError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{actionError}</div>
        )}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500 shadow-sm">Rapor hazırlanıyor...</div>
        ) : (
          <>
            {activeTab === 'grouped' && (
              <GroupedByFileView
                rows={combinedRows}
                onOpenFile={openDosya}
                onEdit={(row) => {
                  if (row.sourceType === 'guncelleme') {
                    const source = guncelleme.find((item) => item.id === row.rawId)
                    if (source) openEditGuncelleme(source)
                  } else if (row.sourceType === 'onInceleme') {
                    const source = onInceleme.find((item) => item.id === row.rawId)
                    if (source) openEditOnInceleme(source)
                  }
                }}
                onCancel={(row) => void cancelInceleme(row.rawId)}
                onDelete={(row) => void deleteBySourceType(row)}
                formTuruBadgeClass={formTuruBadgeClass}
                sonucBadgeClass={sonucBadgeClass}
              />
            )}

            {activeTab === 'guncelleme' && (
              <DataTable rows={guncelleme} columns={guncellemeColumns} accent="indigo" emptyMessage="Seçilen aralıkta kayıt bulunamadı" minWidth={1700} />
            )}

            {activeTab === 'onInceleme' && (
              <DataTable rows={onInceleme} columns={onIncelemeColumns} accent="amber" emptyMessage="Seçilen aralıkta kayıt bulunamadı" minWidth={1700} />
            )}

            {activeTab === 'inceleme' && (
              <DataTable rows={inceleme} columns={incelemeColumns} accent="teal" emptyMessage="Seçilen aralıkta kayıt bulunamadı" minWidth={1700} />
            )}

            {activeTab === 'summary' && summary && (
              <div className="space-y-5">
                <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  {[
                    { label: 'Sonuç Bekleyen Raporu', value: summary.totals.guncelleme, card: 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-white', tone: 'text-indigo-700' },
                    { label: 'Ön İnceleme Formu', value: summary.totals.onInceleme, card: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white', tone: 'text-amber-700' },
                    { label: 'Tahkikat Formu', value: summary.totals.inceleme, card: 'border-teal-200 bg-gradient-to-br from-teal-50 to-white', tone: 'text-teal-700' },
                    { label: 'Toplam İşlem', value: summary.totals.all, card: 'border-violet-200 bg-gradient-to-br from-violet-50 to-white', tone: 'text-violet-700' },
                  ].map((item) => (
                    <div key={item.label} className={`rounded-lg border p-5 shadow-sm ${item.card}`}>
                      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{item.label}</p>
                      <p className={`mt-2 text-3xl font-black ${item.tone}`}>{item.value.toLocaleString('tr-TR')}</p>
                    </div>
                  ))}
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-sm font-black text-slate-900">Sonuç türüne göre özet sayılar</h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Seçilen tarih aralığında form türüne göre sonuç sayıları.</p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Form Türü</th>
                          <th className="px-4 py-3">Sonuç</th>
                          <th className="px-4 py-3">Kayıt Sayısı</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {summary.bySonuc.length > 0 ? summary.bySonuc.map((row, index) => (
                          <tr key={`${row.type}-${row.sonuc}-${index}`} className="odd:bg-white even:bg-slate-50/60">
                            <td className="px-4 py-3 text-xs font-bold text-slate-700">{row.type}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black text-white ${sonucBadgeClass(row.sonuc)}`}>{row.sonuc}</span>
                            </td>
                            <td className="px-4 py-3 text-xs font-black text-slate-700">{row.count.toLocaleString('tr-TR')}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={3} className="px-4 py-12 text-center text-sm font-black text-slate-500">Seçilen aralıkta veri yok</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <DataTable
                  rows={combinedRows}
                  columns={combinedColumns}
                  accent="violet"
                  emptyMessage="Seçilen aralıkta kayıt bulunamadı"
                  minWidth={1600}
                  title="Tüm İşlemler (Düz Liste)"
                  description="Hangi dosyada, kim tarafından, ne sonuçla işlem yapıldığını tek listede gösterir. Dosyaya göre gruplu görünüm için üstteki 'Dosyaya Göre Gruplu' sekmesini kullanın."
                />
              </div>
            )}
          </>
        )}
      </div>

      {editTarget && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-sky-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-sky-100 bg-sky-50 px-4 py-3">
              <div>
                <h3 className="text-sm font-black uppercase text-sky-900">
                  {editTarget.type === 'onInceleme' ? 'Ön İnceleme Raporu Düzenle' : 'Sonuç Bekleyen Raporu Düzenle'}
                </h3>
                <p className="text-xs font-bold text-sky-700">{editTarget.dosyaNo ? `Dosya ${formatFileNo(editTarget.dosyaNo)}` : ''}</p>
              </div>
              <button type="button" onClick={closeEditModal} className="rounded-full p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500">✕</button>
            </div>
            <div className="space-y-3 p-4">
              {editError && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{editError}</div>}
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-extrabold uppercase text-slate-600">Tarih</span>
                <input
                  type="date"
                  value={editForm.tarih}
                  onChange={(event) => setEditForm((current) => ({ ...current, tarih: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-sky-500"
                />
              </label>
              {editTarget.type === 'guncelleme' && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-extrabold uppercase text-slate-600">Konu</span>
                  <input
                    value={editForm.konu}
                    onChange={(event) => setEditForm((current) => ({ ...current, konu: event.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-sky-500"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-extrabold uppercase text-slate-600">{editTarget.type === 'onInceleme' ? 'Açıklama' : 'Rapor'}</span>
                <textarea
                  rows={5}
                  value={editForm.metin}
                  onChange={(event) => setEditForm((current) => ({ ...current, metin: event.target.value }))}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={editStatus === 'saving'}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={editStatus === 'saving'}
                className="rounded-md border border-sky-600 bg-sky-600 px-4 py-2 text-sm font-extrabold text-white shadow-sm hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60"
              >
                {editStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
