// Kullanici istegi (2026-10-14, Yardımlar kurumsal tur): eski 4 renkli
// buyuk ozet kartlari (sky/emerald/blue/amber - `false &&` ile kapatilmisti)
// yerine, Dosya Yönetimi'nin lacivert/altin diliyle TEK satirlik, ince bir
// ozet seridi. Degerler zaten mevcut sayim sorgusundan gelir (ek sorgu yok),
// TUM filtrelenmis veri kumesini (sadece ekrandaki sayfayi degil) yansitir.
// "use client" YOK - sunucu bilesenlerinden dogrudan render edilir.

export type AssistanceStatItem = {
  label: string
  value: number | string | null | undefined
  // 'warn': sifirdan buyukse amber vurgulanir (ör. Kart No Eksik)
  tone?: 'default' | 'warn'
  format?: 'number' | 'decimal'
}

function formatValue(item: AssistanceStatItem) {
  if (item.value === null || item.value === undefined || item.value === '') return '—'
  if (typeof item.value === 'string') return item.value
  if (item.format === 'decimal') {
    return item.value.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }
  return item.value.toLocaleString('tr-TR')
}

export function AssistanceStatStrip({ items }: { items: AssistanceStatItem[] }) {
  const visible = items.filter(Boolean)
  if (visible.length === 0) return null

  return (
    <div className="flex flex-wrap items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,30,43,0.05)] print:hidden">
      <div className="flex w-1.5 shrink-0 bg-[#1E2A38]" aria-hidden />
      {visible.map((item, index) => {
        const isWarn = item.tone === 'warn' && typeof item.value === 'number' && item.value > 0
        return (
          <div
            key={item.label}
            className={`flex min-w-[140px] flex-1 flex-col justify-center px-4 py-2.5 ${index > 0 ? 'border-l border-slate-100' : ''}`}
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
              {item.label}
            </span>
            <span className={`mt-0.5 text-[20px] font-bold leading-tight tabular-nums ${isWarn ? 'text-amber-700' : 'text-[#1E2A38]'}`}>
              {formatValue(item)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
