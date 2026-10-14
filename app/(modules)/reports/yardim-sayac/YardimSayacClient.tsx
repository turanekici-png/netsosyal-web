'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import { downloadXlsx } from '@/lib/utils/xlsxExport'

export type YardimSayacRow = {
  tarih: string
  saat: string
  yardimTuru: string
  dosyaNo: string
  adSoyad: string
  miktar: string
  gonderen: string
  yazici: string
  aciklama: string
}

type Props = {
  routePath: string
  data: YardimSayacRow[]
  totalCount: number
  currentPage: number
  pageSize: number
  search: string
  tur: string
  baslangic: string
  bitis: string
  turOptions: string[]
  turDagilimi: { tur: string; adet: number }[]
}

function buildUrl(routePath: string, sp: URLSearchParams, patch: Record<string, string | null>) {
  const params = new URLSearchParams(sp.toString())
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  return `${routePath}?${params.toString()}`
}

export function YardimSayacClient({
  routePath,
  data,
  totalCount,
  currentPage,
  pageSize,
  search,
  tur,
  baslangic,
  bitis,
  turOptions,
  turDagilimi,
}: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const firstRecord = data.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastRecord = data.length === 0 ? 0 : firstRecord + data.length - 1

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    router.push(buildUrl(routePath, sp, {
      page: '1',
      search: String(formData.get('search') || '').trim() || null,
      baslangic: String(formData.get('baslangic') || '') || null,
      bitis: String(formData.get('bitis') || '') || null,
    }))
  }

  const handleTurChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    router.push(buildUrl(routePath, sp, { page: '1', tur: event.target.value || null }))
  }

  const exportRows = () => {
    if (data.length === 0) return
    downloadXlsx(
      data.map((row) => ({
        Tarih: row.tarih,
        Saat: row.saat,
        'Yardım Türü': row.yardimTuru,
        'Dosya No': row.dosyaNo,
        'Ad Soyad': row.adSoyad,
        Miktar: row.miktar,
        'Gönderen Kullanıcı': row.gonderen,
        Yazıcı: row.yazici,
        Açıklama: row.aciklama,
      })),
      `yardim-sayac-${new Date().toISOString().slice(0, 10)}.xlsx`,
      'Yardım Sayaç',
    )
  }

  const hasFilters = Boolean(search || tur || baslangic || bitis)

  return (
    <div className="space-y-6 text-slate-950">
      {/* Kurumsal rapor basligi (2026-10-13): diger rapor sayfalarindaki
          ReportPageHeader ile ayni koyu lacivert zemin ve baslik olcusu. */}
      <div className="overflow-hidden rounded-xl border border-[#2A3B4D] shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.08)] print:hidden">
        <div className="flex flex-col gap-2 bg-[#1E2A38] px-4 py-3 text-white md:flex-row md:items-center md:justify-between md:gap-3 md:px-5 md:py-4">
          <h1 className="text-[18px] font-semibold uppercase leading-tight tracking-wide md:text-[26px]">Yardım Sayaç</h1>
          <button type="button" onClick={() => window.print()} className={reportHeaderGhostButton}>
            Yazdır
          </button>
        </div>
        <div className="bg-white px-5 py-2.5 text-xs font-bold text-slate-500">
          Barkod yazıcısına gönderilen Gıda Bankası, Dönem Dışı Gıda, Destek Paketi ve Giyim yardımlarının kaydı.
          {' '}{firstRecord}-{lastRecord} arası gösteriliyor (toplam {totalCount}).
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 print:hidden">
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
          <p className="text-[11px] font-black uppercase tracking-wide text-violet-500">Toplam</p>
          <p className="text-2xl font-black text-violet-700">{totalCount}</p>
        </div>
        {turDagilimi.map((item) => (
          <div key={item.tur} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{item.tur}</p>
            <p className="text-2xl font-black text-slate-700">{item.adet}</p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-black uppercase tracking-wide text-slate-400">Ara</label>
          <input
            name="search"
            defaultValue={search}
            placeholder="Dosya no, ad soyad veya gönderen kullanıcı..."
            className="min-w-[240px] rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#7c3aed]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-black uppercase tracking-wide text-slate-400">Yardım Türü</label>
          <select
            value={tur}
            onChange={handleTurChange}
            className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#7c3aed]"
          >
            <option value="">Tüm Türler</option>
            {turOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-black uppercase tracking-wide text-slate-400">Başlangıç</label>
          <input type="date" name="baslangic" defaultValue={baslangic} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#7c3aed]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-black uppercase tracking-wide text-slate-400">Bitiş</label>
          <input type="date" name="bitis" defaultValue={bitis} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#7c3aed]" />
        </div>
        <button type="submit" className="rounded-lg bg-[#7c3aed] px-5 py-2.5 text-sm font-black text-white hover:bg-[#6d28d9]">
          Ara
        </button>
        {hasFilters && (
          <button type="button" onClick={() => router.push(routePath)} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50">
            Temizle
          </button>
        )}
        <button type="button" onClick={exportRows} disabled={data.length === 0} className="rounded-lg bg-[#3f7f28] px-4 py-2.5 text-sm font-black text-white hover:bg-[#346a21] disabled:pointer-events-none disabled:opacity-50">
          XLSX Aktar
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {data.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
            Görüntülenecek yardım sayaç kaydı bulunamadı.
          </div>
        ) : (
          <AdvancedTable
            data={data.map((row) => ({
              tarih: row.tarih,
              saat: row.saat,
              yardimTuru: row.yardimTuru,
              dosyaNo: row.dosyaNo,
              adSoyad: row.adSoyad,
              miktar: row.miktar,
              gonderen: row.gonderen,
              yazici: row.yazici,
              aciklama: row.aciklama,
            }))}
            tableId="yardim-sayac-table"
            showRowNumber
            rowNumberStart={(currentPage - 1) * pageSize + 1}
            preferredColumnOrder={['tarih', 'saat', 'yardimTuru', 'dosyaNo', 'adSoyad', 'miktar', 'gonderen', 'yazici', 'aciklama']}
            columnLabels={{
              tarih: 'Tarih',
              saat: 'Saat',
              yardimTuru: 'Yardım Türü',
              dosyaNo: 'Dosya No',
              adSoyad: 'Ad Soyad',
              miktar: 'Miktar',
              gonderen: 'Gönderen Kullanıcı',
              yazici: 'Yazıcı',
              aciklama: 'Açıklama',
            }}
          />
        )}

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 print:hidden">
          <div className="text-xs font-bold text-slate-500">
            Sayfa {currentPage} / {totalPages} (Toplam {totalCount} kayıt)
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(buildUrl(routePath, sp, { page: String(currentPage - 1) }))}
              disabled={currentPage <= 1}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Önceki
            </button>
            <button
              type="button"
              onClick={() => router.push(buildUrl(routePath, sp, { page: String(currentPage + 1) }))}
              disabled={currentPage >= totalPages}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
