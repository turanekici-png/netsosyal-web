'use client'

// Herhangi bir liste ekranında (Dosyalar, Bireyler, Yardım Raporları, Nakit
// Müracaatları vb.) seçili kayıtların TAMAMINA aynı mesajı SMS üzerinden
// toplu göndermek için yeniden kullanılabilir buton + modal. BulkWhatsapp
// SendButton.tsx ile BİREBİR aynı desendedir (çağıran sayfa sadece seçili
// satırları {id, phone, label} biçimine çevirip `recipients` prop'una verir) -
// gerçek gönderim mantığı sunucudaki Ayarlar > SMS Entegrasyonu'nda tanımlı
// AKTİF firma üzerinden, arka planda yönetilir (bkz. lib/services/
// smsBulk.service.ts).

import { useEffect, useRef, useState } from 'react'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'
import { applyMessageTemplateTokens, MESSAGE_TEMPLATE_TOKEN_DEFINITIONS, type MessageTemplateTokenValues } from '@/lib/messageTemplateTokens'

interface SmsTemplateOption {
  id: string
  title: string
  text: string
}

// Kullanici istegi: Ayarlar > SMS Entegrasyonu > SMS Şablonları'nda kayitli
// hazir sablonlar {adSoyad}/{dosyaNo}/{kurum} gibi SUSLU PARANTEZ bicimini
// kullanir (bkz. settings/page.tsx) - bu toplu gonderim ekraninin KENDI
// kisisellestirme sistemi ise PARANTEZ tokenlari kullanir (bkz.
// lib/messageTemplateTokens.ts, ör. "(isim)"). Bir sablon secildiginde,
// esleşen alanlar OTOMATIK olarak bu ekranin token bicimine cevrilir -
// "{kurum}" TUM aliciler icin AYNI oldugundan (kisisellestirme gerekmez)
// dogrudan GERCEK degeriyle (senderTitle) degistirilir. "{tc}" icin ise bu
// ekranda bir karsilik OLMADIGINDAN (TC kisisellestirmesi yok) OLDUGU GIBI
// birakilir, kullanici gondermeden once gozden gecirmelidir (asagidaki
// uyari notu bunu belirtir).
function convertSavedTemplateToBulkTokens(text: string, senderTitle: string): string {
  return text
    .replaceAll('{adSoyad}', '(isim)')
    .replaceAll('{dosyaNo}', '(dosyano)')
    .replaceAll('{kurum}', senderTitle || 'Kurum')
}

export interface BulkSmsRecipient {
  id: string
  phone: string | null | undefined
  label?: string | null
  tokens?: MessageTemplateTokenValues
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

interface BulkSmsSendButtonProps {
  recipients: BulkSmsRecipient[]
  buttonLabel?: string
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

export function BulkSmsSendButton({ recipients, buttonLabel, disabled, className }: BulkSmsSendButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [job, setJob] = useState<BulkJobState | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Kullanici istegi: kayitli SMS sablonlarindan secip herkese o sablonu
  // gonderebilsin - bkz. app/api/sms/templates (SADECE aktif sablonlarin
  // id/başlık/metnini döner, SMS saglayici kimlik bilgilerini ICERMEZ).
  const [templates, setTemplates] = useState<SmsTemplateOption[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  // Kullanici istegi (2026-09-16): sablondaki "{kurum}" (kurum basligi) da
  // otomatik dolsun - tum aliciler icin AYNI (kisisellestirme gerekmez).
  const [senderTitle, setSenderTitle] = useState('')

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
      const response = await fetch('/api/sms/bulk-status')
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
    setSelectedTemplateId('')
    setIsOpen(true)
    void (async () => {
      try {
        const response = await fetch('/api/sms/templates')
        const payload = await response.json()
        if (payload?.success) {
          setTemplates(payload.data || [])
          setSenderTitle(payload.senderTitle || '')
        }
      } catch {
        // sablon listesi cekilemezse sessizce bos kalir - kullanici yine de
        // mesaji elle yazabilir, gonderim akisi etkilenmez.
      }
    })()
  }

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId)
    const template = templates.find((t) => t.id === templateId)
    if (template) setMessage(convertSavedTemplateToBulkTokens(template.text, senderTitle))
  }

  // Kullanici istegi: pencere kapatildiginda (X / Kapat / Arka Planda Devam
  // Et), bu bileseni ICINDE barindiran "Dışa Aktar & İletişim" acilir
  // menusu de (ToolbarDropdown) KENDINI KAPATSIN - eskiden bu buton
  // "data-keep-menu-open" isaretiyle (modal acikken menu kapanip modali da
  // birlikte yok etmesin diye) korundugundan, modal kapansa bile disaridaki
  // menu ACIK KALIYORDU. Modal DOM'dan kaldirildiktan (isaretli koruma
  // elementi yok oldugu icin) HEMEN sonra sahte bir "click" olayi
  // yayinlanir - ToolbarDropdown'in kendi disari-tiklama dinleyicisi bunu
  // yakalar, artik "data-keep-menu-open" bulamadigindan menuyu normal
  // sekilde kapatir.
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
      const response = await fetch('/api/sms/bulk-send', {
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

  // Kullanici istegi: kisayol butonlarina tiklandiginda token mesajin
  // SONUNA degil, textarea'da imlecin O AN durdugu yere eklensin (metnin
  // ortasina/istenen noktaya yerlestirebilmek icin). Textarea kontrolsuz
  // bir input degil (value={message} ile kontrol ediliyor) - bu yuzden
  // selectionStart/End dogrudan DOM'dan (ref) okunur, yeni metin o
  // konuma eklenir ve imlec eklenen tokenin HEMEN SONRASINA tasinir ki
  // art arda birden fazla kisayol eklenirken her biri bir onceki
  // tokenden sonraya gelsin (hep basa/sona degil).
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
      await fetch('/api/sms/bulk-cancel', { method: 'POST' })
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
      {/* bkz. BulkWhatsappSendButton.tsx'teki ayni not - "data-keep-menu-open"
          bu buton (ve asagidaki modal icindeki TUM butonlar) icin
          ToolbarDropdown'in "herhangi bir butona tiklaninca kapan" otomatik
          davranisini gecici olarak devre disi birakir; modal kapaninca
          closeModal() menuyu ayrica kapatir (yukaridaki not). */}
      <button
        type="button"
        data-keep-menu-open
        onClick={openModal}
        disabled={recipients.length === 0 || disabled}
        className={className || 'inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-[#0076b6] to-sky-600 px-3 py-2 text-xs font-black text-white shadow-sm hover:brightness-110 disabled:pointer-events-none disabled:opacity-50'}
      >
        {buttonLabel || `SMS'ten Toplu Gönder (${recipients.length})`}
      </button>

      {/* bkz. BulkWhatsappSendButton.tsx'teki ayni not - "data-modal-active"
          SADECE modal gercekten acikken (bu blok render olurken) vardir;
          "data-keep-menu-open" (tetikleyici butonda HER ZAMAN vardir)
          YANLISLIKLA global kapatma kontrolunu engelliyordu (hata raporu:
          "ekranda açık kalıyor") - ToolbarDropdown'in genel kapatma
          mantigi artik bunun yerine "data-modal-active"i arar. */}
      {isOpen && (
        <div data-keep-menu-open data-modal-active className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-[#0076b6] via-sky-600 to-cyan-600 px-6 py-5 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl ring-1 ring-white/30">✉️</span>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide text-white/80">Toplu Gönderim</p>
                  <h3 className="text-xl font-black">SMS&apos;ten Toplu Gönder</h3>
                </div>
              </div>
              <button type="button" onClick={closeModal} className="rounded-full bg-white/15 px-2.5 py-1 text-sm font-black hover:bg-white/25">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {!job && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
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

                    {/* Kullanici istegi: kayitli sablonlardan secip herkese
                        o sablonu gonderebilsin. */}
                    {templates.length > 0 && (
                      <label className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-violet-700">
                          <span className="text-sm leading-none">📋</span>
                          Kayıtlı Şablon Kullan
                        </span>
                        <select
                          value={selectedTemplateId}
                          onChange={(event) => applyTemplate(event.target.value)}
                          className="rounded-xl border-2 border-violet-200 bg-violet-50/60 px-4 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-violet-500"
                        >
                          <option value="">Şablon seçin (opsiyonel)...</option>
                          {templates.map((template) => (
                            <option key={template.id} value={template.id}>{template.title}</option>
                          ))}
                        </select>
                        {selectedTemplateId && (
                          <p className="text-[11px] font-semibold text-violet-700/80">
                            Şablon mesaja uygulandı - göndermeden önce &quot;{'{tc}'}&quot; gibi bu ekranda desteklenmeyen alanlar varsa elle düzenleyin.
                          </p>
                        )}
                      </label>
                    )}

                    <label className="flex flex-1 flex-col gap-1.5">
                      <span className="text-xs font-black uppercase tracking-wide text-slate-500">Mesaj</span>
                      <textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        rows={12}
                        placeholder="Tüm seçili kişilere gönderilecek mesajı yazın..."
                        className="min-h-[240px] flex-1 rounded-xl border-2 border-sky-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 shadow-inner outline-none focus:border-[#0076b6]"
                      />
                    </label>
                    <p className="text-[11px] font-semibold text-slate-400">
                      Mesajlar SMS sağlayıcısının hız sınırını zorlamamak için sırayla, kısa aralıklarla gönderilir - çok sayıda kayıt seçtiyseniz gönderim biraz zaman alabilir.
                    </p>
                    <p className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
                      <span className="mt-px text-sm leading-none">✓</span>
                      Gönderilen her mesajın bir kopyası, doğrulama amacıyla Ayarlar &gt; SMS Entegrasyonu&apos;ndaki test telefon numarasına da gönderilir.
                    </p>
                    {status && (
                      <div className="rounded-lg border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{status}</div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 rounded-2xl border-2 border-sky-200 bg-gradient-to-br from-sky-50 via-cyan-50/60 to-emerald-50/40 p-4 shadow-inner">
                    <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-[#0076b6]">
                      <span className="text-base leading-none">⚡</span>
                      Kısayollar
                    </p>
                    <p className="text-[11px] font-semibold text-sky-700/80">
                      Tıklayınca mesaja eklenir - gönderim anında her kişiye kendi bilgisiyle gider.
                    </p>
                    <div className="mt-1 flex flex-col gap-1.5 overflow-y-auto pr-1">
                      {MESSAGE_TEMPLATE_TOKEN_DEFINITIONS.map((def) => (
                        <button
                          key={def.token}
                          type="button"
                          title={def.description}
                          onClick={() => insertTokenAtCursor(def.token)}
                          className="flex w-full items-center gap-2.5 rounded-xl border border-sky-200 bg-white px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#0076b6] hover:shadow-md"
                        >
                          <span className="shrink-0 rounded-lg bg-gradient-to-br from-[#0076b6] to-sky-600 px-2 py-1 font-mono text-[11px] font-black text-white">
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
                        Gönderim sunucuda arka planda çalışır - bu pencereyi kapatıp diğer işlerinize devam edebilirsiniz, gönderim durmaz.
                        İlerlemeyi üst menüdeki &quot;Toplu SMS&quot; göstergesinden takip edebilirsiniz.
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
                      className="h-full rounded-full bg-gradient-to-r from-[#0076b6] to-sky-500 transition-all"
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
                    className="rounded-md bg-gradient-to-r from-[#0076b6] to-sky-600 px-5 py-2 text-sm font-extrabold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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
                  <button type="button" onClick={closeModal} className="rounded-md bg-gradient-to-r from-[#0076b6] to-sky-600 px-5 py-2 text-sm font-extrabold text-white shadow-sm hover:brightness-110">
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
