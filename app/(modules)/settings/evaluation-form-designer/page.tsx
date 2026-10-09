'use client'

import { useEffect, useMemo, useState } from 'react'
import { reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  BOLUM_BASLIKLARI,
  type SecimTuru,
  type SoruBolum,
  type SoruRow,
} from '@/lib/constants/incelemeDegerlendirmeForm'

export const dynamic = 'force-dynamic'

const BOLUM_SIRASI: SoruBolum[] = ['bilgi', 'kriter', 'degerlendirme', 'gozlem']
const SECIM_TURU_ETIKETLERI: Record<SecimTuru, string> = {
  tek: 'Tek seçim',
  coklu: 'Çoklu seçim',
  metin: 'Serbest metin',
  sayi: 'Sayısal',
}

type ApiResponse<T> = { success: boolean; data?: T; error?: string }

// Kullanici istegi (13 Eylul 2026): soru/seçenek yonetimi TEK bir yerde
// (Ayarlar > Sistem Ayarları > İnceleme Formu) olmali - eski basit
// bolum/secenek tasarimcisi bu ekranla DEGISTIRILDI. Sorulari doldurma
// akisi (Dosya İşlemleri > İnceleme Formu butonu) artik
// app/api/documents/inceleme-degerlendirme uzerinden calisiyor; bu sayfa
// o sistemin soru bankasini (bilgi/kriter/degerlendirme/gozlem, eleme
// kriterleri, otomatik puanlama) yonetir. Sistem sorulari (🔒) silinemez,
// sadece sirasi degistirilebilir; kullanici sorulari tam CRUD'a acik.
export default function EvaluationFormDesignerPage() {
  const [sorular, setSorular] = useState<SoruRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [aktifBolum, setAktifBolum] = useState<SoruBolum>('kriter')
  const [yeniSoru, setYeniSoru] = useState<Record<SoruBolum, { metin: string; secimTuru: SecimTuru; zorunlu: boolean }>>({
    bilgi: { metin: '', secimTuru: 'metin', zorunlu: false },
    kriter: { metin: '', secimTuru: 'tek', zorunlu: false },
    degerlendirme: { metin: '', secimTuru: 'tek', zorunlu: false },
    gozlem: { metin: '', secimTuru: 'tek', zorunlu: false },
  })
  const [yeniSecenek, setYeniSecenek] = useState<Record<number, string>>({})
  // Kullanici istegi (13 Eylul 2026): "yapılan bir değişikliği yada eklemeyi
  // kaydedemiyorum, kaydet butonu yok" - bu sayfa BASTAN BERI her degisiklikte
  // (siralama/tek-coklu/secenek metni-puan-bayrak/soru+secenek ekleme-silme)
  // otomatik kaydediyor, AYRI bir "Kaydet" butonu YOK - ama (1) mevcut bir
  // sorunun METNINI degistirecek bir alan hic YOKTU (sadece YENI soru eklerken
  // metin girilebiliyordu, var olan sorularin metni salt-okunur <span>'di) ve
  // (2) kaydedildigine dair GORUNUR bir onay da yoktu, bu yuzden kullanici
  // "kaydedilmedi" sanmis olabilir. Ikisi de asagida duzeltildi: soru metni
  // artik (sistem sorulari haric) duzenlenebilir bir input, ve her basarili
  // otomatik kayittan sonra kisa sureli yesil bir "Kaydedildi" onayi gorunur.
  const [savedFlash, setSavedFlash] = useState('')
  const flashSaved = (mesaj: string) => {
    setSavedFlash(mesaj)
    window.setTimeout(() => setSavedFlash((current) => (current === mesaj ? '' : current)), 2000)
  }

  const loadSorular = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/documents/inceleme-degerlendirme/sorular', { cache: 'no-store' })
      const payload = await response.json() as ApiResponse<SoruRow[]>
      if (response.ok && payload.success && payload.data) {
        setSorular(payload.data)
      } else {
        setStatus(payload.error || 'Sorular yüklenemedi.')
      }
    } catch {
      setStatus('Sorular yüklenemedi.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { void loadSorular() }, [])

  const gruplu = useMemo(() => {
    const map = new Map<SoruBolum, SoruRow[]>()
    for (const bolum of BOLUM_SIRASI) map.set(bolum, [])
    for (const soru of sorular) map.get(soru.bolum)?.push(soru)
    return map
  }, [sorular])

  const moveSoru = async (soru: SoruRow, direction: -1 | 1) => {
    const liste = gruplu.get(soru.bolum) || []
    const index = liste.findIndex((s) => s.id === soru.id)
    const target = liste[index + direction]
    if (!target) return

    setSorular((current) => current.map((s) => {
      if (s.id === soru.id) return { ...s, sira: target.sira }
      if (s.id === target.id) return { ...s, sira: soru.sira }
      return s
    }))

    await Promise.all([
      fetch(`/api/documents/inceleme-degerlendirme/sorular/${soru.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sira: target.sira }),
      }),
      fetch(`/api/documents/inceleme-degerlendirme/sorular/${target.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sira: soru.sira }),
      }),
    ])
    flashSaved('Sıra kaydedildi.')
  }

  const guncelleSoruSecimTuru = async (soru: SoruRow, secimTuru: 'tek' | 'coklu') => {
    if (soru.secimTuru === secimTuru) return
    setSorular((current) => current.map((s) => (s.id === soru.id ? { ...s, secimTuru } : s)))

    const response = await fetch(`/api/documents/inceleme-degerlendirme/sorular/${soru.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secimTuru }),
    })
    const payload = await response.json() as ApiResponse<null>
    if (!response.ok || !payload.success) {
      setStatus(payload.error || 'Seçim türü değiştirilemedi.')
      void loadSorular()
    } else {
      flashSaved('Seçim türü kaydedildi.')
    }
  }

  // Kullanici istegi (13 Eylul 2026): var olan bir sorunun METNINI
  // duzenleyebilme - oncesinde bu alan sadece salt-okunur bir <span>'di,
  // duzenleme icin HICBIR input yoktu (backend PATCH zaten soruMetni'ni
  // kabul ediyordu, sadece bu ekranda kullanilmiyordu).
  const guncelleSoruMetni = async (soru: SoruRow, yeniMetin: string) => {
    const temiz = yeniMetin.trim()
    if (!temiz || temiz === soru.soruMetni) return

    setSorular((current) => current.map((s) => (s.id === soru.id ? { ...s, soruMetni: temiz } : s)))
    const response = await fetch(`/api/documents/inceleme-degerlendirme/sorular/${soru.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ soruMetni: temiz }),
    })
    const payload = await response.json() as ApiResponse<null>
    if (!response.ok || !payload.success) {
      setStatus(payload.error || 'Soru metni kaydedilemedi.')
      void loadSorular()
    } else {
      flashSaved('Soru metni kaydedildi.')
    }
  }

  const guncelleSoruZorunlu = async (soru: SoruRow, zorunlu: boolean) => {
    setSorular((current) => current.map((s) => (s.id === soru.id ? { ...s, zorunlu } : s)))
    const response = await fetch(`/api/documents/inceleme-degerlendirme/sorular/${soru.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zorunlu }),
    })
    const payload = await response.json() as ApiResponse<null>
    if (!response.ok || !payload.success) {
      setStatus(payload.error || 'Zorunluluk kaydedilemedi.')
      void loadSorular()
    } else {
      flashSaved('Kaydedildi.')
    }
  }

  const deleteSoru = async (soru: SoruRow) => {
    if (soru.sistemSorusu) return
    if (!(await confirmDialog(`"${soru.soruMetni}" sorusunu ve tüm seçeneklerini silmek istediğinize emin misiniz?`))) return

    const response = await fetch(`/api/documents/inceleme-degerlendirme/sorular/${soru.id}`, { method: 'DELETE' })
    const payload = await response.json() as ApiResponse<null>
    if (response.ok && payload.success) {
      setSorular((current) => current.filter((s) => s.id !== soru.id))
      flashSaved('Soru silindi.')
    } else {
      setStatus(payload.error || 'Soru silinemedi.')
    }
  }

  const ekleSoru = async (bolum: SoruBolum) => {
    const taslak = yeniSoru[bolum]
    if (!taslak.metin.trim()) return

    const response = await fetch('/api/documents/inceleme-degerlendirme/sorular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bolum, soruMetni: taslak.metin.trim(), secimTuru: taslak.secimTuru, zorunlu: taslak.zorunlu }),
    })
    const payload = await response.json() as ApiResponse<{ id: string }>
    if (response.ok && payload.success) {
      setYeniSoru((current) => ({ ...current, [bolum]: { metin: '', secimTuru: 'tek', zorunlu: false } }))
      void loadSorular()
      flashSaved('Yeni soru kaydedildi.')
    } else {
      setStatus(payload.error || 'Soru eklenemedi.')
    }
  }

  const ekleSecenek = async (soru: SoruRow) => {
    const metin = (yeniSecenek[soru.id] || '').trim()
    if (!metin) return

    const response = await fetch(`/api/documents/inceleme-degerlendirme/sorular/${soru.id}/secenekler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secenekMetni: metin, puan: 0 }),
    })
    const payload = await response.json() as ApiResponse<null>
    if (response.ok && payload.success) {
      setYeniSecenek((current) => ({ ...current, [soru.id]: '' }))
      void loadSorular()
      flashSaved('Yeni seçenek kaydedildi.')
    } else {
      setStatus(payload.error || 'Seçenek eklenemedi.')
    }
  }

  const guncelleSecenek = async (secenekId: number, patch: Record<string, unknown>) => {
    const response = await fetch(`/api/documents/inceleme-degerlendirme/secenekler/${secenekId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    const payload = await response.json() as ApiResponse<null>
    void loadSorular()
    if (response.ok && payload.success) {
      flashSaved('Seçenek kaydedildi.')
    } else {
      setStatus(payload.error || 'Seçenek kaydedilemedi.')
    }
  }

  const silSecenek = async (soru: SoruRow, secenekId: number) => {
    if (soru.secenekler.length <= 1) {
      setStatus('Bir sorunun en az bir seçeneği olmalı.')
      return
    }
    const response = await fetch(`/api/documents/inceleme-degerlendirme/secenekler/${secenekId}`, { method: 'DELETE' })
    const payload = await response.json() as ApiResponse<null>
    if (response.ok && payload.success) {
      void loadSorular()
      flashSaved('Seçenek silindi.')
    } else {
      setStatus(payload.error || 'Seçenek silinemedi.')
    }
  }

  const aktifListe = gruplu.get(aktifBolum) || []

  return (
    <div className="space-y-6 p-4 text-slate-950 sm:p-6">
      {/* Kullanici istegi (13 Eylul 2026): "kaydet butonu yok" - bu sayfa her
          degisiklikte otomatik kaydediyor ama gorunur bir onay yoktu, bu
          yuzden kaydedildigi belli olsun diye kisa sureli yesil bir onay. */}
      {savedFlash && (
        <div className="fixed right-4 top-4 z-[3000] rounded-lg border border-emerald-300 bg-emerald-600 px-4 py-2 text-xl font-black text-white shadow-lg">
          ✓ {savedFlash}
        </div>
      )}
      <div className="rounded-lg border border-[#2A3B4D] bg-[#1E2A38] px-6 py-5 text-white shadow-sm">
        <div className="min-w-0">
          <p className="text-xl font-black uppercase tracking-wide text-white/80">Sistem Ayarları</p>
          <h1 className="text-2xl font-black leading-tight tracking-normal text-white md:text-[28px]">Tahkikat Formu Tasarımı</h1>
          <p className="mt-1.5 text-xl font-semibold text-white/80">
            Eleme kriterlerini, değerlendirme ve gözlem sorularını burada yönetin. Sistem soruları (🔒) silinemez, sadece sırası değiştirilebilir.
          </p>
        </div>
      </div>

      {status && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xl font-bold text-amber-800">
          <span>{status}</span>
          <button type="button" onClick={() => setStatus('')} className={reportHeaderGhostButton}>Kapat</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {BOLUM_SIRASI.map((bolum) => (
          <button
            key={bolum}
            type="button"
            onClick={() => setAktifBolum(bolum)}
            className={`rounded-md px-5 py-3 text-xl font-black transition-colors ${
              aktifBolum === bolum ? 'bg-[#1E2A38] text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {BOLUM_BASLIKLARI[bolum]} ({(gruplu.get(bolum) || []).length})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0076b6] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          {aktifListe.map((soru, index) => (
            <div key={soru.id} className="rounded-xl border border-slate-300 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {soru.sistemSorusu && <span title="Sistem sorusu - metni sabit, silinemez, sadece sırası/seçenekleri değişir">🔒</span>}
                  {soru.sistemSorusu ? (
                    <span className="truncate text-xl font-black text-slate-900">{soru.soruMetni}</span>
                  ) : (
                    <input
                      key={soru.id}
                      defaultValue={soru.soruMetni}
                      onBlur={(event) => void guncelleSoruMetni(soru, event.target.value)}
                      title="Soru metnini değiştirmek için buraya yazın, dışarı tıklayınca otomatik kaydedilir"
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xl font-black text-slate-900 outline-none transition hover:border-slate-200 hover:bg-slate-50 focus:border-[#1E2A38] focus:bg-white"
                    />
                  )}
                  {!soru.sistemSorusu && (
                    <label className="flex shrink-0 items-center gap-2 text-xl font-black uppercase text-slate-500">
                      <input
                        type="checkbox"
                        checked={soru.zorunlu}
                        onChange={(event) => void guncelleSoruZorunlu(soru, event.target.checked)}
                        className="h-5 w-5 rounded border-slate-300 text-[#1E2A38]"
                      />
                      Zorunlu
                    </label>
                  )}
                  {(soru.secimTuru === 'tek' || soru.secimTuru === 'coklu') ? (
                    <div className="flex shrink-0 overflow-hidden rounded-full border border-slate-300">
                      <button
                        type="button"
                        onClick={() => void guncelleSoruSecimTuru(soru, 'tek')}
                        className={`px-3 py-1.5 text-xl font-black uppercase transition-colors ${soru.secimTuru === 'tek' ? 'bg-[#1E2A38] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                      >
                        Tek seçim
                      </button>
                      <button
                        type="button"
                        onClick={() => void guncelleSoruSecimTuru(soru, 'coklu')}
                        className={`px-3 py-1.5 text-xl font-black uppercase transition-colors ${soru.secimTuru === 'coklu' ? 'bg-[#1E2A38] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                      >
                        Çoklu seçim
                      </button>
                    </div>
                  ) : (
                    <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xl font-black uppercase text-slate-500">
                      {SECIM_TURU_ETIKETLERI[soru.secimTuru]}
                    </span>
                  )}
                  {soru.redKriteri && (
                    <span className="shrink-0 rounded-full bg-rose-100 px-3 py-1.5 text-xl font-black uppercase text-rose-600">Eleme</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void moveSoru(soru, -1)}
                    disabled={index === 0}
                    title="Yukarı taşı"
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-xl font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => void moveSoru(soru, 1)}
                    disabled={index === aktifListe.length - 1}
                    title="Aşağı taşı"
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-xl font-black text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  {!soru.sistemSorusu && (
                    <button
                      type="button"
                      onClick={() => void deleteSoru(soru)}
                      title="Soruyu sil"
                      className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-xl font-black text-rose-600 hover:bg-rose-100"
                    >
                      Soruyu Sil
                    </button>
                  )}
                </div>
              </div>

              {soru.secimTuru !== 'metin' && (
                <div className="space-y-2 px-5 py-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 grid grid-cols-[minmax(0,1fr)_110px_150px_170px_48px] gap-2 px-1 text-lg font-black uppercase text-slate-400">
                      <span>Seçenek</span>
                      <span>Puan</span>
                      <span>Reddeder</span>
                      <span>Onay Gerekli</span>
                      <span />
                    </div>
                    <div className="space-y-1.5">
                      {soru.secenekler.map((secenek) => (
                        <div key={secenek.id} className="grid grid-cols-[minmax(0,1fr)_110px_150px_170px_48px] items-center gap-2">
                          <input
                            defaultValue={secenek.secenekMetni}
                            onBlur={(event) => {
                              if (event.target.value !== secenek.secenekMetni) {
                                void guncelleSecenek(secenek.id, { secenekMetni: event.target.value })
                              }
                            }}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xl font-semibold text-slate-900 outline-none focus:border-[#1E2A38]"
                          />
                          <input
                            type="number"
                            defaultValue={secenek.puan}
                            onBlur={(event) => {
                              const puan = Number(event.target.value) || 0
                              if (puan !== secenek.puan) void guncelleSecenek(secenek.id, { puan })
                            }}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xl font-black text-[#1E2A38] outline-none focus:border-[#1E2A38]"
                          />
                          <label className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              defaultChecked={secenek.redTetikler}
                              onChange={(event) => void guncelleSecenek(secenek.id, { redTetikler: event.target.checked })}
                              className="h-5 w-5 rounded border-slate-300 text-rose-600"
                            />
                          </label>
                          <label className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              defaultChecked={secenek.yoneticiOnayi}
                              onChange={(event) => void guncelleSecenek(secenek.id, { yoneticiOnayi: event.target.checked })}
                              className="h-5 w-5 rounded border-slate-300 text-amber-600"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => void silSecenek(soru, secenek.id)}
                            title="Seçeneği sil"
                            className="flex h-10 w-10 items-center justify-center rounded-md border border-rose-300 bg-white text-xl text-rose-500 hover:bg-rose-50"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <input
                        value={yeniSecenek[soru.id] || ''}
                        onChange={(event) => setYeniSecenek((current) => ({ ...current, [soru.id]: event.target.value }))}
                        placeholder="Yeni seçenek metni"
                        className="flex-1 rounded-md border border-dashed border-slate-300 px-4 py-2 text-xl font-semibold text-slate-700 outline-none focus:border-[#1E2A38]"
                      />
                      <button
                        type="button"
                        onClick={() => void ekleSecenek(soru)}
                        className="rounded-md border border-dashed border-slate-300 px-4 py-2 text-xl font-black text-slate-500 hover:border-[#1E2A38] hover:text-[#1E2A38]"
                      >
                        + Seçenek Ekle
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-5">
            <p className="mb-2 text-xl font-black uppercase text-slate-500">{BOLUM_BASLIKLARI[aktifBolum]} bölümüne yeni soru ekle</p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_140px_auto]">
              <input
                value={yeniSoru[aktifBolum].metin}
                onChange={(event) => setYeniSoru((current) => ({ ...current, [aktifBolum]: { ...current[aktifBolum], metin: event.target.value } }))}
                placeholder="Soru metni"
                className="w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xl font-semibold text-slate-900 outline-none focus:border-[#1E2A38]"
              />
              <select
                value={yeniSoru[aktifBolum].secimTuru}
                onChange={(event) => setYeniSoru((current) => ({ ...current, [aktifBolum]: { ...current[aktifBolum], secimTuru: event.target.value as SecimTuru } }))}
                className="w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xl font-semibold text-slate-900 outline-none focus:border-[#1E2A38]"
              >
                {Object.entries(SECIM_TURU_ETIKETLERI).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xl font-black text-slate-600">
                <input
                  type="checkbox"
                  checked={yeniSoru[aktifBolum].zorunlu}
                  onChange={(event) => setYeniSoru((current) => ({ ...current, [aktifBolum]: { ...current[aktifBolum], zorunlu: event.target.checked } }))}
                  className="h-5 w-5 rounded border-slate-300 text-[#1E2A38]"
                />
                Zorunlu
              </label>
              <button
                type="button"
                onClick={() => void ekleSoru(aktifBolum)}
                className="rounded-md bg-[#1E2A38] px-5 py-2.5 text-xl font-black text-white hover:bg-[#2A3B4D]"
              >
                + Soru Ekle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
