'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { NAKIT_CRITERIA_MAP, type CriterionTypeId, type SelectedCriterion } from '@/lib/nakitCriteria'

export const dynamic = 'force-dynamic'

type PreviewMatch = {
  id: string
  muracaateden: string | null
  tckimlikno: string | null
  donem: string | null
  reasons: string[]
}

function describeCriterion(criterion: SelectedCriterion) {
  const definition = NAKIT_CRITERIA_MAP[criterion.type as CriterionTypeId]
  if (!definition) return null
  if (definition.valueType === 'boolean') return definition.label
  if (criterion.value === undefined) return null
  return `${definition.label}: ${criterion.value}${definition.unit ? ` ${definition.unit}` : ''}`
}

function parseCriteriaFromParam(raw: string | null): SelectedCriterion[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is SelectedCriterion => (
      entry && typeof entry === 'object' && typeof entry.type === 'string' && entry.type in NAKIT_CRITERIA_MAP
    ))
  } catch {
    return []
  }
}

function KriterSonuclariContent() {
  const searchParams = useSearchParams()
  const criteria = useMemo(() => parseCriteriaFromParam(searchParams.get('criteria')), [searchParams])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkedCount, setCheckedCount] = useState(0)
  const [matches, setMatches] = useState<PreviewMatch[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isApplying, setIsApplying] = useState(false)
  const [updatedCount, setUpdatedCount] = useState<number | null>(null)

  useEffect(() => {
    let isCancelled = false

    async function loadPreview() {
      if (criteria.length === 0) {
        setError('Geçersiz veya eksik kriter bilgisi. Lütfen kriter penceresinden tekrar deneyin.')
        setIsLoading(false)
        return
      }

      try {
        const response = await fetch('/api/assistance/nakit/apply-criteria', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'preview', criteria }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Kriterler kontrol edilemedi.')
        }
        if (!isCancelled) {
          setCheckedCount(payload.data.checkedCount)
          setMatches(payload.data.matches)
          setSelectedIds(new Set(payload.data.matches.map((match: PreviewMatch) => match.id)))
          setError('')
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Kriterler kontrol edilemedi.')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void loadPreview()
    return () => { isCancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const toggleRow = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds((current) => (
      current.size === matches.length ? new Set() : new Set(matches.map((match) => match.id))
    ))
  }

  const applySelected = async () => {
    if (selectedIds.size === 0) return
    setError('')
    setIsApplying(true)
    try {
      const response = await fetch('/api/assistance/nakit/apply-criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apply', ids: Array.from(selectedIds) }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kriterler uygulanamadı.')
      }
      setUpdatedCount(payload.data.updatedCount)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kriterler uygulanamadı.')
    } finally {
      setIsApplying(false)
    }
  }

  const criteriaLabels = criteria.map(describeCriterion).filter((label): label is string => Boolean(label))

  return (
    <div className="space-y-5 text-slate-950">
      <div className="rounded-md border border-rose-300 bg-gradient-to-r from-rose-700 via-rose-600 to-orange-600 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[13px] font-black uppercase tracking-wide text-white/90">Nakit Yardımı Müracaatları</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">Kriter Sonuçları Raporu</h1>
            <p className="mt-1 text-sm font-bold text-white/85">
              Aşağıdaki kriterleri aşan müracaatlar &quot;Uygun Değil&quot; yapılmak üzere listelendi. Onay vermeden hiçbir kayıt değişmez.
            </p>
          </div>
          <div className="rounded-md border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold">
            Kontrol Edilen: {isLoading ? '...' : checkedCount}
          </div>
        </div>
        {criteriaLabels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {criteriaLabels.map((label) => (
              <span key={label} className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-xs font-bold">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
          Müracaatlar kontrol ediliyor...
        </div>
      ) : updatedCount !== null ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-8 text-center text-sm font-bold text-emerald-700 shadow-sm">
          {updatedCount} müracaat &quot;Uygun Değil&quot; olarak güncellendi. Bu sekmeyi kapatabilirsiniz.
        </div>
      ) : matches.length === 0 ? (
        !error && (
          <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
            Girilen kriterleri aşan bekleyen müracaat bulunamadı.
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-black uppercase text-slate-600">
                <input
                  type="checkbox"
                  checked={selectedIds.size === matches.length && matches.length > 0}
                  onChange={toggleAll}
                  className="h-4 w-4"
                />
                Tümünü Seç
              </label>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">
                {matches.length} müracaat kriterleri aşıyor
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                {selectedIds.size} seçili
              </span>
            </div>
            <button
              type="button"
              onClick={applySelected}
              disabled={isApplying || selectedIds.size === 0}
              className="rounded-md bg-rose-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isApplying ? 'Uygulanıyor...' : `Onayla ve Uygula (${selectedIds.size} kayıt)`}
            </button>
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-rose-50 text-xs font-extrabold uppercase text-rose-800">
                <tr>
                  <th className="border-b border-rose-100 px-3 py-2"></th>
                  <th className="border-b border-rose-100 px-3 py-2">Müracaat Eden</th>
                  <th className="border-b border-rose-100 px-3 py-2">TC No</th>
                  <th className="border-b border-rose-100 px-3 py-2">Dönem</th>
                  <th className="border-b border-rose-100 px-3 py-2">Aşılan Kriter(ler)</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <tr key={match.id} className="odd:bg-white even:bg-slate-50/60 hover:bg-rose-50/40">
                    <td className="border-b border-slate-100 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(match.id)}
                        onChange={() => toggleRow(match.id)}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold text-slate-900">{match.muracaateden || '-'}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{match.tckimlikno || '-'}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{match.donem || '-'}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-semibold text-rose-700">{match.reasons.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function KriterSonuclariPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm font-bold text-slate-500">Yükleniyor...</div>}>
      <KriterSonuclariContent />
    </Suspense>
  )
}
