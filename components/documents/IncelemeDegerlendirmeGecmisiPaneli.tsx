'use client'

import { useCallback, useEffect, useState } from 'react'
import { getKararRenk, KARAR_RENK_SINIFLARI, type IncelemeDegerlendirmeFormRow } from '@/lib/constants/incelemeDegerlendirmeForm'

type Props = {
  dosyaid: string | null
  canApprove: boolean
}

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

const ONAY_ETIKETLERI: Record<string, string> = {
  beklemede: 'Onay Bekliyor',
  onaylandi: 'Onaylandı',
  reddedildi: 'Reddedildi',
  onay_gerekmiyor: 'Onay Gerekmiyor',
}

const ONAY_SINIFLARI: Record<string, string> = {
  beklemede: 'border-amber-300 bg-amber-50 text-amber-800',
  onaylandi: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  reddedildi: 'border-rose-300 bg-rose-50 text-rose-800',
  onay_gerekmiyor: 'border-slate-200 bg-slate-50 text-slate-500',
}

// "İnceleme Formu" modalinin ustunde acilir-kapanir "Geçmiş Formlar"
// bolumu icin salt-okunur liste (PDF/Excel indirme + onay/red aksiyonu
// haric) - yeni form doldurma burada YAPILMAZ, o islev disaridaki
// IncelemeDegerlendirmeFormModal'in kendisidir (dairesel import'tan
// kacinmak icin bu bilerek AYRI tutuldu).
export default function IncelemeDegerlendirmeGecmisiPaneli({ dosyaid, canApprove }: Props) {
  const [formlar, setFormlar] = useState<IncelemeDegerlendirmeFormRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    if (!dosyaid) {
      setFormlar([])
      return
    }
    setIsLoading(true)
    try {
      const response = await fetch(`/api/documents/inceleme-degerlendirme?dosyaId=${encodeURIComponent(dosyaid)}`, { cache: 'no-store' })
      const payload = await response.json() as ApiResponse<IncelemeDegerlendirmeFormRow[]>
      if (response.ok && payload.success && payload.data) {
        setFormlar(payload.data)
      } else {
        setStatus(payload.error || 'Formlar yüklenemedi.')
      }
    } catch {
      setStatus('Formlar yüklenemedi.')
    } finally {
      setIsLoading(false)
    }
  }, [dosyaid])

  useEffect(() => { void load() }, [load])

  const guncelleOnay = async (formId: string, onayDurumu: 'onaylandi' | 'reddedildi') => {
    const response = await fetch(`/api/documents/inceleme-degerlendirme/${formId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onayDurumu }),
    })
    const payload = await response.json() as ApiResponse<null>
    if (response.ok && payload.success) {
      void load()
    } else {
      setStatus(payload.error || 'Onay durumu güncellenemedi.')
    }
  }

  if (!dosyaid) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 py-10 text-[12px] font-bold text-slate-500">
        Önce bir dosya seçin.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {status && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-700">{status}</div>
      )}

      {formlar.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 py-8 text-center text-[12px] font-bold text-slate-500">
          Bu dosya için henüz Tahkikat Formu kaydı yok.
        </div>
      ) : (
        formlar.map((form) => {
          const kararRenk = form.eliminasyonSonucu === 'RED' ? 'kirmizi' : getKararRenk(form.toplamPuan)
          return (
            <div key={form.id} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-black text-slate-900">{form.tarih} — {form.personel || 'Personel belirtilmemiş'}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {form.eliminasyonSonucu === 'RED' ? (
                      <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase text-rose-700">Eleme: RED</span>
                    ) : (
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${KARAR_RENK_SINIFLARI[kararRenk]}`}>
                        {form.toplamPuan ?? '-'} / {form.maksimumPuan} — {form.karar}
                      </span>
                    )}
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${ONAY_SINIFLARI[form.onayDurumu]}`}>
                      {ONAY_ETIKETLERI[form.onayDurumu]}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <a href={`/api/documents/inceleme-degerlendirme/${form.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50">PDF</a>
                  <a href={`/api/documents/inceleme-degerlendirme/${form.id}/excel`} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50">Excel</a>
                  {canApprove && form.onayDurumu === 'beklemede' && (
                    <>
                      <button type="button" onClick={() => void guncelleOnay(form.id, 'onaylandi')} className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-black text-emerald-700 hover:bg-emerald-100">Onayla</button>
                      <button type="button" onClick={() => void guncelleOnay(form.id, 'reddedildi')} className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] font-black text-rose-700 hover:bg-rose-100">Reddet</button>
                    </>
                  )}
                </div>
              </div>
              {form.eliminasyonSonucu === 'RED' && form.eliminasyonRedNedeni && (
                <p className="mt-1.5 text-[11px] font-semibold text-rose-700">{form.eliminasyonRedNedeni}</p>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
