import type { ReactNode } from 'react'

// 2026-10-14: telefon (<641px) icin tek tip yazi olcegi - Dosya Yonetimi'ndeki
// ile ayni (bkz. app/globals.css ".ns-mobil-tip"). display: contents ile sayfa
// duzeni (flex/yukseklik) HIC degismez; yalniz yazi boyutlari miras alinir.
export default function MobilTipografiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ns-mobil-tip" style={{ display: 'contents' }}>
      {children}
    </div>
  )
}
