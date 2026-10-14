'use client'

import { useEffect, useState } from 'react'

// Is Akisi bekleyen dosya sayilari (2026-10-14) - sol menu VE Dosya
// Yönetimi > Hızlı İşlemler kisayollari AYNI veriyi gosterir. Modul
// duzeyinde TEK durum tutulur: kac bilesen kullanirsa kullansin ayni anda
// tek istek gider (bkz. /api/workflow/counts - listelerle ayni kural).

export type WorkflowCounts = { onInceleme: number; tahkikat: number; sonucBekleyen: number }

// Kisayol yolu -> sayac anahtari (sidebar ve Hızlı İşlemler ortak)
export const WORKFLOW_COUNT_PATHS: Record<string, keyof WorkflowCounts> = {
  '/workflow/on-inceleme': 'onInceleme',
  '/workflow/tahkikat': 'tahkikat',
  '/workflow/guncelleme': 'sonucBekleyen',
}

const YENILEME_MS = 90_000
let sonDeger: WorkflowCounts | null = null
let sonYukleme = 0
let devamEden: Promise<void> | null = null
const dinleyiciler = new Set<(deger: WorkflowCounts | null) => void>()

async function yukle(zorla = false) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (!zorla && Date.now() - sonYukleme < 5_000) return
  if (devamEden) return devamEden
  devamEden = (async () => {
    try {
      const response = await fetch('/api/workflow/counts', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.success && payload.data) {
        sonDeger = payload.data as WorkflowCounts
        sonYukleme = Date.now()
        dinleyiciler.forEach((dinle) => dinle(sonDeger))
      }
    } catch {
      /* sayac gosterilemezse arayuz eskisi gibi calisir */
    } finally {
      devamEden = null
    }
  })()
  return devamEden
}

// tetikleyici: degistiginde (ör. pathname) sayilar yeniden alinir.
export function useWorkflowCounts(tetikleyici?: unknown): WorkflowCounts | null {
  const [deger, setDeger] = useState<WorkflowCounts | null>(sonDeger)

  useEffect(() => {
    dinleyiciler.add(setDeger)
    const zamanlayici = window.setInterval(() => void yukle(true), YENILEME_MS)
    return () => {
      dinleyiciler.delete(setDeger)
      window.clearInterval(zamanlayici)
    }
  }, [])

  useEffect(() => {
    void yukle()
  }, [tetikleyici])

  return deger
}
