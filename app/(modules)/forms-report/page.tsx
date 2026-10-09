'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import { useTabs } from '@/lib/context/TabContext'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  UPDATE_FORM_TEMPLATE_SETTING_KEY,
  type UpdateFormTemplate,
} from '@/lib/constants/updateForm'
import {
  PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY,
  type PreliminaryReviewFormTemplate,
} from '@/lib/constants/preliminaryReviewForm'

export const dynamic = 'force-dynamic'

type GuncellemeFormuRecord = {
  id: string
  formTarihi: string | null
  cevaplar: Record<string, string | string[]>
  aciklama: string | null
  sonuc: string | null
  islemtarihi: string | null
}

type OnIncelemeRecord = {
  id: string
  tarih: string | null
  cevaplar: Record<string, string>
  aciklama: string | null
  sonuc: string | null
  islemtarihi: string | null
}

type IncelemeFormRecord = {
  id: string
  formTarihi: string | null
  toplamPuan: number | string | null
  otomatikSonuc: string | null
  sahaIncelemeOzeti: string | null
  ozelDurumGerekce: string | null
  komisyonKarari: string | null
  komisyonRaporu: string | null
  inceleyenAdSoyad: string | null
  yardimTurleri: string[]
  yardimSuresi: string | null
  komisyonOnay: string | null
  islemtarihi: string | null
}

interface ListResponse<T> {
  success: boolean
  data?: T[]
  error?: string
}

interface SettingResponse<T> {
  success: boolean
  data?: { value?: T }
  error?: string
}

type TabId = 'guncelleme' | 'onInceleme' | 'inceleme'

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function toInputDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

// Guncelleme Formu'ndaki secenek id'lerini okunabilir etiketlere cevirir.
function resolveUpdateFormAnswers(template: UpdateFormTemplate, cevaplar: Record<string, string | string[]>) {
  return template
    .map((section) => {
      const selected = cevaplar[section.id]
      const selectedIds = Array.isArray(selected) ? selected : selected ? [selected] : []
      const labels = selectedIds
        .map((optionId) => section.options.find((option) => option.id === optionId)?.label)
        .filter((label): label is string => Boolean(label))
      return { title: section.title, labels }
    })
    .filter((item) => item.labels.length > 0)
}

// Formun sonucuna gore rozet rengini belirler: "uygun degil / iptal" gibi olumsuz
// sonuclar kirmizi, "ön inceleme/tahkikata gönderildi" gibi ileri tasima sonuclari
// yesil gösterilir - boylece ayni "sonuc" alani, olumlu/olumsuz oldugunu renkle de
// anlatir (sadece metinle degil).
function getSonucBadgeClass(sonuc: string) {
  const normalized = sonuc
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')

  if (normalized.includes('uygun degil') || normalized.includes('iptal')) {
    return 'bg-rose-600'
  }

  return 'bg-emerald-600'
}

function resolvePreliminaryReviewAnswers(template: PreliminaryReviewFormTemplate, cevaplar: Record<string, string>) {
  return template
    .map((field) => ({ label: field.label || 'Bilgi', value: cevaplar[field.id] }))
    .filter((item): item is { label: string; value: string } => Boolean(item.value))
}

const TABS: Array<{ id: TabId; label: string; accent: 'indigo' | 'amber' | 'teal' }> = [
  { id: 'guncelleme', label: 'Güncelleme Formu', accent: 'indigo' },
  { id: 'onInceleme', label: 'Ön İnceleme Formu', accent: 'amber' },
  { id: 'inceleme', label: 'Tahkikat Formu', accent: 'teal' },
]

const TAB_ACCENT_CLASSES: Record<'indigo' | 'amber' | 'teal', { active: string; inactive: string }> = {
  indigo: { active: 'border-indigo-600 bg-indigo-600 text-white', inactive: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
  amber: { active: 'border-amber-600 bg-amber-600 text-white', inactive: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' },
  teal: { active: 'border-teal-600 bg-teal-600 text-white', inactive: 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100' },
}

const RECORD_CARD_CLASSES: Record<'indigo' | 'amber' | 'teal', { border: string; headerBorder: string; headerBg: string; headerText: string; headerSubText: string; boxBorder: string; boxBg: string; labelText: string; solidBg: string; buttonBorder: string; buttonText: string; buttonHover: string }> = {
  indigo: {
    border: 'border-indigo-200',
    headerBorder: 'border-indigo-100',
    headerBg: 'bg-indigo-50',
    headerText: 'text-indigo-900',
    headerSubText: 'text-indigo-600',
    boxBorder: 'border-indigo-100',
    boxBg: 'bg-indigo-50/60',
    labelText: 'text-indigo-500',
    solidBg: 'bg-indigo-600',
    buttonBorder: 'border-indigo-600',
    buttonText: 'text-indigo-700',
    buttonHover: 'hover:bg-indigo-50',
  },
  amber: {
    border: 'border-amber-200',
    headerBorder: 'border-amber-100',
    headerBg: 'bg-amber-50',
    headerText: 'text-amber-900',
    headerSubText: 'text-amber-600',
    boxBorder: 'border-amber-100',
    boxBg: 'bg-amber-50/60',
    labelText: 'text-amber-600',
    solidBg: 'bg-amber-600',
    buttonBorder: 'border-amber-600',
    buttonText: 'text-amber-700',
    buttonHover: 'hover:bg-amber-50',
  },
  teal: {
    border: 'border-teal-200',
    headerBorder: 'border-teal-100',
    headerBg: 'bg-teal-50',
    headerText: 'text-teal-900',
    headerSubText: 'text-teal-600',
    boxBorder: 'border-teal-100',
    boxBg: 'bg-teal-50/60',
    labelText: 'text-teal-600',
    solidBg: 'bg-teal-600',
    buttonBorder: 'border-teal-600',
    buttonText: 'text-teal-700',
    buttonHover: 'hover:bg-teal-50',
  },
}

function FormsReportContent() {
  const searchParams = useSearchParams()
  const { addTab } = useTabs()
  const fileId = searchParams.get('fileId') || ''
  const cardNo = searchParams.get('cardNo') || ''
  const name = searchParams.get('name') || ''

  const [activeTab, setActiveTab] = useState<TabId>('guncelleme')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionStatus, setActionStatus] = useState<'idle' | 'busy'>('idle')

  const [updateFormTemplate, setUpdateFormTemplate] = useState<UpdateFormTemplate>([])
  const [guncellemeRecords, setGuncellemeRecords] = useState<GuncellemeFormuRecord[]>([])
  const [preliminaryReviewFields, setPreliminaryReviewFields] = useState<PreliminaryReviewFormTemplate>([])
  const [onIncelemeRecords, setOnIncelemeRecords] = useState<OnIncelemeRecord[]>([])
  const [incelemeRecords, setIncelemeRecords] = useState<IncelemeFormRecord[]>([])

  const [editingGuncellemeId, setEditingGuncellemeId] = useState<string | null>(null)
  const [editGuncellemeAnswers, setEditGuncellemeAnswers] = useState<Record<string, string | string[]>>({})
  const [editGuncellemeDescription, setEditGuncellemeDescription] = useState('')
  const [editGuncellemeDate, setEditGuncellemeDate] = useState('')

  const [editingOnIncelemeId, setEditingOnIncelemeId] = useState<string | null>(null)
  const [editOnIncelemeAnswers, setEditOnIncelemeAnswers] = useState<Record<string, string>>({})
  const [editOnIncelemeDescription, setEditOnIncelemeDescription] = useState('')
  const [editOnIncelemeDate, setEditOnIncelemeDate] = useState('')

  useEffect(() => {
    if (!fileId) {
      setError('Dosya bilgisi bulunamadı.')
      setIsLoading(false)
      return
    }

    let isCancelled = false
    setIsLoading(true)
    setError('')

    Promise.all([
      fetch(`/api/settings/${UPDATE_FORM_TEMPLATE_SETTING_KEY}`, { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch(`/api/documents/guncelleme-formu?dosyaId=${encodeURIComponent(fileId)}`, { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch(`/api/settings/${PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY}`, { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch(`/api/workflow/on-inceleme/report?fileId=${encodeURIComponent(fileId)}`, { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch(`/api/documents/inceleme-formu?dosyaId=${encodeURIComponent(fileId)}`, { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
    ]).then(([updateTemplatePayload, guncellemePayload, preliminaryTemplatePayload, onIncelemePayload, incelemePayload]: [
      SettingResponse<UpdateFormTemplate> | null,
      ListResponse<GuncellemeFormuRecord> | null,
      SettingResponse<PreliminaryReviewFormTemplate> | null,
      ListResponse<OnIncelemeRecord> | null,
      ListResponse<IncelemeFormRecord> | null,
    ]) => {
      if (isCancelled) return

      if (updateTemplatePayload?.success && Array.isArray(updateTemplatePayload.data?.value)) {
        setUpdateFormTemplate(updateTemplatePayload.data!.value!)
      }
      if (guncellemePayload?.success && Array.isArray(guncellemePayload.data)) {
        setGuncellemeRecords(guncellemePayload.data)
      }
      if (preliminaryTemplatePayload?.success && Array.isArray(preliminaryTemplatePayload.data?.value)) {
        setPreliminaryReviewFields(preliminaryTemplatePayload.data!.value!)
      }
      if (onIncelemePayload?.success && Array.isArray(onIncelemePayload.data)) {
        setOnIncelemeRecords(onIncelemePayload.data)
      }
      if (incelemePayload?.success && Array.isArray(incelemePayload.data)) {
        setIncelemeRecords(incelemePayload.data)
      }
      setIsLoading(false)
    }).catch((err) => {
      if (isCancelled) return
      setError(err instanceof Error ? err.message : 'Formlar yüklenirken hata oluştu.')
      setIsLoading(false)
    })

    return () => {
      isCancelled = true
    }
  }, [fileId])

  const tabCounts = useMemo(() => ({
    guncelleme: guncellemeRecords.length,
    onInceleme: onIncelemeRecords.length,
    inceleme: incelemeRecords.length,
  }), [guncellemeRecords, onIncelemeRecords, incelemeRecords])

  const returnToFile = () => {
    const query = new URLSearchParams()
    if (fileId) query.set('fileId', fileId)
    else if (cardNo) query.set('search', cardNo)

    addTab({
      title: cardNo ? `Dosya ${cardNo}` : 'Dosya Ara',
      path: query.toString() ? `/documents?${query.toString()}` : '/documents',
    })
  }

  // --- Guncelleme Formu: duzenle / sil ---
  const startEditGuncelleme = (record: GuncellemeFormuRecord) => {
    setEditingGuncellemeId(record.id)
    setEditGuncellemeAnswers(record.cevaplar)
    setEditGuncellemeDescription(record.aciklama || '')
    setEditGuncellemeDate(toInputDate(record.formTarihi))
    setActionError('')
  }

  const cancelEditGuncelleme = () => setEditingGuncellemeId(null)

  const toggleEditGuncellemeAnswer = (sectionId: string, optionId: string, multiple: boolean) => {
    setEditGuncellemeAnswers((current) => {
      if (!multiple) return { ...current, [sectionId]: optionId }
      const currentValue = current[sectionId]
      const selectedIds = Array.isArray(currentValue) ? currentValue : []
      const nextIds = selectedIds.includes(optionId)
        ? selectedIds.filter((id) => id !== optionId)
        : [...selectedIds, optionId]
      return { ...current, [sectionId]: nextIds }
    })
  }

  const saveGuncellemeEdit = async () => {
    if (!editingGuncellemeId) return
    setActionStatus('busy')
    setActionError('')
    try {
      const response = await fetch('/api/documents/guncelleme-formu', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingGuncellemeId,
          formTarihi: editGuncellemeDate,
          aciklama: editGuncellemeDescription,
          cevaplar: editGuncellemeAnswers,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Form güncellenemedi.')

      setGuncellemeRecords((current) => current.map((record) => (
        record.id === editingGuncellemeId ? { ...record, ...payload.data } : record
      )))
      setEditingGuncellemeId(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Form güncellenemedi.')
    } finally {
      setActionStatus('idle')
    }
  }

  const deleteGuncelleme = async (id: string) => {
    if (!(await confirmDialog('Bu Güncelleme Formu kaydını silmek istediğinize emin misiniz?'))) return
    setActionStatus('busy')
    setActionError('')
    try {
      const response = await fetch(`/api/documents/guncelleme-formu?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Form silinemedi.')
      setGuncellemeRecords((current) => current.filter((record) => record.id !== id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Form silinemedi.')
    } finally {
      setActionStatus('idle')
    }
  }

  // --- On Inceleme Formu: duzenle / sil ---
  const startEditOnInceleme = (record: OnIncelemeRecord) => {
    setEditingOnIncelemeId(record.id)
    setEditOnIncelemeAnswers(record.cevaplar)
    setEditOnIncelemeDescription(record.aciklama || '')
    setEditOnIncelemeDate(toInputDate(record.tarih))
    setActionError('')
  }

  const cancelEditOnInceleme = () => setEditingOnIncelemeId(null)

  const saveOnIncelemeEdit = async () => {
    if (!editingOnIncelemeId) return
    setActionStatus('busy')
    setActionError('')
    try {
      const response = await fetch('/api/workflow/on-inceleme/report', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingOnIncelemeId,
          date: editOnIncelemeDate,
          aciklama: editOnIncelemeDescription,
          cevaplar: editOnIncelemeAnswers,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Rapor güncellenemedi.')

      setOnIncelemeRecords((current) => current.map((record) => (
        record.id === editingOnIncelemeId
          ? { ...record, tarih: editOnIncelemeDate, cevaplar: editOnIncelemeAnswers, aciklama: editOnIncelemeDescription }
          : record
      )))
      setEditingOnIncelemeId(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Rapor güncellenemedi.')
    } finally {
      setActionStatus('idle')
    }
  }

  const deleteOnInceleme = async (id: string) => {
    if (!(await confirmDialog('Bu Ön İnceleme Formu kaydını silmek istediğinize emin misiniz?'))) return
    setActionStatus('busy')
    setActionError('')
    try {
      const response = await fetch(`/api/workflow/on-inceleme/report?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Rapor silinemedi.')
      setOnIncelemeRecords((current) => current.filter((record) => record.id !== id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Rapor silinemedi.')
    } finally {
      setActionStatus('idle')
    }
  }

  // --- Inceleme Formu: duzenle (dosyaya donup formu acar) / sil ---
  const editIncelemeRecord = (record: IncelemeFormRecord) => {
    if (!fileId) return
    sessionStorage.setItem('netsosyal:inceleme-formu-edit-request', record.id)
    sessionStorage.setItem('netsosyal:inceleme-formu-edit-fileid', fileId)
    addTab({
      title: cardNo ? `İnceleme ${cardNo}` : 'Tahkikat Formu',
      path: `/documents?fileId=${encodeURIComponent(fileId)}`,
    })
  }

  const deleteInceleme = async (id: string) => {
    if (!(await confirmDialog('Bu Tahkikat Formu kaydını silmek istediğinize emin misiniz?'))) return
    setActionStatus('busy')
    setActionError('')
    try {
      const response = await fetch(`/api/documents/inceleme-formu?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Form silinemedi.')
      setIncelemeRecords((current) => current.filter((record) => record.id !== id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Form silinemedi.')
    } finally {
      setActionStatus('idle')
    }
  }

  return (
    <div className="space-y-6 p-4 text-slate-950 sm:p-6">
      <div className="rounded-lg border border-[#8fd167] bg-gradient-to-r from-[#087fb2] via-[#309690] to-[#6fb744] px-5 py-4 text-white shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-wide text-white/80">Dosya İşlemleri</p>
            <h1 className="text-2xl font-black leading-tight tracking-normal text-white md:text-[28px]">Formlar</h1>
            <p className="mt-1 text-sm font-black text-white">
              {cardNo || fileId || 'Dosya bilgisi yok'}{name ? ` - ${name}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" onClick={returnToFile} className={reportHeaderGhostButton}>
              ← Dosyaya Dön
            </button>
            <button type="button" className={reportHeaderGhostButton} onClick={() => window.print()}>
              Yazdır (Ctrl+P)
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
      )}
      {actionError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{actionError}</div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            const accent = TAB_ACCENT_CLASSES[tab.accent]
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md border px-3 py-2 text-sm font-black transition-colors ${isActive ? accent.active : accent.inactive}`}
              >
                {tab.label} ({tabCounts[tab.id]})
              </button>
            )
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0076b6] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-3">
          {activeTab === 'guncelleme' && (
            guncellemeRecords.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
                Bu dosya için kayıtlı Güncelleme Formu bulunamadı.
              </div>
            ) : guncellemeRecords.map((record) => {
              const accent = RECORD_CARD_CLASSES.indigo
              const isEditing = editingGuncellemeId === record.id

              if (isEditing) {
                return (
                  <div key={record.id} className={`rounded-lg border-2 bg-white shadow-sm ${accent.border}`}>
                    <div className={`flex items-center justify-between border-b px-4 py-2.5 ${accent.headerBorder} ${accent.headerBg}`}>
                      <span className={`text-sm font-black ${accent.headerText}`}>Düzenleniyor</span>
                      <input
                        type="date"
                        value={editGuncellemeDate}
                        onChange={(event) => setEditGuncellemeDate(event.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="space-y-3 p-4">
                      {updateFormTemplate.map((section) => {
                        const selected = editGuncellemeAnswers[section.id]
                        const selectedIds = Array.isArray(selected) ? selected : selected ? [selected] : []
                        return (
                          <div key={section.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="mb-2 text-xs font-black uppercase text-slate-600">{section.title}</div>
                            <div className="space-y-1.5">
                              {section.options.map((option) => (
                                <label key={option.id} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                  <input
                                    type={section.multiple ? 'checkbox' : 'radio'}
                                    name={`edit-guncelleme-${record.id}-${section.id}`}
                                    checked={selectedIds.includes(option.id)}
                                    onChange={() => toggleEditGuncellemeAnswer(section.id, option.id, section.multiple)}
                                  />
                                  {option.label}
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-extrabold uppercase text-slate-600">Açıklama</span>
                        <textarea
                          value={editGuncellemeDescription}
                          onChange={(event) => setEditGuncellemeDescription(event.target.value)}
                          rows={3}
                          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                        />
                      </label>
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={cancelEditGuncelleme} disabled={actionStatus === 'busy'} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-60">Vazgeç</button>
                        <button type="button" onClick={() => void saveGuncellemeEdit()} disabled={actionStatus === 'busy'} className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">
                          {actionStatus === 'busy' ? 'Kaydediliyor...' : 'Kaydet'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              }

              const resolved = resolveUpdateFormAnswers(updateFormTemplate, record.cevaplar)
              return (
                <div key={record.id} className={`rounded-lg border-2 bg-white shadow-sm ${accent.border}`}>
                  <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 ${accent.headerBorder} ${accent.headerBg}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-black ${accent.headerText}`}>{formatDate(record.formTarihi)}</span>
                      <span className={`text-xs font-bold ${accent.headerSubText}`}>{formatDateTime(record.islemtarihi)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {record.sonuc && (
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black text-white ${getSonucBadgeClass(record.sonuc)}`}>{record.sonuc}</span>
                      )}
                      <button type="button" onClick={() => startEditGuncelleme(record)} className={`rounded-md border bg-white px-2.5 py-1 text-[11px] font-black ${accent.buttonBorder} ${accent.buttonText} ${accent.buttonHover}`}>Düzenle</button>
                      <button type="button" onClick={() => void deleteGuncelleme(record.id)} className="rounded-md border border-rose-600 bg-white px-2.5 py-1 text-[11px] font-black text-rose-700 hover:bg-rose-50">Sil</button>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    {resolved.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {resolved.map((item) => (
                          <div key={item.title} className={`rounded-md border px-3 py-2 ${accent.boxBorder} ${accent.boxBg}`}>
                            <div className={`text-[10px] font-black uppercase ${accent.labelText}`}>{item.title}</div>
                            <div className="text-sm font-bold text-slate-800">{item.labels.join(', ')}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-slate-500">İşaretlenmiş bir cevap bulunamadı.</p>
                    )}
                    {record.aciklama && (
                      <div className={`rounded-md border px-3 py-2 ${accent.boxBorder} ${accent.boxBg}`}>
                        <div className={`text-[10px] font-black uppercase ${accent.labelText}`}>Açıklama</div>
                        <p className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{record.aciklama}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}

          {activeTab === 'onInceleme' && (
            onIncelemeRecords.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
                Bu dosya için kayıtlı Ön İnceleme Formu bulunamadı.
              </div>
            ) : onIncelemeRecords.map((record) => {
              const accent = RECORD_CARD_CLASSES.amber
              const isEditing = editingOnIncelemeId === record.id

              if (isEditing) {
                return (
                  <div key={record.id} className={`rounded-lg border-2 bg-white shadow-sm ${accent.border}`}>
                    <div className={`flex items-center justify-between border-b px-4 py-2.5 ${accent.headerBorder} ${accent.headerBg}`}>
                      <span className={`text-sm font-black ${accent.headerText}`}>Düzenleniyor</span>
                      <input
                        type="date"
                        value={editOnIncelemeDate}
                        onChange={(event) => setEditOnIncelemeDate(event.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-900 outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="space-y-3 p-4">
                      {preliminaryReviewFields.map((field) => (
                        <label key={field.id} className="flex flex-col gap-1.5">
                          <span className="text-xs font-extrabold uppercase text-slate-600">{field.label || 'Bilgi'}</span>
                          <input
                            type="text"
                            value={editOnIncelemeAnswers[field.id] ?? ''}
                            onChange={(event) => setEditOnIncelemeAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-amber-500"
                          />
                        </label>
                      ))}
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-extrabold uppercase text-slate-600">Açıklama</span>
                        <textarea
                          value={editOnIncelemeDescription}
                          onChange={(event) => setEditOnIncelemeDescription(event.target.value)}
                          rows={3}
                          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-amber-500"
                        />
                      </label>
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={cancelEditOnInceleme} disabled={actionStatus === 'busy'} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-60">Vazgeç</button>
                        <button type="button" onClick={() => void saveOnIncelemeEdit()} disabled={actionStatus === 'busy'} className="rounded-md bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60">
                          {actionStatus === 'busy' ? 'Kaydediliyor...' : 'Kaydet'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              }

              const resolved = resolvePreliminaryReviewAnswers(preliminaryReviewFields, record.cevaplar)
              return (
                <div key={record.id} className={`rounded-lg border-2 bg-white shadow-sm ${accent.border}`}>
                  <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 ${accent.headerBorder} ${accent.headerBg}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-black ${accent.headerText}`}>{formatDate(record.tarih)}</span>
                      <span className={`text-xs font-bold ${accent.headerSubText}`}>{formatDateTime(record.islemtarihi)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {record.sonuc && (
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black text-white ${getSonucBadgeClass(record.sonuc)}`}>{record.sonuc}</span>
                      )}
                      <button type="button" onClick={() => startEditOnInceleme(record)} className={`rounded-md border bg-white px-2.5 py-1 text-[11px] font-black ${accent.buttonBorder} ${accent.buttonText} ${accent.buttonHover}`}>Düzenle</button>
                      <button type="button" onClick={() => void deleteOnInceleme(record.id)} className="rounded-md border border-rose-600 bg-white px-2.5 py-1 text-[11px] font-black text-rose-700 hover:bg-rose-50">Sil</button>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    {resolved.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {resolved.map((item) => (
                          <div key={item.label} className={`rounded-md border px-3 py-2 ${accent.boxBorder} ${accent.boxBg}`}>
                            <div className={`text-[10px] font-black uppercase ${accent.labelText}`}>{item.label}</div>
                            <div className="text-sm font-bold text-slate-800">{item.value}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-slate-500">Bu formda yazılmış bir cevap bulunamadı.</p>
                    )}
                    {record.aciklama && (
                      <div className={`rounded-md border px-3 py-2 ${accent.boxBorder} ${accent.boxBg}`}>
                        <div className={`text-[10px] font-black uppercase ${accent.labelText}`}>Açıklama</div>
                        <p className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{record.aciklama}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}

          {activeTab === 'inceleme' && (
            incelemeRecords.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
                Bu dosya için kayıtlı Tahkikat Formu bulunamadı.
              </div>
            ) : incelemeRecords.map((record) => (
              <div key={record.id} className="rounded-lg border-2 border-teal-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 bg-teal-50 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-teal-900">{formatDate(record.formTarihi)}</span>
                    <span className="rounded-full bg-teal-600 px-3 py-1 text-xs font-black text-white">
                      {record.toplamPuan ?? 0} / 100
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => editIncelemeRecord(record)} className="rounded-md border border-teal-600 bg-white px-2.5 py-1 text-[11px] font-black text-teal-700 hover:bg-teal-50">Düzenle</button>
                    <button type="button" onClick={() => void deleteInceleme(record.id)} className="rounded-md border border-rose-600 bg-white px-2.5 py-1 text-[11px] font-black text-rose-700 hover:bg-rose-50">Sil</button>
                  </div>
                </div>
                <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2">
                    <div className="text-[10px] font-black uppercase text-teal-600">Otomatik Sonuç</div>
                    <div className="text-sm font-bold text-slate-800">{record.otomatikSonuc || '-'}</div>
                  </div>
                  <div className="rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2">
                    <div className="text-[10px] font-black uppercase text-teal-600">İncelemeyi Yapan</div>
                    <div className="text-sm font-bold text-slate-800">{record.inceleyenAdSoyad || '-'}</div>
                  </div>
                  {record.komisyonKarari && (
                    <div className="rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2">
                      <div className="text-[10px] font-black uppercase text-teal-600">İncelemeci Kararı</div>
                      <div className="text-sm font-bold text-slate-800">{record.komisyonKarari}</div>
                    </div>
                  )}
                  {record.yardimTurleri?.length > 0 && (
                    <div className="rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2">
                      <div className="text-[10px] font-black uppercase text-teal-600">Yardım Türleri</div>
                      <div className="text-sm font-bold text-slate-800">{record.yardimTurleri.join(', ')}</div>
                    </div>
                  )}
                  {record.sahaIncelemeOzeti && (
                    <div className="rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2 sm:col-span-2">
                      <div className="text-[10px] font-black uppercase text-teal-600">Saha İnceleme Özeti</div>
                      <p className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{record.sahaIncelemeOzeti}</p>
                    </div>
                  )}
                  {record.komisyonRaporu && (
                    <div className="rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2 sm:col-span-2">
                      <div className="text-[10px] font-black uppercase text-teal-600">Komisyon Raporu</div>
                      <p className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{record.komisyonRaporu}</p>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function FormsReportPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm font-bold text-slate-500">Formlar hazırlanıyor...</div>}>
      <FormsReportContent />
    </Suspense>
  )
}
