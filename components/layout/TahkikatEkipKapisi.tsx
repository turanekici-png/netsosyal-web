'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Kullanici istegi (2026-10-15): tahkikat ekip hesabi (tahkikat1/2) ile
// tabletten girilince ekibin personeli listelenir; personel kendini secip
// KENDI sifresiyle devam eder. Ekibe uye tanimli degilse bu bilesen hicbir
// sey gostermez (bkz. lib/auth/tahkikatEkip.ts, /api/tahkikat-ekip).

type Kisi = { id: string; name: string; username: string }
type EkipDurumu = { ekip: Kisi; uyeler: Kisi[]; aktifPersonel: Kisi | null }

function basHarfler(ad: string) {
  return ad
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toLocaleUpperCase('tr-TR'))
    .join('')
}

export function TahkikatEkipKapisi() {
  const [durum, setDurum] = useState<EkipDurumu | null>(null)
  const [secili, setSecili] = useState<Kisi | null>(null)
  const [sifre, setSifre] = useState('')
  const [hata, setHata] = useState('')
  const [gonderiliyor, setGonderiliyor] = useState(false)
  const sifreRef = useRef<HTMLInputElement>(null)

  const yukle = useCallback(async () => {
    try {
      const res = await fetch('/api/tahkikat-ekip', { cache: 'no-store' })
      const payload = await res.json()
      if (res.ok && payload.success) setDurum(payload.data ?? null)
    } catch {
      // Kapı opsiyonel - yuklenemezse uygulama normal calisir.
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- veri yukleme efekti
    void yukle()
  }, [yukle])

  useEffect(() => {
    if (secili) sifreRef.current?.focus()
  }, [secili])

  if (!durum) return null

  const personelSec = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!secili || !sifre.trim() || gonderiliyor) return
    setGonderiliyor(true)
    setHata('')
    try {
      const res = await fetch('/api/tahkikat-ekip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personelId: secili.id, password: sifre }),
      })
      const payload = await res.json()
      if (!res.ok || !payload.success) throw new Error(payload.error || 'Giriş yapılamadı.')
      // Sayfalar (form personel adi vb.) yeni personelle yeniden yuklensin.
      window.location.reload()
    } catch (err) {
      setHata(err instanceof Error ? err.message : 'Giriş yapılamadı.')
      setSifre('')
      setGonderiliyor(false)
    }
  }

  const personelDegistir = async () => {
    await fetch('/api/tahkikat-ekip', { method: 'DELETE' }).catch(() => {})
    window.location.reload()
  }

  const ekiptenCik = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/login'
  }

  if (durum.aktifPersonel) {
    return (
      <div className="fixed bottom-3 left-3 z-[4500] flex items-center gap-2 rounded-full border border-[#c9a227]/60 bg-[#0a3a57] py-1.5 pl-1.5 pr-2 text-white shadow-lg print:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c9a227] text-[12px] font-black text-[#0a3a57]">
          {basHarfler(durum.aktifPersonel.name)}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] font-bold uppercase tracking-wide text-white/60">{durum.ekip.name}</span>
          <span className="text-[13px] font-black">{durum.aktifPersonel.name}</span>
        </span>
        <button
          type="button"
          onClick={() => void personelDegistir()}
          className="ml-1 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide hover:bg-white/20"
        >
          Personel Değiştir
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center overflow-y-auto bg-[#0a3a57]/95 p-3 backdrop-blur-sm sm:p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-[#c9a227]/40 bg-white shadow-2xl">
        <div className="border-b-4 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-5 py-4 text-white sm:px-7 sm:py-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#e8cf7a] sm:text-[12px]">Saha Tahkikat</p>
          <h1 className="mt-1 text-[22px] font-black leading-tight sm:text-[28px]">{durum.ekip.name}</h1>
          <p className="mt-1 text-[13px] font-semibold text-white/75 sm:text-[15px]">
            {secili ? 'Kendi kullanıcı şifrenizi girin.' : 'Devam etmek için listeden kendinizi seçin.'}
          </p>
        </div>

        {!secili ? (
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
            {durum.uyeler.map((uye) => (
              <button
                key={uye.id}
                type="button"
                onClick={() => { setSecili(uye); setHata(''); setSifre('') }}
                className="flex min-h-[72px] items-center gap-3 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-[#0076b6] hover:bg-sky-50 active:scale-[0.99]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0a3a57] text-[16px] font-black text-[#e8cf7a]">
                  {basHarfler(uye.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-black text-slate-900">{uye.name}</span>
                  <span className="block truncate text-[12px] font-bold text-slate-500">{uye.username}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={(e) => void personelSec(e)} className="mx-auto max-w-md space-y-4 p-5 sm:p-7">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0a3a57] text-[16px] font-black text-[#e8cf7a]">
                {basHarfler(secili.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-black text-slate-900">{secili.name}</span>
                <span className="block truncate text-[12px] font-bold text-slate-500">{secili.username}</span>
              </span>
            </div>
            <label className="block">
              <span className="text-[13px] font-black uppercase tracking-wide text-slate-600">Şifre</span>
              <input
                ref={sifreRef}
                type="password"
                autoComplete="current-password"
                value={sifre}
                onChange={(e) => setSifre(e.target.value)}
                className="mt-1.5 h-12 w-full rounded-lg border-2 border-slate-300 px-4 text-[18px] font-bold text-slate-900 outline-none focus:border-[#0076b6]"
              />
            </label>
            {hata && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-700">{hata}</div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setSecili(null); setHata(''); setSifre('') }}
                className="h-12 flex-1 rounded-lg border-2 border-slate-300 bg-white text-[15px] font-black text-slate-700 hover:bg-slate-50"
              >
                Geri
              </button>
              <button
                type="submit"
                disabled={!sifre.trim() || gonderiliyor}
                className="h-12 flex-[2] rounded-lg bg-[#0a3a57] text-[15px] font-black uppercase tracking-wide text-white hover:bg-[#0d4f6e] disabled:opacity-50"
              >
                {gonderiliyor ? 'Kontrol ediliyor...' : 'Giriş'}
              </button>
            </div>
          </form>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3 sm:px-7">
          <span className="text-[12px] font-bold text-slate-500">Listede adınız yoksa yöneticinize başvurun.</span>
          <button
            type="button"
            onClick={() => void ekiptenCik()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-black text-slate-600 hover:bg-slate-100"
          >
            Çıkış
          </button>
        </div>
      </div>
    </div>
  )
}
