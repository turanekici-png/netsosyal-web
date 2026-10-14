'use client'

import { useCallback, useEffect, useState } from 'react'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import type { SahaIncelemeKaydi } from '@/lib/constants/sahaIncelemeForm'

type Props = {
  dosyaid: string | null
  canDelete: boolean
  // Ust bilesen yeni bir kayit eklediginde listeyi yenilemek icin artirilir.
  yenile?: number
  // Verilirse her kayitta "Düzenle" cikar - formu duzenlemek icin acar.
  onDuzenle?: (formId: string) => void
  duzenlenenId?: string | null
  // Kayit sayisi degisince bildirilir (Dosya Yönetimi sekme sayaci).
  onSayi?: (sayi: number) => void
  // Dosya Yönetimi sekmesinde daha buyuk yazi/bosluk.
  genis?: boolean
}

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

export const ACILIYET_SINIFLARI: Record<string, string> = {
  'Acil (0–72 saat)': 'border-rose-300 bg-rose-50 text-rose-700',
  'Acil': 'border-rose-300 bg-rose-50 text-rose-700',
  'Öncelikli': 'border-amber-300 bg-amber-50 text-amber-800',
  'Rutin değerlendirme': 'border-slate-300 bg-slate-50 text-slate-600',
}

function tarihGoster(tarih: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(tarih) ? tarih.slice(0, 10).split('-').reverse().join('.') : tarih
}

// Hane Ziyareti ve Sosyal Inceleme Formu - bir dosyanin kayitli formlari
// (salt-okunur liste + Yazdir/Sil). Yeni form doldurma SahaIncelemeFormModal'da.
export default function SahaIncelemeGecmisiPaneli({ dosyaid, canDelete, yenile = 0, onDuzenle, duzenlenenId, onSayi, genis = false }: Props) {
  const [formlar, setFormlar] = useState<SahaIncelemeKaydi[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    if (!dosyaid) {
      setFormlar([])
      onSayi?.(0)
      return
    }
    setIsLoading(true)
    setStatus('')
    try {
      const response = await fetch(`/api/documents/saha-inceleme?dosyaId=${encodeURIComponent(dosyaid)}`, { cache: 'no-store' })
      const payload = await response.json() as ApiResponse<SahaIncelemeKaydi[]>
      if (response.ok && payload.success && payload.data) {
        setFormlar(payload.data)
        onSayi?.(payload.data.length)
      }
      else setStatus(payload.error || 'Formlar yüklenemedi.')
    } catch {
      setStatus('Formlar yüklenemedi.')
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dosyaid])

  useEffect(() => { void load() }, [load, yenile])

  const sil = async (form: SahaIncelemeKaydi) => {
    if (!(await confirmDialog(`${tarihGoster(form.tarih)} tarihli inceleme formu silinsin mi? Bu işlem geri alınamaz.`))) return
    const response = await fetch(`/api/documents/saha-inceleme/${form.id}`, { method: 'DELETE' })
    const payload = await response.json() as ApiResponse<null>
    if (response.ok && payload.success) void load()
    else setStatus(payload.error || 'Form silinemedi.')
  }

  if (!dosyaid) return null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" />
      </div>
    )
  }

  // Dosya Yönetimi sekmesinde (genis) yazilar okunakli boyutta.
  const g = genis
    ? { baslik: 'text-[15px]', metin: 'text-[13px]', kucuk: 'text-[12px]', kart: 'p-3' }
    : { baslik: 'text-[12px]', metin: 'text-[11px]', kucuk: 'text-[10px]', kart: 'p-2' }

  return (
    <div className="space-y-1.5">
      {status && <div className={`rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 ${g.metin} font-bold text-rose-700`}>{status}</div>}
      {formlar.length === 0 ? (
        <div className={`rounded-lg border border-slate-200 bg-slate-50 py-5 text-center ${g.metin} font-bold text-slate-500`}>
          Bu dosya için kayıtlı inceleme formu yok.
        </div>
      ) : (
        formlar.map((form) => (
          <div key={form.id} className={`rounded-lg border border-slate-200 bg-white ${g.kart} shadow-sm`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className={`${g.baslik} font-black text-slate-900`}>
                  {tarihGoster(form.tarih)} — {form.personel || 'Personel belirtilmemiş'}
                  <span className={`ml-1.5 ${g.kucuk} font-bold text-slate-400`}>Form No: {form.id}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {form.ziyaretSonucu && (
                    <span className={`rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 ${g.kucuk} font-black text-sky-700`}>{form.ziyaretSonucu}</span>
                  )}
                  {form.aciliyet && (
                    <span className={`rounded-full border px-2 py-0.5 ${g.kucuk} font-black ${ACILIYET_SINIFLARI[form.aciliyet] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>Aciliyet: {form.aciliyet}</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {onDuzenle && (
                  duzenlenenId === form.id ? (
                    <span className={`rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 ${g.metin} font-black text-emerald-700`}>Düzenleniyor</span>
                  ) : (
                    <button type="button" onClick={() => onDuzenle(form.id)} className={`rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 ${g.metin} font-black text-sky-700 hover:bg-sky-100`}>
                      Düzenle
                    </button>
                  )
                )}
                <a
                  href={`/api/documents/saha-inceleme/yazdir?id=${form.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`rounded-md border border-slate-300 px-2.5 py-1 ${g.metin} font-black text-slate-600 hover:bg-slate-50`}
                >
                  Görüntüle / Yazdır
                </a>
                {canDelete && (
                  <button type="button" onClick={() => void sil(form)} className={`rounded-md border border-rose-200 px-2.5 py-1 ${g.metin} font-black text-rose-600 hover:bg-rose-50`}>
                    Sil
                  </button>
                )}
              </div>
            </div>
            {form.ozet && <p className={`mt-1.5 ${g.metin} font-semibold leading-snug text-slate-600`}>{form.ozet}</p>}
          </div>
        ))
      )}
    </div>
  )
}
