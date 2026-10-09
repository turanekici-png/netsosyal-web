'use client'

// Herhangi bir liste ekranında (Dosyalar, Bireyler, Yardım Raporları, Online
// Başvurular vb.) seçili kayıtların TAMAMINA aynı mesajı WhatsApp üzerinden
// toplu göndermek için yeniden kullanılabilir buton + modal. Çağıran sayfa
// sadece seçili satırları {id, phone, label} biçimine çevirip `recipients`
// prop'una verir - gerçek gönderim mantığı (sunucudaki tek kurum oturumu
// üzerinden, arka planda, gecikmeli) burada ve
// lib/services/whatsappBulk.service.ts'de yönetilir.

import { useEffect, useRef, useState } from 'react'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'
import { applyMessageTemplateTokens, MESSAGE_TEMPLATE_TOKEN_DEFINITIONS, type MessageTemplateTokenValues } from '@/lib/messageTemplateTokens'

export interface BulkWhatsappRecipient {
  id: string
  phone: string | null | undefined
  label?: string | null
  // "(isim)", "(telefon)", "(iban)" gibi kisayollarin BU alici icin
  // gonderim ANINDA yerine konulacagi degerler - cagiran sayfa satirdan
  // cikarabildigi kadarini doldurur (bkz. lib/messageTemplateTokens.ts).
  // Eksik/bilinmeyen alanlar "-" olarak gonderilir.
  tokens?: MessageTemplateTokenValues
  // Kullanici istegi: toplu gonderilen mesajlar da o dosyanin Dosya Yonetimi
  // > "Mesaj Raporlari" ekraninda gorunsun (bkz. app/api/documents/
  // message-log/route.ts - dosyano/dosyaid'e gore eslestirir). Verilirse
  // sunucudaki loglama (sms_gonderim_log) bu alanlarla kaydedilir - bkz.
  // lib/services/whatsappBulk.service.ts.
  dosyaNo?: string | null
  dosyaId?: string | null
}

interface BulkResultItem {
  id: string
  phone: string
  label: string
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  error?: string
}

interface BulkJobState {
  status: 'idle' | 'running' | 'completed' | 'cancelled'
  total: number
  processed: number
  message: string
  results: BulkResultItem[]
  startedAt: number | null
  finishedAt: number | null
}

interface BulkWhatsappSendButtonProps {
  recipients: BulkWhatsappRecipient[]
  buttonLabel?: string
  // "Filtrelenen Tümünü Seç" ile tüm sayfalardaki alıcılar sunucudan
  // çözülürken (bkz. ManagedReportTablePage.tsx) butonun tıklanmasını
  // engellemek için - o an "recipients" henüz eski/eksik olabilir.
  disabled?: boolean
  className?: string
}

const statusLabels: Record<BulkResultItem['status'], string> = {
  pending: 'Bekliyor',
  sent: 'Gönderildi',
  failed: 'Başarısız',
  skipped: 'Atlandı',
}

const statusClasses: Record<BulkResultItem['status'], string> = {
  pending: 'bg-slate-100 text-slate-600',
  sent: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-700',
  skipped: 'bg-amber-100 text-amber-800',
}

export function BulkWhatsappSendButton({ recipients, buttonLabel, disabled, className }: BulkWhatsappSendButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [job, setJob] = useState<BulkJobState | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const validCount = recipients.filter((r) => normalizeWhatsappPhoneNumber(r.phone)).length
  const invalidCount = recipients.length - validCount

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const pollStatus = async () => {
    try {
      const response = await fetch('/api/whatsapp/bulk-status')
      const payload = await response.json()
      if (payload?.success) {
        setJob(payload.data)
        if (payload.data.status !== 'running') {
          stopPolling()
        }
      }
    } catch {
      // bir sonraki pollde tekrar denenir
    }
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  const openModal = () => {
    setMessage('')
    setStatus('')
    setJob(null)
    setIsOpen(true)
  }

  // Kullanici istegi: pencere kapatildiginda "Dışa Aktar & İletişim" acilir
  // menusu de KENDINI KAPATSIN - bkz. BulkSmsSendButton.tsx'teki ayni not.
  const closeModal = () => {
    stopPolling()
    setIsOpen(false)
    requestAnimationFrame(() => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  const handleStart = async () => {
    if (!message.trim()) {
      setStatus('Mesaj metni boş olamaz.')
      return
    }
    if (validCount === 0) {
      setStatus('Seçili kayıtların hiçbirinde geçerli bir telefon numarası yok.')
      return
    }

    setIsStarting(true)
    setStatus('')
    try {
      const trimmedMessage = message.trim()
      const response = await fetch('/api/whatsapp/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmedMessage,
          recipients: recipients.map((r) => ({
            id: r.id,
            phone: r.phone,
            label: r.label,
            dosyaNo: r.dosyaNo,
            dosyaId: r.dosyaId,
            // Mesajdaki kisayollar, HER ALICI icin KENDI verisiyle burada
            // (gonderim baslatilmadan hemen once) yerine konulur - sunucuya
            // artik kisiye ozel NIHAI metin gider (bkz.
            // lib/messageTemplateTokens.ts, whatsappBulk.service.ts).
            personalizedMessage: r.tokens ? applyMessageTemplateTokens(trimmedMessage, r.tokens) : undefined,
          })),
        }),
      })
      const payload = await response.json()
      if (!payload?.success) {
        setStatus(payload?.error || 'Toplu gönderim başlatılamadı.')
        setIsStarting(false)
        return
      }

      void pollStatus()
      pollRef.current = setInterval(() => void pollStatus(), 2000)
    } catch {
      setStatus('Toplu gönderim başlatılamadı - sunucuya ulaşılamadı.')
    } finally {
      setIsStarting(false)
    }
  }

  // Kullanici istegi (bkz. BulkSmsSendButton.tsx'teki ayni not): kisayol
  // butonlarina tiklandiginda token mesajin SONUNA degil, textarea'da
  // imlecin O AN durdugu yere eklensin.
  const insertTokenAtCursor = (token: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setMessage((prev) => prev + token)
      return
    }
    const start = textarea.selectionStart ?? message.length
    const end = textarea.selectionEnd ?? message.length
    const next = message.slice(0, start) + token + message.slice(end)
    setMessage(next)
    const nextCursor = start + token.length
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const handleCancel = async () => {
    try {
      await fetch('/api/whatsapp/bulk-cancel', { method: 'POST' })
    } catch {
      // durum bir sonraki pollde tekrar okunur
    }
  }

  const isRunning = job?.status === 'running'
  const sentCount = job?.results.filter((r) => r.status === 'sent').length || 0
  const failedCount = job?.results.filter((r) => r.status === 'failed').length || 0
  const skippedCount = job?.results.filter((r) => r.status === 'skipped').length || 0

  return (
    <>
      {/* Kullanici istegi/hata raporu ("Toplu Gönder'e basınca mesaj
          sayfası açılmıyor"): bu buton, ManagedReportTablePage.tsx'teki
          "Sayfaya Özel İşlemler" ACILIR MENUSU (ToolbarDropdown) icinde
          kullaniliyor - o menu, ICINDEKI HERHANGI bir <button>'a tiklaninca
          KENDINI OTOMATIK KAPATIYORDU (diger, "tikla ve BITSIN" turu
          butonlar icin dogru davranis). Ama bu buton TIKLANINCA ISLEMI
          BITIRMIYOR, sadece BU BILESENIN KENDI ic durumunda bir modal
          aciyor - menu aninda kapanip TUM alt agacini (bu bileseni,
          henuz set edilen "isOpen" durumuyla BIRLIKTE) unmount edince,
          modal HIC render OLMADAN yok oluyordu. "data-keep-menu-open"
          isareti, ToolbarDropdown'a bu buton (ve asagidaki modal icindeki
          TUM butonlar - Gönder/İptal/✕ dahil) icin otomatik kapatmayi
          ATLAMASINI soyler. */}
      <button
        type="button"
        data-keep-menu-open
        onClick={openModal}
        disabled={recipients.length === 0 || disabled}
        className={className || 'inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-xs font-black text-white shadow-sm hover:brightness-110 disabled:pointer-events-none disabled:opacity-50'}
      >
        {buttonLabel || `WhatsApp'tan Toplu Gönder (${recipients.length})`}
      </button>

      {isOpen && (
        // "data-modal-active" (asagida) - "data-keep-menu-open"DEN AYRI bir
        // isaret: o (yukaridaki trigger buton da dahil) SADECE ayni anki
        // SENKRON tiklamada menu panelinin "bir butona tiklandi, kapat"
        // mantigini atlatmak icin var, o buton HER ZAMAN DOM'dadir (modal
        // kapaliyken bile). Oysa ToolbarDropdown'daki GENEL (window click/
        // keydown/scroll) kapatma dinleyicileri "data-keep-menu-open" varligini
        // TUM belgede aradigi icin, o hep-var-olan trigger butonu YANLISLIKLA
        // "bir modal hala acik" sanip TÜM diger acilir menulerin de
        // kapanmasini engelliyordu (hata raporu: "ekranda açık kalıyor").
        // "data-modal-active" SADECE modal GERCEKTEN acikken (bu blok
        // render olurken) var olur - ToolbarDropdown'in genel kapatma
        // kontrolu artik BUNU arar.
        <div data-keep-menu-open data-modal-active className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-emerald-700 via-teal-600 to-sky-600 px-6 py-5 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl ring-1 ring-white/30">💬</span>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide text-white/80">Toplu Gönderim</p>
                  <h3 className="text-xl font-black">WhatsApp&apos;tan Toplu Gönder</h3>
                </div>
              </div>
              <button type="button" onClick={closeModal} className="rounded-full bg-white/15 px-2.5 py-1 text-sm font-black hover:bg-white/25">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {!job && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                  {/* SOL: mesaj alani */}
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                      <span>Seçili kayıt: <span className="text-slate-950">{recipients.length}</span></span>
                      <span className="text-slate-300">·</span>
                      <span>Geçerli numara: <span className="text-emerald-700">{validCount}</span></span>
                      {invalidCount > 0 && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span>Geçersiz/eksik: <span className="text-rose-600">{invalidCount}</span></span>
                        </>
                      )}
                    </div>
                    {invalidCount > 0 && (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        Geçersiz/eksik numaralı {invalidCount} kayıt otomatik olarak atlanacak, sadece geçerli numaralara gönderim yapılacak.
                      </p>
                    )}
                    <label className="flex flex-1 flex-col gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wide text-slate-500">Mesaj</span>
                      <textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        rows={12}
                        placeholder="Tüm seçili kişilere gönderilecek mesajı yazın..."
                        className="min-h-[240px] flex-1 rounded-xl border-2 border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 shadow-inner outline-none focus:border-emerald-500"
                      />
                    </label>
                    <p className="text-[11px] font-semibold text-slate-400">
                      Mesajlar WhatsApp&apos;ın kısıtlama riskine karşı, art arda değil, aralarında birkaç saniye gecikmeyle gönderilir - çok sayıda kayıt seçtiyseniz gönderim biraz zaman alabilir.
                    </p>
                    {status && (
                      <div className="rounded-lg border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{status}</div>
                    )}
                  </div>

                  {/* SAG: kisayollar - her aliciya GONDERIM ANINDA KENDI
                      verisiyle degistirilir (bkz. lib/messageTemplateTokens.ts,
                      handleStart). */}
                  <div className="flex flex-col gap-2 rounded-2xl border-2 border-emerald-200 bg-gradient-to-b from-emerald-50 via-teal-50/60 to-white p-4">
                    <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-emerald-800">
                      <span className="text-base leading-none">⚡</span>
                      Kısayollar
                    </p>
                    <p className="text-[11px] font-semibold text-emerald-700/80">
                      Tıklayınca mesaja eklenir - gönderim anında her kişiye kendi bilgisiyle gider.
                    </p>
                    <div className="mt-1 flex flex-col gap-1.5 overflow-y-auto pr-1">
                      {MESSAGE_TEMPLATE_TOKEN_DEFINITIONS.map((def) => (
                        <button
                          key={def.token}
                          type="button"
                          title={def.description}
                          onClick={() => insertTokenAtCursor(def.token)}
                          className="flex w-full items-center gap-2.5 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md"
                        >
                          <span className="shrink-0 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 px-2 py-1 font-mono text-[11px] font-black text-white">
                            {def.token}
                          </span>
                          <span className="text-[11.5px] font-semibold leading-tight text-slate-600">{def.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {job && (
                <div className="space-y-4">
                  {job.status === 'running' && (
                    <div className="flex items-start gap-2 rounded-lg border-2 border-sky-200 bg-sky-50 px-4 py-3 text-xs font-bold text-sky-800">
                      <span className="mt-0.5 text-base leading-none">ℹ️</span>
                      <span>
                        Gönderim WhatsApp&apos;ın kısıtlama riskine karşı yavaş ve kasıtlı olarak sunucuda arka planda çalışır -
                        bu pencereyi kapatıp diğer işlerinize devam edebilirsiniz, gönderim durmaz.
                        İlerlemeyi üst menüdeki &quot;Toplu Gönderim&quot; göstergesinden takip edebilirsiniz.
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm font-black text-slate-700">
                    <span>
                      {job.status === 'running' && 'Gönderiliyor...'}
                      {job.status === 'completed' && 'Tamamlandı'}
                      {job.status === 'cancelled' && 'İptal Edildi'}
                    </span>
                    <span>{job.processed} / {job.total}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
                      style={{ width: `${job.total ? Math.round((job.processed / job.total) * 100) : 0}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">Gönderildi: {sentCount}</span>
                    {failedCount > 0 && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">Başarısız: {failedCount}</span>}
                    {skippedCount > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">Atlandı: {skippedCount}</span>}
                  </div>

                  <div className="max-h-64 overflow-y-auto rounded-lg border-2 border-slate-100">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-left font-black text-slate-500">
                        <tr>
                          <th className="px-2.5 py-2">Kişi</th>
                          <th className="px-2.5 py-2">Numara</th>
                          <th className="px-2.5 py-2">Durum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.results.map((item) => (
                          <tr key={item.id} className="border-t border-slate-100">
                            <td className="px-2.5 py-1.5 font-bold text-slate-700">{item.label}</td>
                            <td className="px-2.5 py-1.5 text-slate-500">{item.phone}</td>
                            <td className="px-2.5 py-1.5">
                              <span className={`rounded-full px-2 py-0.5 font-black ${statusClasses[item.status]}`}>
                                {statusLabels[item.status]}
                                {item.error ? ` - ${item.error}` : ''}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              {!job && (
                <>
                  <button type="button" onClick={closeModal} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600 hover:bg-slate-50">
                    İptal
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleStart()}
                    disabled={isStarting || validCount === 0}
                    className="rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2 text-sm font-extrabold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isStarting ? 'Başlatılıyor...' : `Gönder (${validCount})`}
                  </button>
                </>
              )}
              {job && isRunning && (
                <>
                  <button type="button" onClick={() => void handleCancel()} className="rounded-md border-2 border-rose-200 bg-rose-50 px-4 py-2 text-sm font-extrabold text-rose-700 hover:bg-rose-100">
                    İptal Et
                  </button>
                  <button type="button" onClick={closeModal} className="rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2 text-sm font-extrabold text-white shadow-sm hover:brightness-110">
                    Arka Planda Devam Et
                  </button>
                </>
              )}
              {job && !isRunning && (
                <button type="button" onClick={closeModal} className="rounded-md bg-slate-800 px-5 py-2 text-sm font-extrabold text-white hover:bg-slate-900">
                  Kapat
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
