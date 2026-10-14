import { formatLockSince, type WorkflowLock } from '@/lib/hooks/useWorkflowPresence'

// Is Akisi listelerinde, baska bir kullanicinin rapor penceresini actigi
// kayit icin kirmizi uyari (2026-10-14). Satir rengi ayrica
// WORKFLOW_LOCKED_ROW_CLASS ile kirmiziya boyanir. 2. tur (ayni gun):
// "personel yazisi daha buyuk gorunsun ve yanip sonsun" - buyuk yazi +
// globals.css .ns-calisan-uyari (kirmizi/beyaz yanip sonme).
// 3. tur: "daha genis ve okunakli olsun, telefon bilgisinin altina dogru
// uzasin" - genis=true iken (masaustu tablo) uyari dar "Adi Soyadi"
// sutununa sikismaz: 0 genislikli sarmalayici sutunu GENISLETMEDEN icerigi
// saga (telefon sutununun altina) tasirir.
export const WORKFLOW_LOCKED_ROW_CLASS = '!bg-rose-100 hover:!bg-rose-100 shadow-[inset_6px_0_0_#e11d48]'

export function WorkflowLockNotice({ lock, className = '', genis = false }: { lock: WorkflowLock; className?: string; genis?: boolean }) {
  const saat = formatLockSince(lock.since)
  const kutu = (
    <div
      role="status"
      aria-live="polite"
      className={`ns-calisan-uyari flex items-center gap-2.5 rounded-lg border-2 px-3 py-2 leading-snug shadow-md ${genis ? 'w-full' : 'mt-2 w-fit max-w-full'} ${className}`}
    >
      <svg className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      <span className="min-w-0">
        <span className="text-[17px] font-black uppercase tracking-wide">{lock.userName}</span>
        <span className="text-[15px] font-bold"> bu rapor üzerinde çalışıyor</span>
        {saat && <span className="block text-[13px] font-semibold opacity-90">Açılış saati: {saat}</span>}
      </span>
    </div>
  )
  if (!genis) return kutu
  return (
    <div className="relative z-10 mt-2 w-0 overflow-visible">
      <div className="w-[340px]">{kutu}</div>
    </div>
  )
}
