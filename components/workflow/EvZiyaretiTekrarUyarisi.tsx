'use client'

// 2026-10-15: Sonuç Bekleyen'den "Ev Ziyareti Tekrarı" ile tahkikata geri
// gonderilen dosyada KIRMIZI, yanip sonen uyari - son ziyaret tarihi,
// aciklamasi ve eve giden personel (bkz. lib/workflow/evZiyaretiTekrar.ts).
// birlesik: tablo satirina gomulu (cerceve/zemin satirdan gelir - Tahkikat
// listesinde uyari ve dosya satiri tek blok gorunur).

export type EvZiyaretiTekrari = {
  id: string
  konu: string
  rapor: string
  sonZiyaretTarihi: string | null
  sonZiyaretPersoneli: string | null
  sonZiyaretSonucu: string | null
  isteyenKullanici: string | null
  olusturmaTarihi: string | null
  tekrarSayisi: number
}

function tarih(value: string | null) {
  if (!value) return null
  const [y, m, d] = value.slice(0, 10).split('-')
  return y && m && d ? `${d}.${m}.${y}` : value
}

function Bilgi({ etiket, deger, kompakt }: { etiket: string; deger: string; kompakt: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`font-black uppercase tracking-wide text-rose-700 ${kompakt ? 'text-[10px]' : 'text-[12px]'}`}>{etiket}</div>
      <div className={`font-extrabold leading-snug text-slate-900 ${kompakt ? 'text-[13px]' : 'text-[17px]'}`}>{deger}</div>
    </div>
  )
}

export function EvZiyaretiTekrarUyarisi({ tekrar, kompakt = false, birlesik = false, className = '' }: {
  tekrar: EvZiyaretiTekrari
  kompakt?: boolean
  birlesik?: boolean
  className?: string
}) {
  const ziyaretTarihi = tarih(tekrar.sonZiyaretTarihi)
  const baslik = ziyaretTarihi
    ? `${ziyaretTarihi} tarihinde tahkikat yapıldı — ${tekrar.konu || 'Evde bulunamadı'}`
    : `Tahkikat tekrarı — ${tekrar.konu || 'Evde bulunamadı'}`
  const istekZamani = tekrar.olusturmaTarihi
    ? new Date(tekrar.olusturmaTarihi).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
    : ''

  return (
    <div className={`${birlesik ? '' : 'ns-tekrar-uyari overflow-hidden rounded-lg border-2 border-rose-600 bg-rose-50'} text-left ${className}`}>
      <div className={`ns-tekrar-baslik flex flex-wrap items-center gap-x-3 gap-y-1 font-black uppercase tracking-wide ${birlesik ? 'rounded-md' : ''} ${kompakt ? 'px-2.5 py-1.5 text-[12px]' : 'px-3.5 py-2 text-[17px]'}`}>
        <svg className={kompakt ? 'h-4 w-4 shrink-0' : 'h-5 w-5 shrink-0'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4M12 17h.01" />
        </svg>
        <span>{baslik}</span>
        {tekrar.tekrarSayisi > 1 && (
          <span className="rounded-full bg-white px-2.5 py-0.5 text-[0.8em] text-rose-700">{tekrar.tekrarSayisi}. tekrar</span>
        )}
      </div>
      <div className={kompakt ? 'space-y-1.5 px-2.5 py-2' : `space-y-2 ${birlesik ? 'px-1 pb-1 pt-2.5' : 'px-3.5 py-3'}`}>
        <div className={`grid gap-x-6 gap-y-2 ${kompakt ? 'grid-cols-2' : 'grid-cols-2 xl:grid-cols-4'}`}>
          <Bilgi etiket="Son ev ziyareti" deger={ziyaretTarihi ?? '—'} kompakt={kompakt} />
          <Bilgi etiket="Eve giden personel" deger={tekrar.sonZiyaretPersoneli ?? '—'} kompakt={kompakt} />
          <Bilgi etiket="Ziyaret sonucu" deger={tekrar.sonZiyaretSonucu ?? tekrar.konu ?? '—'} kompakt={kompakt} />
          {!kompakt && (
            <Bilgi etiket="Tekrar isteyen" deger={`${tekrar.isteyenKullanici ?? '—'}${istekZamani ? ` · ${istekZamani}` : ''}`} kompakt={kompakt} />
          )}
        </div>
        <div className={`rounded-md border-l-4 border-rose-500 bg-white/80 ${kompakt ? 'px-2 py-1' : 'px-3 py-2'}`}>
          <div className={`font-black uppercase tracking-wide text-rose-700 ${kompakt ? 'text-[10px]' : 'text-[12px]'}`}>Açıklama</div>
          <div className={`whitespace-pre-wrap font-bold leading-snug text-slate-900 ${kompakt ? 'line-clamp-3 text-[13px]' : 'text-[17px]'}`}>{tekrar.rapor || '—'}</div>
        </div>
      </div>
    </div>
  )
}
