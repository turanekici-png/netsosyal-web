'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export const dynamic = "force-dynamic"

// "/workflow" (ciplak yol) kendi basina bir ekran degil - gercek Is Akisi
// sayfalari /workflow/on-inceleme, /workflow/tahkikat, /workflow/guncelleme,
// /workflow/sonuc altinda (bkz. components/layout/sidebar.tsx alt menusu).
// Bu sayfa sadece ilk alt sayfaya yonlendirir; hedefte yetkisi yoksa
// proxy.ts (resolveAllowedRedirect) onu zaten erisimi olan baska bir
// sayfaya yonlendirir - burada ayrica yetki kontrolu GEREKMEZ.
export default function WorkflowRootPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/workflow/on-inceleme')
  }, [router])

  return null
}
