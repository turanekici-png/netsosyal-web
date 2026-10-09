'use client'

import { ReportPageHeader, reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'

export const dynamic = "force-dynamic"

export default function EkmekRaporPage() {
  return (
    <div className="space-y-6">
      <ReportPageHeader
        eyebrow="Raporlar"
        title="Ekmek Yardimi Raporu"
        actions={<button type="button" className={reportHeaderGhostButton} onClick={() => window.print()}>Yazdır (Ctrl+P)</button>}
      />
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600">Ekmek yardimi raporu modulu gelistirilme asamasindadir...</p>
      </div>
    </div>
  )
}
