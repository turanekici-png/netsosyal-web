'use client'

export function PrintButton() {
  return (
    <button 
      onClick={() => window.print()} 
      className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-black text-amber-900 shadow-sm transition hover:bg-amber-100"
    >
      Yazdır (Ctrl+P)
    </button>
  )
}
