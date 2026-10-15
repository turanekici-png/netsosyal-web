// 2026-10-15: Tüm Dosyalar / Tüm Bireyler listelerinin ORTAK lacivert/altin
// kurumsal arac cubugu parcalari (dugme siniflari, ikonlar, sayfalama).

export const toolbarButton =
  'inline-flex min-h-10 md:min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 md:px-3.5 py-2 text-[14.5px] md:text-[17px] font-bold text-[#1E2A38] shadow-sm transition-colors hover:border-[#1E2A38] hover:bg-[#F6F3EA] disabled:pointer-events-none disabled:opacity-45'
export const toolbarPrimaryButton =
  'inline-flex min-h-10 md:min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[#1E2A38] bg-[#1E2A38] px-3 md:px-3.5 py-2 text-[14.5px] md:text-[17px] font-bold text-white shadow-sm transition-colors hover:bg-[#2A3B4D] disabled:pointer-events-none disabled:opacity-45'
export const toolbarDangerButton =
  'inline-flex min-h-10 md:min-h-11 items-center justify-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 md:px-3.5 py-2 text-[14.5px] md:text-[17px] font-bold text-rose-700 shadow-sm transition-colors hover:border-rose-500 hover:bg-rose-50 disabled:pointer-events-none disabled:opacity-45'

// Arama/arac cubugu karti ve tablo karti zeminleri.
export const corporateToolbarCard =
  'flex flex-col gap-3 rounded-xl border border-slate-200 border-t-[3px] border-t-[#1E2A38] bg-white p-3 shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.06)] md:p-4 print:hidden'
export const corporateTableCard =
  'rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.06)] md:p-4'
export const corporateSearchInput =
  'min-h-12 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-[16px] md:text-[18px] font-semibold text-slate-950 shadow-sm outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-[#1E2A38] focus:ring-2 focus:ring-[#1E2A38]/15'

const ICON_PATHS = {
  search: ['M21 21l-4.3-4.3', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z'],
  check: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  refresh: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
  open: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  filterOff: ['M22 3H2l8 9.46V19l4 2v-8.54L22 3Z', 'M3 21 21 3'],
  trash: ['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'],
} as const

export type ToolbarIconName = keyof typeof ICON_PATHS

export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}

export function ToolbarDivider() {
  return <span aria-hidden className="hidden h-7 w-px bg-slate-200 lg:block" />
}

export const formatCount = (value: number) => value.toLocaleString('tr-TR')

type CorporatePaginationProps = {
  page: number
  totalPages: number
  totalCount: number
  firstRecord: number
  lastRecord: number
  hasRows: boolean
  canGoPrevious: boolean
  canGoNext: boolean
  onPageChange: (page: number) => void
}

export function CorporatePagination({
  page,
  totalPages,
  totalCount,
  firstRecord,
  lastRecord,
  hasRows,
  canGoPrevious,
  canGoNext,
  onPageChange,
}: CorporatePaginationProps) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
      <div className="text-[14.5px] md:text-[16.5px] font-semibold text-slate-600">
        Sayfa <strong className="font-black text-[#1E2A38]">{formatCount(page)}</strong> / {formatCount(totalPages)}
        <span className="mx-2 text-slate-300">·</span>
        {hasRows ? <>{formatCount(firstRecord)}–{formatCount(lastRecord)} arası</> : 'Kayıt yok'}
        <span className="mx-2 text-slate-300">·</span>
        Toplam <strong className="font-black text-[#1E2A38]">{formatCount(totalCount)}</strong> kayıt
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onPageChange(1)} disabled={!canGoPrevious} className={toolbarButton} title="İlk sayfa">
          «
        </button>
        <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={!canGoPrevious} className={toolbarButton}>
          ‹ Önceki
        </button>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={!canGoNext} className={toolbarButton}>
          Sonraki ›
        </button>
        <button type="button" onClick={() => onPageChange(totalPages)} disabled={!canGoNext} className={toolbarButton} title="Son sayfa">
          »
        </button>
      </div>
    </div>
  )
}
