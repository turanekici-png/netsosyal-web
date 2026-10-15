'use client'

import { useEffect, useMemo, useState } from 'react'

// 2026-10-15: Sonuç Bekleyen > Dosya Sahibi > "Hane Bireyleri" - dosyadaki
// tum bireyler (kodlu alanlar Hazır Değerler'den, bkz. /api/workflow/hane-bireyleri).

type Birey = {
  id: string
  adSoyad: string | null
  tcKimlikNo: string | null
  yakinlik: string | null
  basvuruSahibi: boolean
  cinsiyet: string | null
  medeniHal: string | null
  dogumTarihi: string | null
  yas: number | null
  telefon: string | null
  saglik: string | null
  hastalik: string | null
  meslek: string | null
  aylikGelir: number | null
  vefat: boolean
  olumTarihi: string | null
}

const tl = (n: number) => `${n.toLocaleString('tr-TR')} ₺`

export function HaneBireyleriPenceresi({ fileId, fileNo, applicantName, onClose }: {
  fileId: string
  fileNo: string
  applicantName: string
  onClose: () => void
}) {
  const [bireyler, setBireyler] = useState<Birey[]>([])
  const [durum, setDurum] = useState<'yukleniyor' | 'hazir' | 'hata'>('yukleniyor')
  const [hata, setHata] = useState('')

  useEffect(() => {
    let iptal = false
    fetch(`/api/workflow/hane-bireyleri?fileId=${encodeURIComponent(fileId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Hane bireyleri alınamadı.')
        if (!iptal) {
          setBireyler(payload.data ?? [])
          setDurum('hazir')
        }
      })
      .catch((err) => {
        if (!iptal) {
          setHata(err instanceof Error ? err.message : 'Hane bireyleri alınamadı.')
          setDurum('hata')
        }
      })
    return () => { iptal = true }
  }, [fileId])

  useEffect(() => {
    const tus = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', tus)
    return () => window.removeEventListener('keydown', tus)
  }, [onClose])

  const ozet = useMemo(() => {
    const yasayan = bireyler.filter((b) => !b.vefat)
    return {
      kisi: yasayan.length,
      cocuk: yasayan.filter((b) => b.yas !== null && b.yas < 18).length,
      yasli: yasayan.filter((b) => b.yas !== null && b.yas >= 65).length,
      saglik: yasayan.filter((b) => b.saglik && !/yok/i.test(b.saglik)).length,
      gelir: yasayan.reduce((toplam, b) => toplam + (b.aylikGelir ?? 0), 0),
    }
  }, [bireyler])

  const kartlar = [
    { etiket: 'Hanedeki kişi', deger: String(ozet.kisi) },
    { etiket: '18 yaş altı', deger: String(ozet.cocuk) },
    { etiket: '65 yaş üstü', deger: String(ozet.yasli) },
    { etiket: 'Sağlık sorunu olan', deger: String(ozet.saglik) },
    { etiket: 'Beyan edilen aylık gelir', deger: tl(ozet.gelir) },
  ]

  return (
    <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-[#0E7C86]/50 bg-white shadow-2xl" style={{ maxWidth: 1200 }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b-2 border-[#b8860b] bg-gradient-to-r from-[#0a4f55] via-[#0E7C86] to-[#13959f] px-5 py-3 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-100">Sonuç Bekleyen · Dosya {fileNo}</p>
            <h3 className="mt-0.5 text-[18px] font-black uppercase tracking-wide">Hane Bireyleri</h3>
            <p className="mt-0.5 text-[13px] font-bold text-teal-50">{applicantName}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/40 text-[18px] hover:bg-white/15" aria-label="Kapat">×</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {durum === 'yukleniyor' && <p className="py-12 text-center text-[15px] font-bold text-slate-400">Yükleniyor…</p>}
          {durum === 'hata' && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-700">{hata}</p>}
          {durum === 'hazir' && bireyler.length === 0 && (
            <p className="py-12 text-center text-[15px] font-bold text-slate-500">Bu dosyada kayıtlı birey bulunmuyor.</p>
          )}
          {durum === 'hazir' && bireyler.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {kartlar.map((kart) => (
                  <div key={kart.etiket} className="rounded-lg border border-[#0E7C86]/30 border-l-4 border-l-[#0E7C86] bg-[#f0fafa] px-3 py-2">
                    <div className="text-[11.5px] font-bold uppercase tracking-wide text-[#0a5f67]">{kart.etiket}</div>
                    <div className="text-[22px] font-black tabular-nums leading-tight text-[#0b3d42]">{kart.deger}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[1000px] border-collapse text-left">
                  <thead>
                    <tr className="bg-[#0a4f55] text-[12px] font-bold uppercase tracking-wide text-white">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Adı soyadı</th>
                      <th className="px-3 py-2">T.C. kimlik no</th>
                      <th className="px-3 py-2">Yakınlık</th>
                      <th className="px-3 py-2">Doğum tarihi / yaş</th>
                      <th className="px-3 py-2">Cinsiyet</th>
                      <th className="px-3 py-2">Medeni hal</th>
                      <th className="px-3 py-2">Sağlık durumu</th>
                      <th className="px-3 py-2">Meslek</th>
                      <th className="px-3 py-2 text-right">Aylık gelir</th>
                      <th className="px-3 py-2">Telefon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bireyler.map((b, index) => (
                      <tr key={b.id} className={`border-t border-slate-100 align-top text-[14px] ${b.vefat ? 'bg-slate-100 text-slate-400' : b.basvuruSahibi ? 'bg-[#f0fafa]' : index % 2 ? 'bg-slate-50/60' : 'bg-white'}`}>
                        <td className="px-3 py-2 font-bold tabular-nums text-slate-400">{index + 1}</td>
                        <td className="px-3 py-2">
                          <div className={`font-bold ${b.vefat ? 'line-through' : 'text-slate-900'}`}>{b.adSoyad || '—'}</div>
                          {b.basvuruSahibi && <span className="mt-0.5 inline-block rounded bg-[#0E7C86] px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-white">Başvuru sahibi</span>}
                          {b.vefat && <span className="mt-0.5 inline-block rounded bg-slate-500 px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-white">Vefat {b.olumTarihi}</span>}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-700">{b.tcKimlikNo || '—'}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{b.yakinlik || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{b.dogumTarihi || '—'}{b.yas !== null && <span className="ml-1 font-bold text-slate-900">({b.yas})</span>}</td>
                        <td className="px-3 py-2 text-slate-700">{b.cinsiyet || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{b.medeniHal || '—'}</td>
                        <td className="px-3 py-2">
                          <div className={b.saglik && !/yok/i.test(b.saglik) ? 'font-bold text-rose-700' : 'text-slate-700'}>{b.saglik || '—'}</div>
                          {b.hastalik && <div className="text-[12px] text-slate-500">{b.hastalik}</div>}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{b.meslek || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-slate-800">{b.aylikGelir ? tl(b.aylikGelir) : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{b.telefon || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <button type="button" onClick={onClose} className="h-9 rounded-md bg-[#0a4f55] px-5 text-[13px] font-bold text-white hover:bg-[#0E7C86]">Kapat</button>
        </div>
      </div>
    </div>
  )
}
