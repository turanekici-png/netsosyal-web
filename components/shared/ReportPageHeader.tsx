import type { ReactNode } from 'react'

type ReportPageHeaderProps = {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

// Kullanici istegi (2026-09-30): Dosya Yönetimi sayfasinda "Raporlar ve
// Tahkikatlar" paneli icin yapilan koyu lacivert/antrasit "kurumsal" baslik
// guncellemesi, Yardımlar altindaki TUM rapor/liste sayfalarina (bu
// bilesen uzerinden - ManagedReportTablePage'in ust basligi) da yayilsin.
// Eskiden 3 renkli parlak bir degrade (mavi->yesil-mavi->yesil) ve asiri
// buyuk (34px) bir baslik yazisi vardi - artik TEK duz koyu renk + daha
// olculu bir baslik boyutu (Dosya Yönetimi panel basliklarinin "bankacilik"
// hissiyle tutarli).
export function ReportPageHeader({
  eyebrow: _eyebrow,
  title,
  description: _description,
  actions,
  className = '',
}: ReportPageHeaderProps) {
  return (
    <div
      className={`rounded-xl border border-[#2A3B4D] bg-[#1E2A38] px-4 py-3 text-white shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.08)] md:px-5 md:py-4 ${className}`}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold uppercase tracking-wide leading-tight text-white md:text-[26px]">
            {title}
          </h1>
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

export const reportHeaderPrimaryButton =
  'inline-flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-[13.5px] font-black uppercase tracking-wide text-[#1E2A38] shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 md:px-4 md:py-2.5 md:text-[15.5px]'

export const reportHeaderPrintButton =
  'inline-flex items-center justify-center rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-[13.5px] font-black uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-white/20 md:px-4 md:py-2.5 md:text-[15.5px]'

export const reportHeaderGhostButton =
  'inline-flex items-center justify-center rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-[13.5px] font-black uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-white/20 md:px-4 md:py-2.5 md:text-[15.5px]'
