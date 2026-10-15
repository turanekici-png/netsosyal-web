import type { ReactNode } from 'react'

type ReportPageHeaderProps = {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
  className?: string
  // Kullanici istegi (2026-10-14, Yardımlar kurumsal tur): SADECE verildiginde
  // gosterilir - basligin ustunde kucuk altin "Yardım Yönetimi › ..." yol
  // satiri ve altinda bilgi satiri. Diger rapor sayfalari bunlari gecmedigi
  // icin gorunumleri DEGISMEZ.
  kicker?: string
  subtitle?: ReactNode
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
  kicker,
  subtitle,
}: ReportPageHeaderProps) {
  return (
    <div
      className={`rounded-xl border border-[#2A3B4D] bg-[#1E2A38] px-4 py-3 text-white shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.08)] md:px-5 md:py-4 ${className}`}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
        <div className="min-w-0">
          {kicker && (
            <p className="mb-1 text-[12px] font-bold uppercase tracking-[0.14em] text-[#D4B26A] md:text-[14.5px]">
              {kicker}
            </p>
          )}
          <h1 className="text-[18px] font-semibold uppercase tracking-wide leading-tight text-white md:text-[30px]">
            {title}
          </h1>
          {subtitle && (
            <div className="mt-1 text-[13px] font-medium text-slate-300 md:text-[16px]">
              {subtitle}
            </div>
          )}
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

// 2026-10-15: baslik dugmeleri arac cubugu dugmeleriyle AYNI olcu ve yazi dilinde
// (14.5px kalin, buyuk harf yok, 40px yukseklik) - tum listelerde tutarli gorunum.
export const reportHeaderPrimaryButton =
  'inline-flex min-h-10 md:min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-[14.5px] md:text-[17px] font-bold text-[#1E2A38] shadow-sm transition-colors hover:bg-[#F6F3EA] disabled:cursor-not-allowed disabled:opacity-60'

export const reportHeaderPrintButton =
  'inline-flex min-h-10 md:min-h-11 items-center justify-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-4 text-[14.5px] md:text-[17px] font-bold text-white shadow-sm transition-colors hover:bg-white/20'

export const reportHeaderGhostButton =
  'inline-flex min-h-10 md:min-h-11 items-center justify-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-4 text-[14.5px] md:text-[17px] font-bold text-white shadow-sm transition-colors hover:bg-white/20'
