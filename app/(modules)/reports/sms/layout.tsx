'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { id: 'sms', label: 'SMS Raporları', href: '/reports/sms' },
  { id: 'whatsapp', label: 'WhatsApp Raporları', href: '/reports/sms/whatsapp' },
]

export default function SmsRaporlariLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const activeTab = pathname.includes('/whatsapp') ? 'whatsapp' : 'sms'

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm print:hidden">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={[
                  'flex items-center justify-center rounded-lg px-4 py-3 text-sm font-black transition-colors',
                  isActive
                    ? tab.id === 'whatsapp'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-[#0076b6] text-white shadow-sm'
                    : tab.id === 'whatsapp'
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-sky-50 text-[#005f95] hover:bg-sky-100',
                ].join(' ')}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
      {children}
    </div>
  )
}
