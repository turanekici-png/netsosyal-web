'use client'

import { useTabs } from '@/lib/context/TabContext'

// Kullanici istegi (2026-10-15): Ön İnceleme / Tahkikat / Sonuç Bekleyen
// formlari ekrani kaplayan pencere yerine calisma alaninda AYRI BIR SEKMEDE
// (kendi renginde) acilsin - kullanici baska sekmeye gecip geri donebilsin,
// islem yarim kalmasin. Her dosyanin formu kendi sekmesidir (yol dosya
// id'sini icerir); yazilanlar tarayicida taslak olarak saklanir.

export type FormSekmesiTuru = 'on-inceleme' | 'tahkikat' | 'guncelleme'

const BASLIK: Record<FormSekmesiTuru, string> = {
  'on-inceleme': 'Ön İnceleme',
  tahkikat: 'Tahkikat',
  guncelleme: 'Sonuç',
}

const LISTE: Record<FormSekmesiTuru, { title: string; path: string }> = {
  'on-inceleme': { title: 'Ön İnceleme', path: '/workflow/on-inceleme' },
  tahkikat: { title: 'Tahkikat', path: '/workflow/tahkikat' },
  guncelleme: { title: 'Sonuç Bekleyen', path: '/workflow/guncelleme' },
}

export function formSekmesiYolu(tur: FormSekmesiTuru, fileId: string) {
  return `/workflow/${tur}/form/${encodeURIComponent(fileId)}`
}

export function formSekmesiBasligi(tur: FormSekmesiTuru, fileNo?: string | null) {
  return fileNo && fileNo !== '-' ? `${BASLIK[tur]} ${fileNo}` : BASLIK[tur]
}

const FORM_YOLU = /^\/workflow\/(on-inceleme|tahkikat|guncelleme)\/form\/([^/?#]+)/

// Sekme yolundan form turu (sekme rengi + benzersiz sekme anahtari icin).
export function formSekmesiTuru(path: string): FormSekmesiTuru | null {
  const match = FORM_YOLU.exec(String(path || '').split('?')[0])
  return match ? (match[1] as FormSekmesiTuru) : null
}

export function formSekmesiDosyaId(pathname: string): string | null {
  const match = FORM_YOLU.exec(pathname || '')
  return match ? decodeURIComponent(match[2]) : null
}

// Sekme renkleri: Sonuç Bekleyen mavi, Tahkikat turuncu, Ön İnceleme sari
// (İş Akışı menusundeki renklerle ayni).
export const FORM_SEKMESI_RENK: Record<FormSekmesiTuru, { aktif: string; pasif: string; nokta: string }> = {
  guncelleme: {
    aktif: 'border-blue-600 bg-blue-600 text-white shadow-[0_-1px_3px_rgba(29,78,216,0.35)]',
    pasif: 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100',
    nokta: 'bg-blue-500',
  },
  tahkikat: {
    aktif: 'border-orange-600 bg-orange-600 text-white shadow-[0_-1px_3px_rgba(234,88,12,0.35)]',
    pasif: 'border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100',
    nokta: 'bg-orange-500',
  },
  'on-inceleme': {
    aktif: 'border-amber-500 bg-amber-400 text-amber-950 shadow-[0_-1px_3px_rgba(217,119,6,0.35)]',
    pasif: 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100',
    nokta: 'bg-amber-500',
  },
}

// Formu sekmede acar (liste sayfalarindan).
export function useFormSekmesiAc() {
  const { addTab } = useTabs()
  return (tur: FormSekmesiTuru, fileId: string, fileNo?: string | null) => {
    addTab({ title: formSekmesiBasligi(tur, fileNo), path: formSekmesiYolu(tur, fileId) })
  }
}

// Aktif form sekmesini kapatir ve (istenirse) baska bir sekmeye gecer -
// varsayilan: o is akisinin listesi.
export function useFormSekmesiniKapat() {
  const { activeTabId, removeTab, addTab } = useTabs()
  return (tur: FormSekmesiTuru, sonra?: { title: string; path: string } | null) => {
    if (activeTabId) removeTab(activeTabId)
    const hedef = sonra === undefined ? LISTE[tur] : sonra
    if (hedef) addTab(hedef)
  }
}
