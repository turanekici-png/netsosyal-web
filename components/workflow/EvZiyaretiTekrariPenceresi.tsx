'use client'

import { useState } from 'react'

// 2026-10-15: Sonuç Bekleyen > "Ev Ziyareti Tekrarı" - kullanici konu ve
// rapor yazar; rapor tahkikat raporlarina islenir ve dosya tekrar
// Tahkikat'a duser (bkz. app/api/workflow/ev-ziyareti-tekrari).

const KONU_ONERILERI = ['Evde Bulunamadı', 'Adreste Bulunamadı', 'Adres Değişikliği', 'Telefona Ulaşılamadı', 'Tekrar Ziyaret Gerekli']

export function EvZiyaretiTekrariPenceresi({ fileId, fileNo, applicantName, onClose, onSaved }: {
  fileId: string
  fileNo: string
  applicantName: string
  onClose: () => void
  onSaved: () => void
}) {
  const [konu, setKonu] = useState('Evde Bulunamadı')
  const [rapor, setRapor] = useState('')
  const [durum, setDurum] = useState<'idle' | 'saving'>('idle')
  const [hata, setHata] = useState('')

  const kaydet = async () => {
    if (!konu.trim() || !rapor.trim()) {
      setHata('Konu ve rapor alanları zorunludur.')
      return
    }
    setDurum('saving')
    setHata('')
    try {
      const response = await fetch('/api/workflow/ev-ziyareti-tekrari', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, title: konu.trim(), content: rapor.trim() }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Ev ziyareti tekrarı kaydedilemedi.')
      onSaved()
    } catch (err) {
      setHata(err instanceof Error ? err.message : 'Ev ziyareti tekrarı kaydedilemedi.')
      setDurum('idle')
    }
  }

  return (
    <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-rose-300 bg-white shadow-2xl">
        <div className="border-b-2 border-[#b8860b] bg-gradient-to-r from-[#7f1d1d] via-[#9f1239] to-[#be123c] px-4 py-3 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-rose-100">Sonuç Bekleyen · Tahkikata Geri Gönder</p>
          <h3 className="mt-0.5 text-[17px] font-black uppercase tracking-wide">Ev Ziyareti Tekrarı</h3>
          <p className="mt-1 text-[13px] font-bold text-rose-50">Dosya {fileNo} — {applicantName}</p>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-900">
            Yazdığınız rapor dosyanın tahkikat raporlarına eklenir ve dosya tekrar <b>Tahkikat</b> listesine düşer.
            Tahkikat ekibi dosyayı son ziyaret tarihi, personeli ve bu açıklamayla birlikte kırmızı uyarıyla görür.
          </p>
          {hata && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{hata}</div>}

          <label className="block">
            <span className="text-[12px] font-black uppercase tracking-wide text-slate-600">Konu</span>
            <input
              list="ev-ziyareti-tekrar-konulari"
              value={konu}
              onChange={(event) => setKonu(event.target.value)}
              maxLength={200}
              className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-[15px] font-bold text-slate-900 outline-none focus:border-rose-500"
            />
            <datalist id="ev-ziyareti-tekrar-konulari">
              {KONU_ONERILERI.map((oneri) => <option key={oneri} value={oneri} />)}
            </datalist>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {KONU_ONERILERI.map((oneri) => (
              <button
                key={oneri}
                type="button"
                onClick={() => setKonu(oneri)}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${konu === oneri ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {oneri}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-[12px] font-black uppercase tracking-wide text-slate-600">Rapor</span>
            <textarea
              value={rapor}
              onChange={(event) => setRapor(event.target.value)}
              rows={6}
              maxLength={10000}
              autoFocus
              placeholder="Örn: 15.10.2026 tarihinde adrese gidildi, şahıs evde bulunamadı. Tekrar ziyaret edilmesi gerekmektedir."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 outline-none focus:border-rose-500"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={durum === 'saving'}
            className="h-9 rounded-md border border-slate-300 bg-white px-5 text-[13px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => void kaydet()}
            disabled={durum === 'saving'}
            className="h-9 rounded-md bg-rose-700 px-5 text-[13px] font-black text-white shadow-sm hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60"
          >
            {durum === 'saving' ? 'Kaydediliyor...' : 'Kaydet ve Tahkikata Gönder'}
          </button>
        </div>
      </div>
    </div>
  )
}
