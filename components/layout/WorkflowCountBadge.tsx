// Is Akisi bekleyen dosya bildirimi (2026-10-14) - dosya durumu renkleri:
// Ön İnceleme sari, Tahkikat turuncu, Sonuç Bekleyen mavi. Sol menu ve
// Dosya Yönetimi > Hızlı İşlemler ortak kullanir.
import type { WorkflowCounts } from '@/lib/hooks/useWorkflowCounts'

export type WorkflowTone = 'sari' | 'turuncu' | 'mavi'

export const WORKFLOW_COUNT_TONE: Record<keyof WorkflowCounts, WorkflowTone> = {
  onInceleme: 'sari',
  tahkikat: 'turuncu',
  sonucBekleyen: 'mavi',
}

export const WORKFLOW_TONE: Record<WorkflowTone, { item: string; icon: string; badge: string }> = {
  sari: {
    item: 'bg-yellow-50 text-yellow-950 ring-1 ring-inset ring-yellow-300 hover:bg-yellow-100',
    icon: 'border-yellow-400 bg-yellow-400 text-yellow-950',
    badge: 'bg-yellow-400 text-yellow-950 ring-yellow-500',
  },
  turuncu: {
    item: 'bg-orange-50 text-orange-900 ring-1 ring-inset ring-orange-300 hover:bg-orange-100',
    icon: 'border-orange-600 bg-gradient-to-br from-orange-500 to-amber-600 text-white',
    badge: 'bg-orange-500 text-white ring-orange-600',
  },
  mavi: {
    item: 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-300 hover:bg-blue-100',
    icon: 'border-blue-600 bg-blue-600 text-white',
    badge: 'bg-blue-600 text-white ring-blue-700',
  },
}

export function WorkflowCountBadge({ count, tone, label, className = '' }: { count: number; tone: WorkflowTone; label: string; className?: string }) {
  return (
    <span
      title={`${label}: ${count} bekleyen dosya`}
      aria-label={`${count} bekleyen dosya`}
      className={`ml-auto inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5 text-[12px] font-black tabular-nums shadow-sm ring-1 ${WORKFLOW_TONE[tone].badge} ${className}`}
    >
      {count > 999 ? '999+' : count}
    </span>
  )
}
