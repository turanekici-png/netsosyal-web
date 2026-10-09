'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { downloadXlsx } from '@/lib/utils/xlsxExport'
import type { CustomReportSource } from '@/lib/constants/customReportSources'
import type { CustomReportPreset } from '@/lib/constants/customReportPresets'

type Condition = {
  field: string
  op: string
  value: string
  value2: string
}

type ColumnMeta = { value: string; label: string; group: string }
type ColumnValueOption = { value: string; label: string; count: number }

type OzelRaporClientProps = {
  sources: CustomReportSource[]
  selectedSourceId: string
  columns: string[]
  columnOptions: ColumnMeta[]
  activeJoinIds: string[]
  data: Record<string, unknown>[]
  filterValueOptions?: Record<string, ColumnValueOption[]>
  totalCount: number
  currentPage: number
  pageSize: number
  searchTerm: string
  selectedColumns: string[]
  duplicateColumns: string[]
  initialConditions: Condition[]
  errorMessage?: string | null
}

const OPERATORS = [
  { id: 'contains', label: 'İçerir' },
  { id: 'eq', label: 'Eşittir' },
  { id: 'neq', label: 'Eşit Değil' },
  { id: 'empty', label: 'Boş' },
  { id: 'not_empty', label: 'Boş Değil' },
  { id: 'starts', label: 'İle Başlar' },
  { id: 'ends', label: 'İle Biter' },
  { id: 'gt', label: 'Büyüktür' },
  { id: 'lt', label: 'Küçüktür' },
  { id: 'gte', label: 'Büyük Eşit' },
  { id: 'lte', label: 'Küçük Eşit' },
  { id: 'between', label: 'Arasında' },
]

const VALUELESS_OPERATORS = new Set(['empty', 'not_empty'])
const COMMON_COLUMN_PRIORITY = [
  'dosya__adresno',
  'adresno',
  'dosyaid',
  'tckimlikno',
  'adisoyadi',
  'muracaateden',
  'donem',
  'asama',
  'durumu',
]
const DGN_ASSISTANCE_TABLES = new Set(['yrd_ddgidadosyali', 'yrd_giyim', 'yrd_ayninakti'])

function buildPageUrl(searchParams: URLSearchParams, page: number) {
  const params = new URLSearchParams(searchParams.toString())
  params.set('page', String(page))
  return `/reports/ozel?${params.toString()}`
}

function toXlsxRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const safeRow: Record<string, string | number | boolean | Date | null | undefined> = {}
    Object.entries(row).forEach(([key, value]) => {
      if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value instanceof Date
      ) {
        safeRow[key] = value
        return
      }

      safeRow[key] = JSON.stringify(value)
    })
    return safeRow
  })
}

function groupColumnOptions(options: ColumnMeta[]) {
  const groups = new Map<string, ColumnMeta[]>()
  options.forEach((option) => {
    if (!groups.has(option.group)) groups.set(option.group, [])
    groups.get(option.group)!.push(option)
  })
  return Array.from(groups.entries())
}

export function OzelRaporClient({
  sources,
  selectedSourceId,
  columns,
  columnOptions,
  activeJoinIds,
  data,
  filterValueOptions = {},
  totalCount,
  currentPage,
  pageSize,
  searchTerm,
  selectedColumns,
  duplicateColumns,
  initialConditions,
  errorMessage,
}: OzelRaporClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sourceId, setSourceId] = useState(selectedSourceId)
  const [joins, setJoins] = useState<string[]>(activeJoinIds)
  const [searchInput, setSearchInput] = useState(searchTerm)
  const [conditions, setConditions] = useState<Condition[]>(
    initialConditions.length > 0
      ? initialConditions
      : [{ field: columns[0] || '', op: 'contains', value: '', value2: '' }],
  )
  const [visibleColumns, setVisibleColumns] = useState<string[]>(selectedColumns)
  const [sameColumns, setSameColumns] = useState<string[]>(duplicateColumns)
  const [presets, setPresets] = useState<CustomReportPreset[]>([])
  const [presetsLoaded, setPresetsLoaded] = useState(false)
  const [presetNameInput, setPresetNameInput] = useState('')
  const [isSavingPreset, setIsSavingPreset] = useState(false)
  const [presetStatus, setPresetStatus] = useState('')
  const [activeSection, setActiveSection] = useState<'kaynak' | 'kosullar' | 'sutunlar'>('kaynak')

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const firstRecord = data.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastRecord = data.length === 0 ? 0 : firstRecord + data.length - 1
  const selectedSource = sources.find((source) => source.id === sourceId)
  const isAssistanceSource = Boolean(selectedSource?.tableName.startsWith('yrd_'))
  const isFileSource = selectedSource?.tableName === 'dosyalar'

  const orderedColumnOptions = useMemo(() => {
    const priority = new Map(COMMON_COLUMN_PRIORITY.map((column, index) => [column, index]))
    return [...columnOptions].sort((left, right) => {
      const leftPriority = priority.get(left.value) ?? 999
      const rightPriority = priority.get(right.value) ?? 999
      if (leftPriority !== rightPriority) return leftPriority - rightPriority
      return left.value.localeCompare(right.value, 'tr-TR')
    })
  }, [columnOptions])

  const groupedColumnOptions = useMemo(() => groupColumnOptions(orderedColumnOptions), [orderedColumnOptions])
  const columnLabelByValue = useMemo(() => {
    const map = new Map<string, string>()
    columnOptions.forEach((option) => map.set(option.value, option.group === selectedSource?.label ? option.value : `${option.group}: ${option.label}`))
    return map
  }, [columnOptions, selectedSource])

  const tableKey = useMemo(() => {
    return `ozel-rapor-${selectedSourceId}-${searchParams.toString()}`
  }, [searchParams, selectedSourceId])

  useEffect(() => {
    let isCancelled = false

    const loadPresets = async () => {
      try {
        const response = await fetch('/api/reports/custom-report-presets')
        const payload = await response.json()
        if (!isCancelled && payload?.success) setPresets(payload.data)
      } catch {
        // sessizce yoksay - sablonlar sadece bir kolaylik, kritik degil
      } finally {
        if (!isCancelled) setPresetsLoaded(true)
      }
    }

    void loadPresets()
    return () => { isCancelled = true }
  }, [])

  const toggleJoin = (joinId: string) => {
    setJoins((current) => (
      current.includes(joinId) ? current.filter((id) => id !== joinId) : [...current, joinId]
    ))
  }

  const updateCondition = (index: number, patch: Partial<Condition>) => {
    setConditions((current) => current.map((condition, conditionIndex) => (
      conditionIndex === index ? { ...condition, ...patch } : condition
    )))
  }

  const toggleColumn = (column: string) => {
    setVisibleColumns((current) => (
      current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column]
    ))
  }

  const toggleSameColumn = (column: string) => {
    setSameColumns((current) => (
      current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column]
    ))
  }

  const buildQueryString = () => {
    const params = new URLSearchParams()
    params.set('source', sourceId)
    params.set('page', '1')
    params.set('joins', joins.join(','))

    if (searchInput.trim()) params.set('search', searchInput.trim())
    if (visibleColumns.length > 0) params.set('cols', visibleColumns.join(','))
    if (sameColumns.length > 0) params.set('same', sameColumns.join(','))

    conditions.forEach((condition, index) => {
      if (!condition.field) return
      if (!VALUELESS_OPERATORS.has(condition.op) && !condition.value.trim()) return

      params.set(`c${index}_field`, condition.field)
      params.set(`c${index}_op`, condition.op)
      params.set(`c${index}_value`, condition.value.trim())
      if (condition.op === 'between' && condition.value2.trim()) {
        params.set(`c${index}_value2`, condition.value2.trim())
      }
    })

    return params
  }

  const runReport = () => {
    router.push(`/reports/ozel?${buildQueryString().toString()}`)
  }

  const resetReport = () => {
    router.push('/reports/ozel')
  }

  const exportRows = () => {
    if (data.length === 0) return
    downloadXlsx(toXlsxRows(data), `ozel-rapor-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Özel Rapor')
  }

  const savePreset = async () => {
    const name = presetNameInput.trim()
    if (!name) {
      setPresetStatus('Şablona bir ad verin.')
      return
    }

    setIsSavingPreset(true)
    setPresetStatus('')
    try {
      const response = await fetch('/api/reports/custom-report-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, queryString: buildQueryString().toString() }),
      })
      const payload = await response.json()
      if (payload?.success) {
        setPresets((current) => [payload.data, ...current])
        setPresetNameInput('')
        setPresetStatus('Şablon kaydedildi.')
      } else {
        setPresetStatus(payload?.error || 'Şablon kaydedilemedi.')
      }
    } catch {
      setPresetStatus('Şablon kaydedilemedi - sunucuya ulaşılamadı.')
    } finally {
      setIsSavingPreset(false)
    }
  }

  const loadPreset = (preset: CustomReportPreset) => {
    router.push(`/reports/ozel?${preset.queryString}`)
  }

  const deletePreset = async (preset: CustomReportPreset) => {
    if (!window.confirm(`"${preset.name}" adlı şablonu silmek istediğinize emin misiniz?`)) return
    try {
      await fetch('/api/reports/custom-report-presets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: preset.id }),
      })
      setPresets((current) => current.filter((item) => item.id !== preset.id))
    } catch {
      setPresetStatus('Şablon silinemedi.')
    }
  }

  return (
    <div className="space-y-6 text-slate-950">
      <div className="overflow-hidden rounded-2xl border border-white shadow-[0_18px_45px_rgba(15,23,42,0.10)] ring-1 ring-slate-200 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#0076b6] via-[#0076b6] to-[#3f7f28] px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 text-2xl">
              📊
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide text-white/80">Raporlar</p>
              <h1 className="text-lg font-black leading-tight">Özel Rapor Oluştur</h1>
            </div>
          </div>
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-white/15 px-4 py-2 text-[15px] font-black text-white ring-1 ring-white/30 hover:bg-white/25">
            Yazdır
          </button>
        </div>
        <div className="bg-gradient-to-b from-sky-50/60 via-white to-white px-5 py-2.5 text-xs font-bold text-slate-500">
          {selectedSource?.label || 'Kaynak'} kaynağından {firstRecord}-{lastRecord} arası kayıt gösteriliyor (toplam {totalCount}).
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600 print:hidden">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] print:hidden">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex gap-1 border-b border-slate-100 p-2">
              {([
                { id: 'kaynak', label: '1. Kaynak & Tablolar' },
                { id: 'kosullar', label: '2. Koşullar' },
                { id: 'sutunlar', label: '3. Sütunlar' },
              ] as const).map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`rounded-lg px-3.5 py-2 text-[15px] font-black transition-colors ${
                    activeSection === section.id
                      ? 'bg-[#0076b6] text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>

            <div className="p-5">
              {activeSection === 'kaynak' && (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[15px] font-black uppercase text-slate-500">Rapor Kaynağı (Ana Tablo)</span>
                      <select
                        value={sourceId}
                        onChange={(event) => {
                          setSourceId(event.target.value)
                          router.push(`/reports/ozel?source=${encodeURIComponent(event.target.value)}`)
                        }}
                        className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                      >
                        {sources.map((source) => (
                          <option key={source.id} value={source.id}>{source.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-[15px] font-black uppercase text-slate-500">Genel Arama</span>
                      <input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder="Seçili kaynağın tüm alanlarında ara"
                        className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                      />
                    </label>
                  </div>

                  {(selectedSource?.joinable?.length ?? 0) > 0 && (
                    <div>
                      <span className="text-[15px] font-black uppercase text-slate-500">Farklı Tablolardan Bilgi Ekle</span>
                      <p className="mt-1 text-[11px] font-semibold text-slate-400">
                        İşaretlediğiniz tabloların sütunları, aşağıdaki Koşullar ve Sütunlar bölümlerinde de seçilebilir hale gelir.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedSource!.joinable!.map((join) => (
                          <label
                            key={join.id}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3.5 py-2.5 text-sm font-black transition-colors ${
                              joins.includes(join.id)
                                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={joins.includes(join.id)}
                              onChange={() => toggleJoin(join.id)}
                              className="h-4 w-4"
                            />
                            {join.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeSection === 'kosullar' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-black text-slate-900">Koşullar</h2>
                    <button
                      type="button"
                      onClick={() => setConditions((current) => [...current, { field: columns[0] || '', op: 'contains', value: '', value2: '' }])}
                      className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[15px] font-black text-[#005f95] hover:bg-sky-100"
                    >
                      + Koşul Ekle
                    </button>
                  </div>

                  {conditions.length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs font-bold text-slate-400">
                      Henüz koşul yok - tüm kayıtlar listelenecek.
                    </p>
                  )}

                  {conditions.map((condition, index) => {
                    const needsValue = !VALUELESS_OPERATORS.has(condition.op)
                    return (
                      <div key={index} className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 lg:grid-cols-[220px_150px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <select
                          value={condition.field}
                          onChange={(event) => updateCondition(index, { field: event.target.value })}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
                        >
                          {groupedColumnOptions.map(([group, options]) => (
                            <optgroup key={group} label={group}>
                              {options.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <select
                          value={condition.op}
                          onChange={(event) => updateCondition(index, { op: event.target.value })}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
                        >
                          {OPERATORS.map((operator) => (
                            <option key={operator.id} value={operator.id}>{operator.label}</option>
                          ))}
                        </select>
                        <input
                          value={condition.value}
                          onChange={(event) => updateCondition(index, { value: event.target.value })}
                          disabled={!needsValue}
                          placeholder={needsValue ? 'Değer' : 'Değer gerekmez'}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold disabled:bg-slate-100"
                        />
                        <input
                          value={condition.value2}
                          onChange={(event) => updateCondition(index, { value2: event.target.value })}
                          disabled={condition.op !== 'between'}
                          placeholder="İkinci değer"
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold disabled:bg-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => setConditions((current) => current.filter((_item, itemIndex) => itemIndex !== index))}
                          className="rounded-md border border-rose-200 bg-white px-3 py-2 text-[15px] font-black text-rose-600 hover:bg-rose-50"
                        >
                          Sil
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {activeSection === 'sutunlar' && (
                <div className="grid gap-5 xl:grid-cols-2">
                  <div>
                    <h2 className="text-sm font-black text-slate-900">Gösterilecek Alanlar ({visibleColumns.length})</h2>
                    <div className="mt-2 max-h-72 space-y-3 overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
                      {groupedColumnOptions.map(([group, options]) => (
                        <div key={group}>
                          <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">{group}</p>
                          <div className="flex flex-wrap gap-2">
                            {options.map((option) => (
                              <label key={option.value} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700">
                                <input type="checkbox" checked={visibleColumns.includes(option.value)} onChange={() => toggleColumn(option.value)} />
                                {option.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-sm font-black text-slate-900">Aynı Olan Alanlar (Kopya/Tekrar Bulucu)</h2>
                    <div className="mt-2 max-h-72 space-y-3 overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
                      {groupedColumnOptions.map(([group, options]) => (
                        <div key={group}>
                          <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">{group}</p>
                          <div className="flex flex-wrap gap-2">
                            {options.map((option) => (
                              <label key={option.value} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700">
                                <input type="checkbox" checked={sameColumns.includes(option.value)} onChange={() => toggleSameColumn(option.value)} />
                                {option.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      Örneğin &quot;Adres No&quot; seçilirse, aynı adrese kayıtlı birden fazla kayıt listelenir.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3.5">
              <button type="button" onClick={runReport} className="rounded-lg bg-[#0076b6] px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-[#00649b]">
                Raporu Getir
              </button>
              <button type="button" onClick={resetReport} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50">
                Temizle
              </button>
              <button type="button" onClick={exportRows} disabled={data.length === 0} className="rounded-lg bg-[#3f7f28] px-4 py-2.5 text-sm font-black text-white hover:bg-[#346a21] disabled:pointer-events-none disabled:opacity-50">
                XLSX Aktar
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
              <span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#0076b6] to-[#3f7f28]" />
              <h3 className="text-sm font-black text-slate-900">Kayıtlı Rapor Şablonları</h3>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex gap-2">
                <input
                  value={presetNameInput}
                  onChange={(event) => setPresetNameInput(event.target.value)}
                  placeholder="Şablon adı (ör. Aylık İptal Raporu)"
                  className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                />
                <button
                  type="button"
                  onClick={() => void savePreset()}
                  disabled={isSavingPreset}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3.5 py-2 text-[15px] font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isSavingPreset ? 'Kaydediliyor...' : 'Şu Anki Raporu Kaydet'}
                </button>
              </div>
              {presetStatus && (
                <p className={`text-xs font-bold ${presetStatus.includes('kaydedildi') ? 'text-emerald-700' : 'text-rose-600'}`}>{presetStatus}</p>
              )}

              <div className="max-h-80 space-y-2 overflow-auto">
                {presetsLoaded && presets.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs font-bold text-slate-400">
                    Henüz kayıtlı şablon yok. Bir rapor kurup yukarıdan kaydedebilirsiniz.
                  </p>
                )}
                {presets.map((preset) => (
                  <div key={preset.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-black text-slate-800">{preset.name}</p>
                      <p className="truncate text-[10px] font-semibold text-slate-400">
                        {preset.createdByUserName || 'Bilinmeyen'} - {new Date(preset.createdAt).toLocaleDateString('tr-TR')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => loadPreset(preset)} className="rounded-md bg-[#0076b6] px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-[#00649b]">
                        Yükle
                      </button>
                      <button type="button" onClick={() => void deletePreset(preset)} className="rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-rose-600 hover:bg-rose-50">
                        Sil
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {data.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
            Bu koşullara göre listelenecek kayıt bulunamadı.
          </div>
        ) : (
          <AdvancedTable
            key={tableKey}
            data={data}
            tableId={`ozel_rapor_${selectedSourceId}`}
            excludedColumns={['__rowid']}
            showRowNumber
            rowNumberStart={(currentPage - 1) * pageSize + 1}
            fileStatusColumns={isFileSource ? ['durumu', 'dosya_durumu', 'ddurumu'] : []}
            assistanceStatusColumns={isAssistanceSource ? ['durumu', 'yardim_durumu', 'ydurumu', 'dnm_durumu'] : []}
            assistanceStatusVariant={selectedSource && DGN_ASSISTANCE_TABLES.has(selectedSource.tableName) ? 'dgn' : 'default'}
            columnLabels={Object.fromEntries(columnLabelByValue)}
            filterValueOptions={filterValueOptions}
            serverSideFiltering
          />
        )}

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 print:hidden">
          <div className="text-xs font-bold text-slate-500">
            Sayfa {currentPage} / {totalPages} (Toplam {totalCount} kayıt)
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(buildPageUrl(searchParams, currentPage - 1))}
              disabled={currentPage <= 1}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Önceki
            </button>
            <button
              type="button"
              onClick={() => router.push(buildPageUrl(searchParams, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
