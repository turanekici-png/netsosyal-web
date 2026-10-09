import type { ReactNode } from 'react'

// Kullanici istegi (2026-09-30, 10. tur): sekmeler artik (Nakit Yardimi ile
// AYNI yontemle) her sayfanin kendi ManagedReportTablePage cagrisinda
// "afterHeader" ile, basligin ALTINDA render ediliyor - bu sarmalayici
// eskiden AssistanceModeTabs'i basligin USTUNDE gosteriyordu, artik sadece
// children'i geçiriyor.
export default function GiyimAssistanceLayout({ children }: { children: ReactNode }) {
  return children
}
