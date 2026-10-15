'use client'

import { useEffect, useMemo, useState } from 'react'

// 2026-10-15: Sonuç Bekleyen > "Diğer Kurum Yardımları" - dosyanin diger
// kurumlardan aldigi yardimlar, toplam ve kurum/tur bazli ara toplamlar.

type Kayit = {
  id: string
  tarih: string | null
  adSoyad: string | null
  tcKimlikNo: string | null
  kurum: string | null
  yardimTuru: string | null
  aciklama: string | null
  miktar: number | null
}

const tl = (n: number) => `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`

function tarih(value: string | null) {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}.${m}.${y}` : value
}

export function DigerKurumYardimlariPenceresi({ fileId, fileNo, applicantName, onClose }: {
  fileId: string
  fileNo: string
  applicantName: string
  onClose: () => void
}) {
  const [kayitlar, setKayitlar] = useState<Kayit[]>([])
  const [durum, setDurum] = useState<'yukleniyor' | 'hazir' | 'hata'>('yukleniyor')
  const [hata, setHata] = useState('')

  useEffect(() => {
    let iptal = false
    fetch(`/api/workflow/diger-kurum-yardimlari?fileId=${encodeURIComponent(fileId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Diğer kurum yardımları alınamadı.')
        if (!iptal) {
          setKayitlar(payload.data ?? [])
          setDurum('hazir')
        }
      })
      .catch((err) => {
        if (!iptal) {
          setHata(err instanceof Error ? err.message : 'Diğer kurum yardımları alınamadı.')
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
    const kurumlar = new Map<string, { toplam: number; adet: number }>()
    let toplam = 0
    for (const kayit of kayitlar) {
      const miktar = kayit.miktar ?? 0
      toplam += miktar
      const anahtar = `${kayit.kurum || 'Kurum belirtilmemiş'} — ${kayit.yardimTuru || 'Tür belirtilmemiş'}`
      const mevcut = kurumlar.get(anahtar) ?? { toplam: 0, adet: 0 }
      kurumlar.set(anahtar, { toplam: mevcut.toplam + miktar, adet: mevcut.adet + 1 })
    }
    return {
      toplam,
      gruplar: [...kurumlar.entries()].map(([ad, v]) => ({ ad, ...v })).sort((a, b) => b.toplam - a.toplam),
    }
  }, [kayitlar])

  return (
    <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-violet-300 bg-white shadow-2xl" style={{ maxWidth: 1100 }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b-2 border-[#b8860b] bg-gradient-to-r from-[#3b0764] via-[#5b21b6] to-[#6d28d9] px-5 py-3 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-200">Sonuç Bekleyen · Dosya {fileNo}</p>
            <h3 className="mt-0.5 text-[18px] font-black uppercase tracking-wide">Diğer Kurum Yardımları</h3>
            <p className="mt-0.5 text-[13px] font-bold text-violet-100">{applicantName}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/40 text-[18px] hover:bg-white/15" aria-label="Kapat">×</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {durum === 'yukleniyor' && <p className="py-12 text-center text-[15px] font-bold text-slate-400">Yükleniyor…</p>}
          {durum === 'hata' && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-700">{hata}</p>}
          {durum === 'hazir' && kayitlar.length === 0 && (
            <p className="py-12 text-center text-[15px] font-bold text-slate-500">Bu dosya için diğer kurumlardan alınan yardım kaydı bulunmuyor.</p>
          )}
          {durum === 'hazir' && kayitlar.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
                <div className="rounded-lg border-2 border-violet-600 bg-violet-50 px-4 py-3">
                  <div className="text-[12px] font-black uppercase tracking-wide text-violet-700">Genel toplam</div>
                  <div className="mt-0.5 text-[28px] font-black tabular-nums leading-tight text-violet-900">{tl(ozet.toplam)}</div>
                  <div className="text-[13px] font-bold text-violet-700">{kayitlar.length} kayıt</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="mb-1 text-[12px] font-black uppercase tracking-wide text-slate-500">Kurum / yardım türüne göre</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ozet.gruplar.map((grup) => (
                      <span key={grup.ad} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px]">
                        <span className="font-bold text-slate-700">{grup.ad}</span>
                        <span className="text-slate-400">({grup.adet})</span>
                        <span className="font-black tabular-nums text-violet-800">{tl(grup.toplam)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[820px] border-collapse text-left">
                  <thead>
                    <tr className="bg-[#3b0764] text-[12px] font-bold uppercase tracking-wide text-white">
                      <th className="px-3 py-2">Tarih</th>
                      <th className="px-3 py-2">Yardım alan</th>
                      <th className="px-3 py-2">Kurum</th>
                      <th className="px-3 py-2">Yardım türü</th>
                      <th className="px-3 py-2">Açıklama</th>
                      <th className="px-3 py-2 text-right">Miktar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kayitlar.map((kayit, index) => (
                      <tr key={kayit.id} className={`border-t border-slate-100 align-top text-[14px] ${index % 2 ? 'bg-slate-50/60' : 'bg-white'}`}>
                        <td className="whitespace-nowrap px-3 py-2 font-bold tabular-nums text-slate-700">{tarih(kayit.tarih)}</td>
                        <td className="px-3 py-2">
                          <div className="font-bold text-slate-900">{kayit.adSoyad || '—'}</div>
                          {kayit.tcKimlikNo && <div className="text-[12px] tabular-nums text-slate-500">{kayit.tcKimlikNo}</div>}
                        </td>
                        <td className="px-3 py-2 font-bold text-slate-800">{kayit.kurum || '—'}</td>
                        <td className="px-3 py-2 font-semibold text-slate-700">{kayit.yardimTuru || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{kayit.aciklama || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-black tabular-nums text-violet-800">{kayit.miktar === null ? '—' : tl(kayit.miktar)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-violet-600 bg-violet-50 text-[15px]">
                      <td colSpan={5} className="px-3 py-2.5 text-right font-black uppercase tracking-wide text-violet-900">Toplam ({kayitlar.length} kayıt)</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-black tabular-nums text-violet-900">{tl(ozet.toplam)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <button type="button" onClick={onClose} className="h-9 rounded-md bg-[#3b0764] px-5 text-[13px] font-bold text-white hover:bg-[#5b21b6]">Kapat</button>
        </div>
      </div>
    </div>
  )
}
