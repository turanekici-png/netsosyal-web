'use client'

// 2026-10-15 kullanici istegi: ana sayfaya kullanicinin kendi "özet rapor"
// kutularini ekleyebilmesi. Sunucu: app/api/dashboard/custom-widgets +
// lib/dashboard/customSummaryWidgets.ts. Kutudaki satira tiklayinca Özel Rapor
// o filtreyle yeni sekmede acilir.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

export type CustomWidgetFilter = { field: string; op: string; value?: string }
export type CustomSummaryWidget = {
  id: string
  title: string
  sourceId: string
  groupBy: string | null
  dateGrouping?: 'month' | 'year'
  aggregate: 'count' | 'sum'
  sumField?: string | null
  filter?: CustomWidgetFilter | null
  display: 'bars' | 'number'
  limit: number
}
type CustomWidgetItem = { value: string | null; label: string; total: number; drillPath: string }
export type CustomWidgetResult = { items: CustomWidgetItem[]; total: number; otherTotal: number; reportPath: string }
export type CustomWidgetEntry = { widget: CustomSummaryWidget; result: CustomWidgetResult | null; error: string | null }
type ColumnMeta = { name: string; label: string; type: 'number' | 'date' | 'text' }
type SourceMeta = { id: string; label: string }

const FILTER_OPERATORS = [
  { id: 'eq', label: 'Eşittir' },
  { id: 'neq', label: 'Eşit Değil' },
  { id: 'contains', label: 'İçerir' },
  { id: 'gte', label: 'Büyük Eşit (≥)' },
  { id: 'lte', label: 'Küçük Eşit (≤)' },
  { id: 'empty', label: 'Boş' },
  { id: 'not_empty', label: 'Boş Değil' },
]

const formatValue = (value: number) => value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })

// ---------------------------------------------------------------- veri kancasi
export function useCustomSummaryWidgets() {
  const [entries, setEntries] = useState<CustomWidgetEntry[]>([])
  const [available, setAvailable] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/custom-widgets')
      if (response.status === 401 || response.status === 403) {
        setAvailable(false)
        setEntries([])
        return
      }
      const payload = await response.json()
      if (payload?.success && Array.isArray(payload.data)) {
        setAvailable(true)
        setEntries(payload.data)
      }
    } catch {
      // ana sayfanin geri kalanini etkilemesin
    } finally {
      setLoaded(true)
    }
  }, [])

  // Ilk yukleme: setState yalniz istek dondukten sonra (efekt icinde senkron degil).
  useEffect(() => {
    let cancelled = false
    fetch('/api/dashboard/custom-widgets')
      .then(async (response) => {
        if (cancelled) return
        if (response.status === 401 || response.status === 403) return
        const payload = await response.json()
        if (!cancelled && payload?.success && Array.isArray(payload.data)) {
          setAvailable(true)
          setEntries(payload.data)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const removeWidget = useCallback(async (id: string) => {
    const response = await fetch('/api/dashboard/custom-widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    })
    if (response.ok) setEntries((current) => current.filter((entry) => entry.widget.id !== id))
  }, [])

  return { entries, available, loaded, reload, removeWidget }
}

// ---------------------------------------------------------------- kutu
function SummaryBody({ widget, result, onOpenPath }: { widget: CustomSummaryWidget; result: CustomWidgetResult; onOpenPath?: (path: string, title: string) => void }) {
  if (widget.display === 'number') {
    return (
      <button
        type="button"
        onClick={() => onOpenPath?.(result.reportPath, widget.title)}
        className="flex h-full min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-4 transition hover:border-[#1E2A38] hover:bg-[#F6F3EA]"
        title="Kayıtları Özel Rapor'da aç"
      >
        <span className="text-[34px] font-bold leading-none text-[#1E2A38]">{formatValue(result.total)}</span>
        <span className="text-[13.5px] font-semibold text-slate-500">{widget.aggregate === 'sum' ? 'Toplam' : 'Kayıt'}</span>
      </button>
    )
  }
  const max = Math.max(1, ...result.items.map((item) => item.total))
  if (result.items.length === 0) {
    return <p className="py-6 text-center text-[14.5px] font-semibold text-slate-500">Bu ölçüte uyan kayıt yok.</p>
  }
  return (
    <div className="space-y-1">
      {result.items.map((item) => (
        <button
          key={`${item.value ?? '∅'}`}
          type="button"
          onClick={() => onOpenPath?.(item.drillPath, `${widget.title} · ${item.label}`)}
          className="group block w-full rounded-md px-2 py-1.5 text-left transition hover:bg-[#F6F3EA]"
          title={`${item.label} kayıtlarını Özel Rapor'da aç`}
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[14.5px] font-semibold text-slate-800 group-hover:text-[#1E2A38]">{item.label}</span>
            <span className="shrink-0 text-[14.5px] font-bold tabular-nums text-[#1E2A38]">{formatValue(item.total)}</span>
          </span>
          <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full bg-[#1E2A38] group-hover:bg-[#D4B26A]" style={{ width: `${Math.max(2, (item.total / max) * 100)}%` }} />
          </span>
        </button>
      ))}
      {result.otherTotal > 0 && (
        <p className="px-2 pt-1 text-[13px] font-semibold text-slate-500">Diğer: {formatValue(result.otherTotal)}</p>
      )}
    </div>
  )
}

export function CustomSummaryPanel({
  entry,
  onOpenPath,
  onEdit,
  onDelete,
}: {
  entry: CustomWidgetEntry
  onOpenPath: (path: string, title: string) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { widget, result, error } = entry
  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="dashboard-drag-handle flex items-center justify-between gap-2 border-b-2 border-[#D4B26A] bg-[#1E2A38] px-4 py-2.5 text-white">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-bold uppercase tracking-wide">{widget.title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pr-8">
          {result && widget.display === 'bars' && (
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[15px] font-bold">{formatValue(result.total)}</span>
          )}
          <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={onEdit} className="rounded-md border border-white/30 bg-white/10 px-2 py-1 text-[12.5px] font-bold hover:bg-white/20" title="Raporu düzenle">Düzenle</button>
          <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={onDelete} className="rounded-md border border-white/30 bg-white/10 px-2 py-1 text-[12.5px] font-bold hover:bg-rose-600" title="Raporu kaldır">Kaldır</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-semibold text-rose-700">Rapor hesaplanamadı: {error}</p>
        ) : result ? (
          <SummaryBody widget={widget} result={result} onOpenPath={onOpenPath} />
        ) : (
          <p className="py-6 text-center text-[14px] font-semibold text-slate-500">Yükleniyor...</p>
        )}
      </div>
      {result && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
          <span className="text-[12.5px] font-semibold text-slate-500">Kullanıcı özet raporu</span>
          <button type="button" onClick={() => onOpenPath(result.reportPath, widget.title)} className="text-[13.5px] font-bold text-[#1E2A38] hover:underline">
            Tüm kayıtları aç →
          </button>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- olusturucu
const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-[5px] text-[15px] font-semibold text-slate-900 outline-none focus:border-[#1E2A38] focus:ring-2 focus:ring-[#1E2A38]/15'
const labelClass = 'mb-1 block text-[13px] font-bold text-slate-600'
const buttonNeutral = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-[14.5px] font-bold text-[#1E2A38] shadow-sm hover:border-[#1E2A38] hover:bg-[#F6F3EA] disabled:opacity-40'
const buttonPrimary = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[#1E2A38] bg-[#1E2A38] px-4 text-[14.5px] font-bold text-white shadow-sm hover:bg-[#2A3B4D] disabled:opacity-40'

const EMPTY_WIDGET: CustomSummaryWidget = {
  id: '',
  title: '',
  sourceId: 'dosyalar',
  groupBy: null,
  aggregate: 'count',
  sumField: null,
  filter: null,
  display: 'bars',
  limit: 10,
}

export function CustomSummaryBuilder({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  initial: CustomSummaryWidget | null
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<CustomSummaryWidget>(() => initial ?? EMPTY_WIDGET)
  const [sources, setSources] = useState<SourceMeta[]>([])
  const [columns, setColumns] = useState<ColumnMeta[]>([])
  const [preview, setPreview] = useState<{ widget: CustomSummaryWidget; result: CustomWidgetResult } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch('/api/dashboard/custom-widgets?meta=sources')
      .then((res) => res.json())
      .then((payload) => { if (payload?.success) setSources(payload.data) })
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open || !draft.sourceId) return
    let cancelled = false
    fetch(`/api/dashboard/custom-widgets?columns=${encodeURIComponent(draft.sourceId)}`)
      .then((res) => res.json())
      .then((payload) => { if (!cancelled && payload?.success) setColumns(payload.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, draft.sourceId])

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.label.localeCompare(b.label, 'tr')),
    [columns],
  )
  const numericColumns = sortedColumns.filter((column) => column.type === 'number')
  const groupColumn = columns.find((column) => column.name === draft.groupBy)
  const update = (patch: Partial<CustomSummaryWidget>) => { setDraft((current) => ({ ...current, ...patch })); setPreview(null) }

  const send = async (action: 'preview' | 'save') => {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/dashboard/custom-widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, widget: draft }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'İşlem başarısız.')
      setPreview(payload.data)
      if (action === 'save') {
        onSaved()
        onClose()
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'İşlem başarısız.')
    } finally {
      setBusy(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b-2 border-[#D4B26A] bg-[#1E2A38] px-5 py-3 text-white">
          <div>
            <p className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-[#D4B26A]">Ana Sayfa</p>
            <h2 className="text-[18px] font-semibold">{initial ? 'Özet Raporu Düzenle' : 'Yeni Özet Rapor Ekle'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 text-[20px] leading-none text-white/70 hover:bg-white/10 hover:text-white" aria-label="Kapat">✕</button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-[1fr_minmax(280px,380px)]">
          <div className="space-y-4 p-5">
            <div>
              <label className={labelClass}>Rapor başlığı</label>
              <input className={inputClass} value={draft.title} maxLength={80} onChange={(event) => update({ title: event.target.value })} placeholder="Örn. Mahallelere Göre Dosya Sayısı" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Veri kaynağı</label>
                <select className={inputClass} value={draft.sourceId} onChange={(event) => update({ sourceId: event.target.value, groupBy: null, sumField: null, filter: null })}>
                  {sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Görünüm</label>
                <div className="flex gap-2">
                  {([['bars', 'Gruplu liste'], ['number', 'Tek sayı']] as const).map(([value, text]) => (
                    <button key={value} type="button" onClick={() => update({ display: value })} className={`flex-1 rounded-md border px-3 py-[5px] text-[14.5px] font-bold ${draft.display === value ? 'border-[#1E2A38] bg-[#1E2A38] text-white' : 'border-slate-300 bg-white text-[#1E2A38] hover:bg-[#F6F3EA]'}`}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {draft.display === 'bars' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Gruplama alanı (neye göre?)</label>
                  <select className={inputClass} value={draft.groupBy ?? ''} onChange={(event) => update({ groupBy: event.target.value || null })}>
                    <option value="">Seçin...</option>
                    {sortedColumns.map((column) => <option key={column.name} value={column.name}>{column.label}</option>)}
                  </select>
                </div>
                {groupColumn?.type === 'date' ? (
                  <div>
                    <label className={labelClass}>Tarih gruplama</label>
                    <select className={inputClass} value={draft.dateGrouping ?? 'month'} onChange={(event) => update({ dateGrouping: event.target.value as 'month' | 'year' })}>
                      <option value="month">Aylık</option>
                      <option value="year">Yıllık</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className={labelClass}>Gösterilecek satır</label>
                    <select className={inputClass} value={draft.limit} onChange={(event) => update({ limit: Number(event.target.value) })}>
                      {[5, 10, 15, 20].map((n) => <option key={n} value={n}>İlk {n}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Ölçü</label>
                <select className={inputClass} value={draft.aggregate} onChange={(event) => update({ aggregate: event.target.value as 'count' | 'sum' })}>
                  <option value="count">Kayıt sayısı</option>
                  <option value="sum" disabled={numericColumns.length === 0}>Sayısal alan toplamı</option>
                </select>
              </div>
              {draft.aggregate === 'sum' && (
                <div>
                  <label className={labelClass}>Toplanacak alan</label>
                  <select className={inputClass} value={draft.sumField ?? ''} onChange={(event) => update({ sumField: event.target.value || null })}>
                    <option value="">Seçin...</option>
                    {numericColumns.map((column) => <option key={column.name} value={column.name}>{column.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-[13px] font-bold text-slate-600">Filtre (isteğe bağlı)</legend>
              <div className="grid gap-3 sm:grid-cols-[1fr_170px_1fr]">
                <select className={inputClass} value={draft.filter?.field ?? ''} onChange={(event) => update({ filter: event.target.value ? { field: event.target.value, op: draft.filter?.op ?? 'eq', value: draft.filter?.value ?? '' } : null })}>
                  <option value="">Filtre yok</option>
                  {sortedColumns.map((column) => <option key={column.name} value={column.name}>{column.label}</option>)}
                </select>
                <select className={inputClass} disabled={!draft.filter} value={draft.filter?.op ?? 'eq'} onChange={(event) => draft.filter && update({ filter: { ...draft.filter, op: event.target.value } })}>
                  {FILTER_OPERATORS.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
                </select>
                <input
                  className={inputClass}
                  disabled={!draft.filter || draft.filter.op === 'empty' || draft.filter.op === 'not_empty'}
                  value={draft.filter?.value ?? ''}
                  onChange={(event) => draft.filter && update({ filter: { ...draft.filter, value: event.target.value } })}
                  placeholder="Değer (kod ya da metin)"
                />
              </div>
              <p className="mt-2 text-[12.5px] font-medium text-slate-500">Kodlu alanlarda (durum vb.) kodu yazın; örn. Dosya Durumu için 2.</p>
            </fieldset>

            {message && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-semibold text-rose-700">{message}</p>}
          </div>

          <div className="border-t border-slate-200 bg-[#F7F8FA] p-5 md:border-l md:border-t-0">
            <p className="mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">Önizleme</p>
            {preview ? (
              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-2 rounded-t-xl border-b-2 border-[#D4B26A] bg-[#1E2A38] px-3 py-2 text-white">
                  <span className="truncate text-[14.5px] font-bold uppercase tracking-wide">{preview.widget.title}</span>
                  {preview.widget.display === 'bars' && <span className="text-[14px] font-bold">{formatValue(preview.result.total)}</span>}
                </div>
                <div className="max-h-[50vh] overflow-y-auto p-2">
                  <SummaryBody widget={preview.widget} result={preview.result} />
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-[14px] font-semibold text-slate-500">
                Ayarları seçip &quot;Önizle&quot;ye basın.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className={buttonNeutral}>Vazgeç</button>
          <button type="button" onClick={() => void send('preview')} disabled={busy} className={buttonNeutral}>{busy ? 'Hesaplanıyor...' : 'Önizle'}</button>
          <button type="button" onClick={() => void send('save')} disabled={busy} className={buttonPrimary}>{initial ? 'Değişiklikleri Kaydet' : 'Ana Sayfaya Ekle'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export async function confirmRemoveWidget(title: string) {
  return confirmDialog(`"${title}" özet raporu ana sayfanızdan kaldırılsın mı?`)
}
