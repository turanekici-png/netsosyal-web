'use client'

import { ReportPageHeader, reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'

export const dynamic = "force-dynamic"

export default function GenelRaporPage() {
  return (
    <div className="space-y-6">
      <ReportPageHeader
        eyebrow="Raporlar"
        title="Genel Raporlar"
        actions={<button type="button" className={reportHeaderGhostButton} onClick={() => window.print()}>Yazdır (Ctrl+P)</button>}
      />
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600">Genel raporlar modulu gelistirilme asamasindadir...</p>
      </div>
    </div>
  )
}
