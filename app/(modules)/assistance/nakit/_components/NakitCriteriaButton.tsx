'use client'

import { useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { NAKIT_CRITERIA_CATALOG, NAKIT_CRITERIA_MAP, type CriterionTypeId } from '@/lib/nakitCriteria'

type CriterionRow = {
  key: string
  type: CriterionTypeId
  value: string
}

let rowKeySeed = 0
function nextRowKey() {
  rowKeySeed += 1
  return `criterion-${rowKeySeed}`
}

function firstCatalogType(): CriterionTypeId {
  return NAKIT_CRITERIA_CATALOG[0].id
}

export function NakitCriteriaButton() {
  const { addTab } = useTabs()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [rows, setRows] = useState<CriterionRow[]>([{ key: nextRowKey(), type: firstCatalogType(), value: '' }])
  const [error, setError] = useState('')

  const openModal = () => {
    setRows([{ key: nextRowKey(), type: firstCatalogType(), value: '' }])
    setError('')
    setIsModalOpen(true)
  }

  const closeModal = () => setIsModalOpen(false)

  const addRow = () => {
    const usedTypes = new Set(rows.map((row) => row.type))
    const nextType = NAKIT_CRITERIA_CATALOG.find((definition) => !usedTypes.has(definition.id))?.id
      ?? firstCatalogType()
    setRows([...rows, { key: nextRowKey(), type: nextType, value: '' }])
  }

  const removeRow = (key: string) => {
    setRows(rows.filter((row) => row.key !== key))
  }

  const updateRowType = (key: string, type: CriterionTypeId) => {
    setRows(rows.map((row) => (row.key === key ? { ...row, type, value: '' } : row)))
  }

  const updateRowValue = (key: string, value: string) => {
    setRows(rows.map((row) => (row.key === key ? { ...row, value } : row)))
  }

  const openReportTab = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    // Bos birakilan (deger girilmemis) sayisal kriter satirlari burada
    // sessizce elenir - kullaniciyi hataya zorlamadan sadece dolu olanlar
    // gonderilir. Rapor sayfasi ve sunucu tarafinda da ayni davranis
    // tekrarlanir (sanitizeCriteria, tek dogru kaynak: lib/nakitCriteria.ts).
    const criteria = rows
      .map((row) => {
        const definition = NAKIT_CRITERIA_MAP[row.type]
        if (definition.valueType === 'boolean') return { type: row.type }
        if (!row.value.trim()) return null
        const value = Number(row.value)
        if (!Number.isFinite(value)) return null
        return { type: row.type, value }
      })
      .filter((entry): entry is { type: CriterionTypeId; value?: number } => entry !== null)

    if (criteria.length === 0) {
      setError('En az bir kriter için değer giriniz.')
      return
    }

    const query = new URLSearchParams({ criteria: JSON.stringify(criteria) })
    addTab({ title: 'Kriter Sonuçları Raporu', path: `/assistance/nakit/kriter-sonuclari?${query.toString()}` })
    setIsModalOpen(false)
  }

  return (
    <>
      {/* Kullanici istegi (gorunum): eskiden ayri, aciklama metinli buyuk bir
          kart olarak gosteriliyordu - artik diger toplu islem butonlariyla
          AYNI satirda, sade/kompakt bir buton olarak gorunur. */}
      <button
        type="button"
        onClick={openModal}
        title="Bekleyen müracaatları girdiğiniz kriterlere göre toplu kontrol edin"
        className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-white px-3.5 py-2 text-xs font-black text-indigo-700 shadow-sm transition hover:bg-indigo-50 print:hidden"
      >
        <span aria-hidden className="text-sm leading-none">☑</span>
        Kriterleri Uygula
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <h3 className="text-base font-extrabold text-rose-700">Başvuru Kriterlerini Uygula</h3>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                  Kriterleri girip raporu açtığınızda hiçbir kayıt hemen değişmez - rapor sekmesinde onay verdikten sonra durum güncellenir.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
              >
                ✕
              </button>
            </div>

            <form onSubmit={openReportTab} className="space-y-4 p-5">
              <div className="max-h-[380px] space-y-3 overflow-y-auto pr-1">
                {rows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-xs font-bold text-slate-500">
                    Henüz kriter eklenmedi.
                  </div>
                ) : (
                  rows.map((row) => {
                    const definition = NAKIT_CRITERIA_MAP[row.type]
                    return (
                      <div key={row.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 space-y-2">
                            <select
                              value={row.type}
                              onChange={(event) => updateRowType(row.key, event.target.value as CriterionTypeId)}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold"
                            >
                              {NAKIT_CRITERIA_CATALOG.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                            {definition.valueType === 'number' ? (
                              <input
                                type="number"
                                min={definition.min}
                                max={definition.max}
                                value={row.value}
                                onChange={(event) => updateRowValue(row.key, event.target.value)}
                                placeholder={definition.placeholder}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                              />
                            ) : (
                              <p className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                                Bu kriter bir değer gerektirmez - eşleşen tüm müracaatlar işaretlenir.
                              </p>
                            )}
                            <p className="text-[11px] font-semibold text-slate-400">{definition.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeRow(row.key)}
                            className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                            title="Kriteri kaldır"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <button
                type="button"
                onClick={addRow}
                className="w-full rounded-lg border border-dashed border-rose-300 bg-rose-50/50 px-3 py-2 text-xs font-black text-rose-600 transition hover:bg-rose-100"
              >
                + Yeni Kriter Ekle
              </button>

              <p className="text-[11px] font-semibold text-slate-400">
                Değeri boş bırakılan kriterler uygulanmaz - sadece doldurduğunuz kriterler dikkate alınır.
              </p>

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-extrabold text-slate-600 transition hover:bg-slate-100"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-rose-600 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-rose-700"
                >
                  Rapor Sekmesinde Göster
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
