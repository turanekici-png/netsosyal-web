'use client'

import { useEffect, useRef, useState } from 'react'
import {
  type CameraPermissionResult,
  type CardReaderStatus,
  type PrintAgentStatus,
  checkCardReaderStatus,
  checkPrintAgentStatus,
  downloadPrintAgentInstaller,
  primeCameraPermission,
  writeCachedPrinterNames,
} from '@/lib/printAgentClient'
import { type PushStatus, getPushStatus, subscribeToPush, unsubscribeFromPush } from '@/lib/pushClient'

const STATUS_REFRESH_INTERVAL_MS = 120000

export function WorkstationSetupButton() {
  const [status, setStatus] = useState<PrintAgentStatus | null>(null)
  const [cardReaderStatus, setCardReaderStatus] = useState<CardReaderStatus | null>(null)
  const [cameraResult, setCameraResult] = useState<CameraPermissionResult | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null)
  const [isPushBusy, setIsPushBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const refreshPushStatus = async () => {
    const next = await getPushStatus()
    setPushStatus(next)
    return next
  }

  const refreshAgentStatus = async () => {
    const nextStatus = await checkPrintAgentStatus()
    setStatus(nextStatus)
    if (nextStatus.state === 'ok') {
      writeCachedPrinterNames(nextStatus.printers)
    }
    return nextStatus
  }

  const refreshCardReaderStatus = async () => {
    const nextCardReaderStatus = await checkCardReaderStatus()
    setCardReaderStatus(nextCardReaderStatus)
    return nextCardReaderStatus
  }

  useEffect(() => {
    let isCancelled = false

    const runBackgroundCheck = async () => {
      const [nextStatus, nextCardReaderStatus] = await Promise.all([
        checkPrintAgentStatus(),
        checkCardReaderStatus(),
      ])
      if (isCancelled) return
      setStatus(nextStatus)
      setCardReaderStatus(nextCardReaderStatus)
      if (nextStatus.state === 'ok') {
        writeCachedPrinterNames(nextStatus.printers)
      }
    }

    runBackgroundCheck()
    const intervalId = window.setInterval(() => {
      void runBackgroundCheck()
    }, STATUS_REFRESH_INTERVAL_MS)

    void refreshPushStatus()

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!isPanelOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsPanelOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isPanelOpen])

  const runSetup = async () => {
    setIsRunning(true)
    try {
      const [nextStatus, nextCameraResult, , nextCardReaderStatus] = await Promise.all([
        refreshAgentStatus(),
        primeCameraPermission(),
        refreshPushStatus(),
        refreshCardReaderStatus(),
      ])
      setCameraResult(nextCameraResult)

      // ONEMLI: agent ULASILABILIR ("state === 'ok'") olsa bile SURUMU ESKI
      // olabilir - bu durumda agent yanit verdigi icin asagidaki kosul
      // "outdated" kontrolu OLMADAN hic tetiklenmiyordu, yani sürüm
      // yukseltmelerinden sonra "Yeniden Tara" hicbir sey indirmiyordu
      // (arayuz "surumu eski" yazsa bile). Kullanicinin bildirdigi "agent
      // dosyasini indirmedi" sikayetinin gercek sebebi buydu - simdi
      // outdated durumunda da indirme tetikleniyor. Kart okuyucu servisi
      // calismiyorsa (agent ulasilabilir olsa bile) da ayni indirme/kurulum
      // tetiklenir - zip artik ikisini birden kurar (bkz. package/route.ts).
      if (
        nextStatus.state !== 'ok' ||
        nextStatus.outdated ||
        nextCameraResult.blockedByInsecureOrigin ||
        (nextCardReaderStatus.state === 'ok' && !nextCardReaderStatus.running)
      ) {
        downloadPrintAgentInstaller()
      }
    } finally {
      setIsRunning(false)
    }
  }

  const togglePush = async () => {
    setIsPushBusy(true)
    try {
      const current = pushStatus ?? (await refreshPushStatus())
      if (current.subscribed) {
        await unsubscribeFromPush()
      } else {
        const result = await subscribeToPush()
        if (!result.success) {
          alert(result.error || 'Masaüstü bildirimleri açılamadı.')
        }
      }
      await refreshPushStatus()
    } finally {
      setIsPushBusy(false)
    }
  }

  const isReady = status?.state === 'ok' && !status.outdated
  const badgeColor = status === null
    ? 'bg-slate-300'
    : isReady
      ? 'bg-emerald-500'
      : status.state === 'ok' && status.outdated
        ? 'bg-amber-500'
        : 'bg-rose-500'

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setIsPanelOpen((current) => !current)}
        title="Bu bilgisayarın yazıcı, kamera ve kart okuyucu kurulumunu kontrol et"
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-[#0076b6] hover:text-[#0076b6] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-sky-600"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M6 9V3h12v6" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        <span className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-800 ${badgeColor}`} />
      </button>

      {isPanelOpen && (
        <div className="absolute right-0 top-12 z-[3000] w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="bg-gradient-to-r from-[#005f95] via-[#0076b6] to-emerald-600 px-4 py-3 text-white">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-100">Bu Bilgisayar</p>
            <h3 className="mt-0.5 text-sm font-black">Yazıcı, Kamera ve Kart Okuyucu Kurulumu</h3>
          </div>

          <div className="space-y-3 p-4">
            <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${badgeColor}`} />
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-800 dark:text-slate-100">Yazdırma Servisi</p>
                {status === null && (
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Kontrol ediliyor...</p>
                )}
                {status?.state === 'ok' && !status.outdated && (
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    Çalışıyor - {status.printers.length > 0 ? `${status.printers.length} yazıcı bulundu` : 'yazıcı bulunamadı'}
                  </p>
                )}
                {status?.state === 'ok' && status.outdated && (
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                    Çalışıyor ama sürümü eski ({status.agentVersion || 'bilinmiyor'}). Kurulum dosyasını yeniden indirin.
                  </p>
                )}
                {status?.state === 'unreachable' && (
                  <p className="text-xs font-bold text-rose-700 dark:text-rose-400">
                    Kurulu değil veya kapalı. Kurulumu Çalıştır&apos;a basın.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  cardReaderStatus === null
                    ? 'bg-slate-300'
                    : cardReaderStatus.state === 'ok' && cardReaderStatus.running
                      ? 'bg-emerald-500'
                      : cardReaderStatus.state === 'ok'
                        ? 'bg-rose-500'
                        : 'bg-slate-300'
                }`}
              />
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-800 dark:text-slate-100">NFC Kart Okuyucu</p>
                {cardReaderStatus === null && (
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Kontrol ediliyor...</p>
                )}
                {cardReaderStatus?.state === 'ok' && cardReaderStatus.running && (
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    Çalışıyor - &quot;Kart No&quot; alanına tıklayıp kartı okutabilirsiniz.
                  </p>
                )}
                {cardReaderStatus?.state === 'ok' && !cardReaderStatus.running && (
                  <p className="text-xs font-bold text-rose-700 dark:text-rose-400">
                    Kurulu değil veya kapalı. Kurulumu Çalıştır&apos;a basın.
                  </p>
                )}
                {cardReaderStatus?.state === 'unreachable' && (
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Durumu görmek için önce Yazdırma Servisi&apos;nin çalışıyor olması gerekir.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  cameraResult === null
                    ? 'bg-slate-300'
                    : cameraResult.granted
                      ? 'bg-emerald-500'
                      : cameraResult.hasCamera
                        ? 'bg-rose-500'
                        : 'bg-amber-500'
                }`}
              />
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-800 dark:text-slate-100">Kamera</p>
                {cameraResult === null && (
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Henüz kontrol edilmedi.</p>
                )}
                {cameraResult?.granted && (
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Bulundu ve izin verildi.</p>
                )}
                {cameraResult && !cameraResult.granted && cameraResult.hasCamera && (
                  <p className="text-xs font-bold text-rose-700 dark:text-rose-400">{cameraResult.error || 'İzin verilmedi.'}</p>
                )}
                {cameraResult && !cameraResult.granted && !cameraResult.hasCamera && (
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400">{cameraResult.error || 'Bu bilgisayarda takılı kamera bulunamadı.'}</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  pushStatus === null
                    ? 'bg-slate-300'
                    : pushStatus.subscribed
                      ? 'bg-emerald-500'
                      : pushStatus.supported
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-slate-800 dark:text-slate-100">Masaüstü Bildirimleri</p>
                {pushStatus === null && (
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Kontrol ediliyor...</p>
                )}
                {pushStatus?.subscribed && (
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    Açık - onay bekleyen işlemler bu bilgisayara bildirim olarak düşer.
                  </p>
                )}
                {pushStatus && !pushStatus.subscribed && pushStatus.supported && (
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400">Kapalı - açmak için aşağıdaki butonu kullanın.</p>
                )}
                {pushStatus && !pushStatus.supported && (
                  <p className="text-xs font-bold text-rose-700 dark:text-rose-400">
                    Bu bilgisayarda henüz açılamıyor. Daha önce &quot;Kurulumu Çalıştır&quot; yaptıysanız, yazıcı/kamera bulunmuş olması bunun ayrı çalıştığını GÖSTERMEZ - etkili olması için Chrome/Edge&apos;in TÜM pencereleri kapatılıp (Görev Yöneticisi&apos;nde arka planda kalan chrome.exe/msedge.exe varsa onlar da sonlandırılıp) yeniden açılması gerekir. Kontrol için adres çubuğuna <b>chrome://policy</b> (Edge&apos;te <b>edge://policy</b>) yazıp &quot;OverrideSecurityRestrictionsOnInsecureOrigin&quot; satırını arayın.
                  </p>
                )}
                {pushStatus?.supported && (
                  <button
                    type="button"
                    onClick={() => void togglePush()}
                    disabled={isPushBusy}
                    className="mt-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {isPushBusy ? 'İşleniyor...' : pushStatus.subscribed ? 'Bildirimleri Kapat' : 'Bildirimleri Aç'}
                  </button>
                )}
              </div>
            </div>

            {(status?.state === 'unreachable' || cameraResult?.blockedByInsecureOrigin || pushStatus?.supported === false || (cardReaderStatus?.state === 'ok' && !cardReaderStatus.running)) && (
              <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] font-bold leading-5 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                İnen .zip dosyasını açın (sağ tık → Tümünü Ayıkla), içindeki <b>install.bat</b>&apos;a bir kez çift tıklayın. Kurulum otomatik tamamlanır; yazdırma servisi ve (varsa) NFC kart okuyucu servisi bu bilgisayar her açıldığında kendiliğinden başlar
                {(cameraResult?.blockedByInsecureOrigin || pushStatus?.supported === false) && ' , kamera izni ve masaüstü bildirimleri açılır (etkili olması için kurulumdan sonra Chrome/Edge\'i tamamen kapatıp yeniden açın)'}.
                {' '}Tarayıcı &quot;güvenli olmayan indirme&quot; uyarısı gösterirse indirme çubuğundaki oku açıp <b>Tut/Sakla</b>&apos;ya basın.
              </p>
            )}

            <button
              type="button"
              onClick={() => void runSetup()}
              disabled={isRunning}
              className="w-full rounded-lg bg-gradient-to-r from-[#005f95] via-[#0076b6] to-emerald-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRunning ? 'Kontrol Ediliyor...' : isReady ? 'Yeniden Tara' : 'Kurulumu Çalıştır'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
