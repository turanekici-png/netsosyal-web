'use client'

import { useEffect, useState } from 'react'

// Is Akisi "bu kayit uzerinde kim calisiyor" (2026-10-14) - bkz.
// app/api/workflow/presence/route.ts. Uyari mekanizmasi; kimseyi engellemez.

export type WorkflowListe = 'on-inceleme' | 'tahkikat' | 'guncelleme'
export type WorkflowLock = { fileId: string; userId: string | null; userName: string; since: string }

const ENDPOINT = '/api/workflow/presence'
const SINYAL_MS = 15_000
const YOKLAMA_MS = 8_000

// Sekme basina rastgele oturum kimligi - kendi actigim kaydi kirmizi gormeyeyim.
let oturumId: string | null = null
function getOturumId() {
  if (oturumId) return oturumId
  const rastgele = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  oturumId = rastgele.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64)
  return oturumId
}

function gonder(islem: 'tut' | 'birak', liste: WorkflowListe, dosyaId: string, keepalive = false) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ islem, liste, dosyaId, oturumId: getOturumId() }),
    keepalive,
    cache: 'no-store',
  }).catch(() => undefined)
}

// Listedeki ACIK kayitlar (baskalarinin) - fileId -> kilit bilgisi.
export function useWorkflowLocks(liste: WorkflowListe): Map<string, WorkflowLock> {
  const [kilitler, setKilitler] = useState<Map<string, WorkflowLock>>(() => new Map())

  useEffect(() => {
    let iptal = false
    const yukle = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const response = await fetch(`${ENDPOINT}?liste=${encodeURIComponent(liste)}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => null)
        if (iptal || !response.ok || !payload?.success || !Array.isArray(payload.data)) return
        const benim = getOturumId()
        const yeni = new Map<string, WorkflowLock>()
        for (const row of payload.data as Array<WorkflowLock & { sessionId: string }>) {
          if (row.sessionId === benim) continue
          if (!yeni.has(row.fileId)) yeni.set(row.fileId, { fileId: row.fileId, userId: row.userId, userName: row.userName, since: row.since })
        }
        setKilitler(yeni)
      } catch {
        /* bilgi alinamazsa liste eskisi gibi calisir */
      }
    }
    void yukle()
    const zamanlayici = window.setInterval(() => void yukle(), YOKLAMA_MS)
    const gorunurluk = () => { if (document.visibilityState === 'visible') void yukle() }
    document.addEventListener('visibilitychange', gorunurluk)
    return () => {
      iptal = true
      window.clearInterval(zamanlayici)
      document.removeEventListener('visibilitychange', gorunurluk)
    }
  }, [liste])

  return kilitler
}

// 2026-10-15 kullanici istegi: "bu uyari sadece o dosya uzerinde CALISAN
// biri varsa gelsin". Onceden form acik kaldigi surece (arka plandaki,
// Chrome'un uyuttugu bir sekmede bile - uyandikca tek sinyal atip 45 sn
// kilit olusturuyordu) kayit tutuluyordu. Artik kilit yalnizca son
// ETKINLIK_SURESI_MS icinde sayfada gercek bir islem (tiklama, yazma,
// kaydirma) varsa tutulur; hareketsiz / arka plandaki sekme kilidi birakir.
const ETKINLIK_SURESI_MS = 10 * 60_000

// Rapor penceresi ACIKKEN ve kullanici calisirken bu kaydi "tutar";
// kapaninca / sekme kapaninca / hareketsiz kalinca birakir.
export function useHoldWorkflowRecord(liste: WorkflowListe, dosyaId: string | null | undefined) {
  useEffect(() => {
    if (!dosyaId) return
    const id = String(dosyaId)
    let sonEtkinlik = Date.now()
    let tutuyor = false

    const tut = () => { tutuyor = true; void gonder('tut', liste, id) }
    const birak = () => { if (tutuyor) { tutuyor = false; void gonder('birak', liste, id, true) } }
    const calisiyorMu = () => Date.now() - sonEtkinlik < ETKINLIK_SURESI_MS

    const sinyal = () => { if (calisiyorMu()) tut(); else birak() }
    const etkinlik = () => {
      const bekliyordu = !tutuyor
      sonEtkinlik = Date.now()
      if (bekliyordu) tut()
    }

    tut()
    const zamanlayici = window.setInterval(sinyal, SINYAL_MS)
    const olaylar = ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'] as const
    for (const olay of olaylar) window.addEventListener(olay, etkinlik, { passive: true, capture: true })
    const ayrilis = () => birak()
    window.addEventListener('pagehide', ayrilis)
    return () => {
      window.clearInterval(zamanlayici)
      for (const olay of olaylar) window.removeEventListener(olay, etkinlik, { capture: true })
      window.removeEventListener('pagehide', ayrilis)
      tutuyor = true
      birak()
    }
  }, [liste, dosyaId])
}

// "12:34" (Turkiye saati) - metinde ek ('ten/'dan) kullanilmaz, saate gore degisir.
export function formatLockSince(since: string) {
  const tarih = new Date(since)
  if (Number.isNaN(tarih.getTime())) return ''
  return tarih.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
}

// Kirmizi kayda tiklayinca sorulan onay metni (uc liste ortak)
export function workflowLockConfirmText(lock: WorkflowLock) {
  return `${lockWarningText(lock)}. Aynı anda iki kişinin çalışması kayıtların birbirini ezmesine yol açabilir. Yine de açmak istiyor musunuz?`
}

export function lockWarningText(lock: WorkflowLock) {
  const saat = formatLockSince(lock.since)
  return `${lock.userName} bu rapor üzerinde çalışıyor${saat ? ` · açılış ${saat}` : ''}`
}
