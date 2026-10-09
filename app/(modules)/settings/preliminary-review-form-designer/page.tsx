'use client'

import { useState, useEffect } from 'react'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  DEFAULT_PRELIMINARY_REVIEW_FORM_TEMPLATE,
  PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY,
  createEmptyPreliminaryReviewField,
  normalizePreliminaryReviewFieldType,
  type PreliminaryReviewField,
  type PreliminaryReviewFormTemplate,
} from '@/lib/constants/preliminaryReviewForm'

export const dynamic = 'force-dynamic'

interface SettingResponse<T> {
  success: boolean
  data?: {
    value?: T
  }
  error?: string
}

function isValidTemplate(value: unknown): value is PreliminaryReviewFormTemplate {
  return Array.isArray(value) && value.every((field) => (
    field && typeof field === 'object' && typeof (field as PreliminaryReviewField).id === 'string'
  ))
}

export default function PreliminaryReviewFormDesignerPage() {
  const [fields, setFields] = useState<PreliminaryReviewFormTemplate>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let isCancelled = false

    const loadTemplate = async () => {
      try {
        const response = await fetch(`/api/settings/${PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY}`, { cache: 'no-store' })
        const payload = await response.json() as SettingResponse<PreliminaryReviewFormTemplate>

        if (isCancelled) return

        if (response.ok && payload.success && isValidTemplate(payload.data?.value)) {
          setFields(payload.data!.value!)
        } else {
          setFields(DEFAULT_PRELIMINARY_REVIEW_FORM_TEMPLATE)
        }
      } catch {
        if (!isCancelled) setLoadError('Kayıtlı form yüklenemedi.')
        if (!isCancelled) setFields(DEFAULT_PRELIMINARY_REVIEW_FORM_TEMPLATE)
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void loadTemplate()
    return () => { isCancelled = true }
  }, [])

  const updateField = (fieldId: string, patch: Partial<PreliminaryReviewField>) => {
    setFields((current) => current.map((field) => (
      field.id === fieldId ? { ...field, ...patch } : field
    )))
  }

  const removeField = async (fieldId: string) => {
    if (!(await confirmDialog('Bu bilgiyi silmek istediğinize emin misiniz?'))) return
    setFields((current) => current.filter((field) => field.id !== fieldId))
  }

  const addField = () => {
    setFields((current) => [...current, createEmptyPreliminaryReviewField()])
  }

  const moveField = (fieldId: string, direction: -1 | 1) => {
    setFields((current) => {
      const index = current.findIndex((field) => field.id === fieldId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current

      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }

  const saveTemplate = async () => {
    setIsSaving(true)
    setStatus('')

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY,
          value: fields,
          type: 'json',
        }),
      })
      const payload = await response.json() as SettingResponse<PreliminaryReviewFormTemplate>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Ön inceleme formu kaydedilemedi.')
      }

      setStatus('Ön inceleme formu kaydedildi.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Ön inceleme formu kaydedilemedi.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-16">
      <div className="sticky top-0 z-20 border-b border-[#2A3B4D] bg-[#1E2A38] px-4 py-5 text-white shadow-md sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xl font-black uppercase tracking-wide text-white/70">Sistem Ayarları</p>
            <h1 className="text-2xl font-black uppercase tracking-wide">Ön İnceleme Formu Tasarımı</h1>
            <p className="mt-1 text-xl font-semibold text-white/80">
              Sorulacak bilgileri tanımlayın; her bilginin cevabı doldurulurken serbest metin olarak yazılır.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void saveTemplate()}
              disabled={isSaving || isLoading}
              className="rounded-lg bg-white px-5 py-3 text-xl font-black text-[#1E2A38] shadow-sm hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
            >
              {isSaving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-8">
        {loadError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xl font-bold text-amber-800">
            {loadError}
          </div>
        )}

        {status && (
          <div className={`rounded-lg border px-4 py-3 text-xl font-bold ${
            status.includes('kaydedildi')
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}>
            {status}
          </div>
        )}

        {!isLoading && fields.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xl font-bold text-slate-500">
            Henüz bilgi eklenmedi. Aşağıdan &ldquo;+ Yeni Bilgi Ekle&rdquo; ile başlayın.
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-600 border-t-transparent" />
          </div>
        ) : (
          <div className="rounded-xl border border-slate-300 bg-white shadow-sm">
            {fields.length > 0 && (
              <div className="grid grid-cols-[minmax(0,1fr)_210px_minmax(0,1fr)_150px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-lg font-black uppercase text-slate-400">
                <span>Bilgi</span>
                <span>Cevap Türü</span>
                <span>Örnek Cevap</span>
                <span />
              </div>
            )}
            <div className="divide-y divide-slate-200">
              {fields.map((field, index) => {
                const fieldType = normalizePreliminaryReviewFieldType(field)
                return (
                <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_210px_minmax(0,1fr)_150px] items-center gap-3 px-4 py-3">
                  <input
                    value={field.label}
                    onChange={(event) => updateField(field.id, { label: event.target.value })}
                    placeholder="Örnek: Araç Bilgisi"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38]"
                  />
                  <select
                    value={fieldType}
                    onChange={(event) => updateField(field.id, { fieldType: event.target.value === 'var_yok' ? 'var_yok' : 'metin' })}
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38]"
                  >
                    <option value="metin">Serbest Metin</option>
                    <option value="var_yok">Var / Yok</option>
                  </select>
                  {fieldType === 'var_yok' ? (
                    <div className="flex h-full w-full items-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xl font-semibold text-slate-400">
                      Doldururken &ldquo;Var&rdquo; / &ldquo;Yok&rdquo; seçilir
                    </div>
                  ) : (
                    <input
                      value={field.example}
                      onChange={(event) => updateField(field.id, { example: event.target.value })}
                      placeholder="Örnek: 1 adet araç var"
                      className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xl font-semibold text-slate-700 outline-none focus:border-[#1E2A38] focus:bg-white"
                    />
                  )}
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => moveField(field.id, -1)}
                      disabled={index === 0}
                      title="Yukarı taşı"
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-xl font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(field.id, 1)}
                      disabled={index === fields.length - 1}
                      title="Aşağı taşı"
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-xl font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      title="Sil"
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-rose-300 bg-white text-xl text-rose-500 hover:bg-rose-50"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )})}
            </div>
            <div className="border-t border-slate-200 p-3">
              <button
                type="button"
                onClick={addField}
                className="w-full rounded-lg border-2 border-dashed border-slate-300 bg-white py-3 text-xl font-black text-[#1E2A38] hover:bg-slate-50"
              >
                + Yeni Bilgi Ekle
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
