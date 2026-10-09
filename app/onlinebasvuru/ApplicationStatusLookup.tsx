'use client'

import { useState } from 'react'
import { BirthDateTextInput } from '../online/BirthDateTextInput'

type ApplicationStatusResult = {
  id: string
  date: string | null
  name: string | null
  assistanceType: string
  period: string
  stage: string
  note: string
}

function formatStatusDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('tr-TR')
}

// Kullanici istegi (14 Eylul 2026, 5. tur -> 18. tur): "başvuru sorgulama
// ekranı /onlinebasvuru sayfasında olsun" (5. tur) + "bu alanı daha renkli
// ve ustte bir butonla acilir sekilde yap, vatandas diger aktif basvurularla
// karistirmasin" (11. tur) + "basvuru alanlari VE sorgulama alani ucu de
// yan yana, AYNI boyutta ve hizali olsun" (18. tur). Bu yuzden: (a) mavi
// "Başvuru Yap" kartlarindan BILINCLI olarak FARKLI bir renk tonu (menekse/
// violet) kullanildi, (b) KAPALI haldeki tetikleyici artik sayfadaki diger
// "Başvuru Yap" kartlarinin BIREBIR AYNI yapisinda (gorsel alani + baslik +
// aciklama + buton) bir kart - page.tsx'teki AYNI grid'e (form kartlariyla
// ayni sm:/lg: sutun kurallari) yerlestirilince otomatik olarak ayni boyut/
// hiza elde ediliyor (CSS grid varsayilan "stretch" davranisi). Acildiginda
// panel bu KARTIN ALTINDA (kendi grid hucresi icinde) genisler - diger
// kartlarin boyutunu ETKİLEMEZ.
export function ApplicationStatusLookup() {
  const [isOpen, setIsOpen] = useState(false)
  const [tc, setTc] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [lookupMessage, setLookupMessage] = useState('')
  const [results, setResults] = useState<ApplicationStatusResult[]>([])

  const lookupApplicationStatus = async () => {
    const cleanTc = tc.replace(/\D/g, '').slice(0, 11)
    if (cleanTc.length !== 11) {
      setLookupState('error')
      setLookupMessage('TC Kimlik No 11 haneli olmalıdır.')
      setResults([])
      return
    }

    if (!birthDate) {
      setLookupState('error')
      setLookupMessage('Doğum tarihi zorunludur.')
      setResults([])
      return
    }

    setLookupState('loading')
    setLookupMessage('Başvurular sorgulanıyor...')
    setResults([])

    try {
      const response = await fetch('/api/online-applications/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tc: cleanTc, birthDate }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Başvuru durumu sorgulanamadı.')
      }

      const items = Array.isArray(payload.data) ? payload.data as ApplicationStatusResult[] : []
      setResults(items)
      setLookupState('success')
      setLookupMessage(items.length > 0 ? `${items.length} başvuru bulundu.` : 'Bu TC kimlik no ile kayıtlı başvuru bulunamadı.')
    } catch (error) {
      setLookupState('error')
      setLookupMessage(error instanceof Error ? error.message : 'Başvuru durumu sorgulanamadı.')
    }
  }

  return (
    // Kullanici istegi (19. tur): "tarih/donem/asama/aciklama yan yana
    // gorunsun" - bu, kartin normal (kapali) genisliginde (4 sutunlu
    // grid'in 1 hucresi, ~270px) SIGMAZ. Bu yuzden acilinca bu hucre
    // "col-span-full" olup TUM satiri kaplar (bkz. page.tsx'teki grid) -
    // digerlerinin boyutu ETKİLENMEZ, kapaninca tekrar normal 1 hucrelik
    // boyutuna doner.
    <div className={`flex h-full flex-col overflow-hidden rounded-2xl border border-violet-300 bg-white shadow-sm sm:rounded-3xl ${isOpen ? 'col-span-full' : ''}`}>
      {/* Kapali haldeki gorunum - "Başvuru Yap" kartlariyla BIREBIR AYNI
          iskelet (gorsel alani + baslik + aciklama + buton), sadece menekse
          renk temasi ve tiklaninca akordiyon acan bir <button> olmasi farkli. */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex flex-1 flex-col text-left"
      >
        <div className="flex h-20 items-center justify-center bg-violet-50 p-3.5 sm:h-32 sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-600 text-lg font-black text-white sm:h-14 sm:w-14 sm:text-2xl">
            ?
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-between p-3.5 sm:p-5">
          <div>
            <h2 className="text-sm font-black leading-tight text-slate-900 group-hover:text-violet-700 sm:text-xl">
              Başvuru Sorgulama
            </h2>
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-slate-500 sm:mt-2.5 sm:text-sm">
              Daha önce yaptığınız başvuruyu TC kimlik no ve doğum tarihinizle sorgulayın.
            </p>
          </div>
          <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-black text-white shadow-sm transition group-hover:bg-violet-700 sm:mt-5 sm:px-4 sm:py-2.5 sm:text-sm">
            {isOpen ? 'Kapat' : 'Sorgula'} {isOpen ? '▴' : '→'}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-violet-100 bg-violet-50 p-4 sm:p-6">
          <p className="text-xs font-semibold leading-relaxed text-violet-900 sm:text-sm">
            Daha önce yaptığınız online başvuruları TC kimlik numaranız ve doğum tarihiniz ile sorgulayabilirsiniz.
            Yalnızca <strong>son 6 ay (180 gün)</strong> içinde yapılan başvurular listelenir.
          </p>

          {/* 19. turdan itibaren acilinca "col-span-full" ile TAM GENISLIK
              kapladigi icin (yukaridaki not) "sm:" viewport tabanli yan-yana
              duzen artik dogru calisir - dar bir kutuya sikismiyor. */}
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <input
              value={tc}
              onChange={(event) => setTc(event.target.value.replace(/\D/g, '').slice(0, 11))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void lookupApplicationStatus()
                }
              }}
              inputMode="numeric"
              maxLength={11}
              placeholder="TC Kimlik No"
              className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-4 py-3 text-base font-black text-slate-900 outline-none focus:border-violet-500"
            />
            <BirthDateTextInput
              value={birthDate}
              onChange={setBirthDate}
              onEnterKey={() => void lookupApplicationStatus()}
              ariaLabel="Doğum Tarihi"
              className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-4 py-3 text-base font-black text-slate-900 outline-none focus:border-violet-500"
            />
            <button
              type="button"
              onClick={() => void lookupApplicationStatus()}
              disabled={lookupState === 'loading'}
              className="rounded-lg bg-violet-600 px-6 py-3 text-sm font-black text-white shadow-sm hover:bg-violet-700 disabled:opacity-60"
            >
              Sorgula
            </button>
          </div>

          {lookupMessage && (
            <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-bold ${
              lookupState === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : lookupState === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-violet-200 bg-white text-violet-700'
            }`}>
              {lookupMessage}
            </div>
          )}

          {results.length > 0 && (
            <>
            <p className="mt-4 text-[11px] font-bold text-violet-700">
              Listelenen başvurular son 6 ay (180 gün) içinde yapılmıştır.
            </p>
            {/* Kullanici istegi (19. tur -> 21. tur): "tum alanlar TEK
                SATIRDA gorunsun" - tur/isim basliginin AYRI bir satirda
                durdugu onceki iki-satirli yapi kaldirildi, hepsi (Tur, Ad
                Soyad, Tarih, Donem, Asama, Aciklama) TEK bir grid satirinda.
                Genis ekranda (>= sm, bu kart acildiginda zaten tam genislik
                kapladigi icin sikismaz) gercek bir 6 sutunlu tablo gibi; dar
                ekranda (telefon) her alan kendi etiketiyle alt alta (6
                sutunu bir telefon ekranina sigdirmak okunmaz olurdu). */}
            <div className="mt-2 overflow-hidden rounded-xl border border-violet-200 bg-white">
              <div className="hidden bg-violet-50 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-violet-700 sm:grid sm:grid-cols-[130px_140px_95px_115px_120px_1fr] sm:gap-3">
                <span>Tür</span>
                <span>Ad Soyad</span>
                <span>Tarih</span>
                <span>Dönem</span>
                <span>Aşama</span>
                <span>Açıklama</span>
              </div>
              <div className="divide-y divide-violet-100">
                {results.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-1 gap-1 px-4 py-3 text-sm sm:grid-cols-[130px_140px_95px_115px_120px_1fr] sm:items-center sm:gap-3"
                  >
                    <p className="font-black text-slate-900">
                      {item.assistanceType}
                      {/* Kullanici istegi (2026-09-22): "işaretli alandada
                          yardımın dönem bilgisi görünsün" - Dönem sutunu
                          zaten vardi, ama vatandas Tür hucresine bakarken
                          donemi de HEMEN orada gormek istedi - bu yuzden
                          Dönem sutunu KALDIRILMADI, ayrica bu hucreye de
                          eklendi (kucuk alt satir olarak). */}
                      {item.period && (
                        <span className="mt-0.5 block text-[11px] font-bold text-violet-600">
                          {item.period}
                        </span>
                      )}
                    </p>
                    <p className="font-bold text-slate-700">
                      <span className="font-black sm:hidden">Ad Soyad: </span>{item.name || '-'}
                    </p>
                    <p className="font-bold text-slate-600">
                      <span className="font-black sm:hidden">Tarih: </span>{formatStatusDate(item.date)}
                    </p>
                    <p className="font-bold text-slate-600">
                      <span className="font-black sm:hidden">Dönem: </span>{item.period || '-'}
                    </p>
                    <p>
                      <span className="font-black sm:hidden">Aşama: </span>
                      {item.stage
                        ? <span className="inline-block rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-black text-violet-700">{item.stage}</span>
                        : '-'}
                    </p>
                    <p className="font-semibold leading-relaxed text-slate-500">
                      <span className="font-black sm:hidden">Açıklama: </span>{item.note || '-'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
