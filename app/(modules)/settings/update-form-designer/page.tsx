'use client'

import { useState, useEffect } from 'react'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  DEFAULT_UPDATE_FORM_TEMPLATE,
  UPDATE_FORM_TEMPLATE_SETTING_KEY,
  createEmptyUpdateFormOption,
  createEmptyUpdateFormSection,
  type UpdateFormSection,
  type UpdateFormTemplate,
} from '@/lib/constants/updateForm'

export const dynamic = 'force-dynamic'

interface SettingResponse<T> {
  success: boolean
  data?: {
    value?: T
  }
  error?: string
}

function isValidTemplate(value: unknown): value is UpdateFormTemplate {
  return Array.isArray(value) && value.every((section) => (
    section && typeof section === 'object' &&
    typeof (section as UpdateFormSection).id === 'string' &&
    Array.isArray((section as UpdateFormSection).options)
  ))
}

export default function UpdateFormDesignerPage() {
  const [sections, setSections] = useState<UpdateFormTemplate>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let isCancelled = false

    const loadTemplate = async () => {
      try {
        const response = await fetch(`/api/settings/${UPDATE_FORM_TEMPLATE_SETTING_KEY}`, { cache: 'no-store' })
        const payload = await response.json() as SettingResponse<UpdateFormTemplate>

        if (isCancelled) return

        if (response.ok && payload.success && isValidTemplate(payload.data?.value)) {
          setSections(payload.data!.value!)
        } else {
          setSections(DEFAULT_UPDATE_FORM_TEMPLATE)
        }
      } catch {
        if (!isCancelled) setLoadError('Kayıtlı form yüklenemedi.')
        if (!isCancelled) setSections(DEFAULT_UPDATE_FORM_TEMPLATE)
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void loadTemplate()
    return () => { isCancelled = true }
  }, [])

  const updateSection = (sectionId: string, patch: Partial<UpdateFormSection>) => {
    setSections((current) => current.map((section) => (
      section.id === sectionId ? { ...section, ...patch } : section
    )))
  }

  const removeSection = async (sectionId: string) => {
    if (!(await confirmDialog('Bu soruyu ve tüm cevaplarını silmek istediğinize emin misiniz?'))) return
    setSections((current) => current.filter((section) => section.id !== sectionId))
  }

  const addSection = () => {
    setSections((current) => [...current, createEmptyUpdateFormSection()])
  }

  const moveSection = (sectionId: string, direction: -1 | 1) => {
    setSections((current) => {
      const index = current.findIndex((section) => section.id === sectionId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current

      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }

  const updateOption = (sectionId: string, optionId: string, label: string) => {
    setSections((current) => current.map((section) => (
      section.id !== sectionId ? section : {
        ...section,
        options: section.options.map((option) => (
          option.id === optionId ? { ...option, label } : option
        )),
      }
    )))
  }

  const removeOption = (sectionId: string, optionId: string) => {
    setSections((current) => current.map((section) => (
      section.id !== sectionId ? section : {
        ...section,
        options: section.options.filter((option) => option.id !== optionId),
      }
    )))
  }

  const addOption = (sectionId: string) => {
    setSections((current) => current.map((section) => (
      section.id !== sectionId ? section : {
        ...section,
        options: [...section.options, createEmptyUpdateFormOption()],
      }
    )))
  }

  const saveTemplate = async () => {
    setIsSaving(true)
    setStatus('')

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: UPDATE_FORM_TEMPLATE_SETTING_KEY,
          value: sections,
          type: 'json',
        }),
      })
      const payload = await response.json() as SettingResponse<UpdateFormTemplate>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Güncelleme formu kaydedilemedi.')
      }

      setStatus('Güncelleme formu kaydedildi.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Güncelleme formu kaydedilemedi.')
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
            <h1 className="text-2xl font-black uppercase tracking-wide">Güncelleme Formu Tasarımı</h1>
            <p className="mt-1 text-xl font-semibold text-white/80">
              Dosya &ldquo;Ön İnceleme Yapılmış&rdquo; durumuna alınırken sorulacak soruları ve cevaplarını burada tanımlayın.
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

        {!isLoading && sections.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xl font-bold text-slate-500">
            Henüz soru eklenmedi. Bu form boş olduğu sürece, dosya &ldquo;Ön İnceleme Yapılmış&rdquo; durumuna
            alınırken herhangi bir form açılmaz; dosya durumu doğrudan güncellenir. En az bir soru
            eklediğinizde form otomatik olarak devreye girer.
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          </div>
        ) : (
          <>
            {sections.map((section, sectionIndex) => (
              <div key={section.id} className="rounded-xl border border-slate-300 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <label className="min-w-0 flex-1">
                    <span className="mb-1.5 block text-xl font-black uppercase text-slate-500">Soru Başlığı</span>
                    <input
                      value={section.title}
                      onChange={(event) => updateSection(section.id, { title: event.target.value })}
                      placeholder={`${sectionIndex + 1}. Soru başlığı yazın`}
                      className="w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38]"
                    />
                  </label>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => moveSection(section.id, -1)}
                      disabled={sectionIndex === 0}
                      title="Yukarı taşı"
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-xl font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(section.id, 1)}
                      disabled={sectionIndex === sections.length - 1}
                      title="Aşağı taşı"
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-xl font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSection(section.id)}
                      title="Soruyu sil"
                      className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-xl font-black text-rose-600 hover:bg-rose-100"
                    >
                      Soruyu Sil
                    </button>
                  </div>
                </div>

                <div className="space-y-3 px-5 py-4">
                  <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                    <label className="inline-flex items-center gap-2 text-xl font-black text-slate-600">
                      <input
                        type="checkbox"
                        checked={section.multiple}
                        onChange={(event) => updateSection(section.id, { multiple: event.target.checked })}
                        className="h-5 w-5 rounded border-slate-300 text-[#1E2A38]"
                      />
                      Birden fazla cevap işaretlenebilir
                    </label>
                    <input
                      value={section.note}
                      onChange={(event) => updateSection(section.id, { note: event.target.value })}
                      placeholder="Bu soru için isteğe bağlı açıklama / not"
                      className="w-full rounded-md border border-slate-300 bg-slate-50 px-4 py-2 text-xl font-semibold text-slate-700 outline-none focus:border-[#1E2A38] focus:bg-white"
                    />
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 px-1 text-lg font-black uppercase text-slate-400">Cevaplar</div>
                    <div className="space-y-1.5">
                      {section.options.map((option) => (
                        <div key={option.id} className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-2">
                          <input
                            value={option.label}
                            onChange={(event) => updateOption(section.id, option.id, event.target.value)}
                            placeholder="Cevap metni"
                            className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-xl font-semibold text-slate-900 outline-none focus:border-[#1E2A38]"
                          />
                          <button
                            type="button"
                            onClick={() => removeOption(section.id, option.id)}
                            disabled={section.options.length <= 1}
                            title="Cevabı sil"
                            className="flex h-10 w-10 items-center justify-center rounded-md border border-rose-300 bg-white text-xl text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => addOption(section.id)}
                      className="mt-2 w-full rounded-md border border-dashed border-slate-300 py-2 text-xl font-black text-slate-500 hover:border-[#1E2A38] hover:bg-white hover:text-[#1E2A38]"
                    >
                      + Cevap Ekle
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addSection}
              className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white py-4 text-xl font-black text-[#1E2A38] hover:bg-slate-50"
            >
              + Yeni Soru Ekle
            </button>
          </>
        )}
      </div>
    </div>
  )
}
