// Sosyal Yardım Yönetim Sistemi - Toplu WhatsApp gönderim servisi
//
// Herhangi bir liste ekranında (Dosyalar, Bireyler, Yardım Raporları, Online
// Başvurular vb.) seçilen kayıtların TAMAMINA aynı mesajı, sunucudaki TEK
// kurum WhatsApp oturumu üzerinden (bkz. whatsappWeb.service.ts) sırayla
// gönderir. Tek bir HTTP isteğinde onlarca/yüzlerce mesajı beklemek yerine
// (tarayıcı/proxy zaman aşımına uğrar), iş arka planda başlatılır ve durumu
// /api/whatsapp/bulk-status ile anlık sorgulanır (bkz. whatsappWeb.service.ts
// bağlantı durumu polling deseniyle aynı yaklaşım).
//
// ÖNEMLİ: gönderimler arasına KASITLI olarak rastgele bir gecikme konur -
// çok kısa aralıklarla art arda onlarca mesaj göndermek, gayri-resmi
// WhatsApp Web oturumlarında geçici kısıtlamaya (ban riski) yol açabilir.

import { sendWhatsappMessage, isWhatsappReady } from './whatsappWeb.service'
import { logWhatsappSend } from './whatsappLog.service'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'

export interface BulkRecipientInput {
  id: string
  phone: string | null | undefined
  label?: string | null
  // Loglama icin opsiyonel ek baglam - varsa Raporlar > WhatsApp
  // Raporlari'nda dosya no/kimlik olarak gorunur.
  dosyaNo?: string | null
  dosyaId?: string | null
  // Ortak mesaj sablonundaki "(isim)", "(telefon)", "(iban)" gibi
  // kisayollarin BU ALICI icin ONCEDEN (istemci tarafinda, bkz.
  // lib/messageTemplateTokens.ts) yerine konulmus NIHAI metni - varsa
  // ortak "message" YERINE bu kullanilir (kisiye ozel gonderim).
  personalizedMessage?: string | null
}

export type BulkResultStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface BulkResultItem {
  id: string
  phone: string
  label: string
  status: BulkResultStatus
  error?: string
  dosyaNo?: string | null
  dosyaId?: string | null
  // O aliciya GERCEKTEN gonderilecek/gonderilmis olan nihai metin (kisayol
  // degistirmesi uygulanmis) - job.message (ortak sablon) ile KARISTIRILMAMALI.
  finalMessage: string
}

export type BulkJobStatus = 'idle' | 'running' | 'completed' | 'cancelled'

export interface BulkJobState {
  status: BulkJobStatus
  total: number
  processed: number
  message: string
  results: BulkResultItem[]
  startedAt: number | null
  finishedAt: number | null
  startedByUserName?: string | null
}

// Kullanici istegi: pencere artik "arka planda devam et" ile kapatilip
// baska islere gecilebildigi icin (bkz. BulkWhatsappSendButton.tsx),
// kullanici bu bekleme suresinin ORTA duzeyde kisaltilmasini onayladi
// (onceden 3-6sn) - hala WhatsApp'in kisitlama riskine karsi MAKUL bir
// gecikme birakilir, sadece HIZLANDIRILIR.
const MIN_DELAY_MS = 1500
const MAX_DELAY_MS = 3000
// Kullanici istegi (Eylul 2026): eski 500 sinir kaldirildi - yalnizca kazara
// tum veritabanina gonderimi engelleyen cok yuksek bir guvenlik tavani.
// (WhatsApp'in kendi ban riski icin gecikme yine de korunur.)
const MAX_BULK_RECIPIENTS = 50000

let job: BulkJobState = {
  status: 'idle',
  total: 0,
  processed: 0,
  message: '',
  results: [],
  startedAt: null,
  finishedAt: null,
}

let cancelRequested = false

export function getBulkJobState(): BulkJobState {
  return job
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomDelay(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS))
}

export interface StartBulkResult {
  ok: boolean
  error?: string
}

// Toplu gönderimi BAŞLATIR ve hemen döner - gerçek gönderim arka planda
// (runBulkJob) devam eder, ilerleme /api/whatsapp/bulk-status ile izlenir.
export function startBulkWhatsappSend(recipients: BulkRecipientInput[], message: string, startedByUserName?: string | null): StartBulkResult {
  if (job.status === 'running') {
    return { ok: false, error: 'Zaten devam eden bir toplu WhatsApp gönderimi var. Bitmesini bekleyin ya da iptal edin.' }
  }
  if (!isWhatsappReady()) {
    return { ok: false, error: 'WhatsApp bağlantısı hazır değil. Ayarlar > Sistem Ayarları > WhatsApp Web bölümünden bağlanın.' }
  }

  const trimmedMessage = message.trim()
  if (!trimmedMessage) {
    return { ok: false, error: 'Mesaj metni boş olamaz.' }
  }
  if (recipients.length === 0) {
    return { ok: false, error: 'Seçili kayıt yok.' }
  }
  if (recipients.length > MAX_BULK_RECIPIENTS) {
    return { ok: false, error: `Tek seferde en fazla ${MAX_BULK_RECIPIENTS} kayda gönderim yapılabilir.` }
  }

  const results: BulkResultItem[] = recipients.map((recipient) => {
    const normalized = normalizeWhatsappPhoneNumber(recipient.phone)
    return {
      id: recipient.id,
      phone: normalized || (recipient.phone || '').trim() || '-',
      label: recipient.label?.trim() || '-',
      status: normalized ? 'pending' : 'skipped',
      error: normalized ? undefined : 'Geçersiz veya eksik telefon numarası',
      dosyaNo: recipient.dosyaNo || null,
      dosyaId: recipient.dosyaId || null,
      finalMessage: recipient.personalizedMessage?.trim() || trimmedMessage,
    }
  })

  cancelRequested = false
  job = {
    status: 'running',
    total: results.length,
    processed: 0,
    message: trimmedMessage,
    results,
    startedAt: Date.now(),
    finishedAt: null,
    startedByUserName: startedByUserName || null,
  }

  void runBulkJob()

  return { ok: true }
}

async function runBulkJob(): Promise<void> {
  for (let i = 0; i < job.results.length; i++) {
    if (cancelRequested) {
      job = { ...job, status: 'cancelled', finishedAt: Date.now() }
      return
    }

    const item = job.results[i]
    if (item.status !== 'skipped') {
      const result = await sendWhatsappMessage(item.phone, item.finalMessage)
      const updatedResults = [...job.results]
      updatedResults[i] = {
        ...item,
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? undefined : (result.error || 'Gönderilemedi'),
      }
      job = { ...job, results: updatedResults, processed: job.processed + 1 }

      // await: ilk "ack" olayi, log satiri veritabaninda olusmadan gelip
      // kacirilmasin diye (bkz. app/api/whatsapp/send/route.ts'teki not).
      await logWhatsappSend({
        telefon: item.phone,
        adisoyadi: item.label !== '-' ? item.label : null,
        dosyano: item.dosyaNo,
        dosyaid: item.dosyaId,
        mesaj: item.finalMessage,
        durum: result.ok ? 'gönderildi' : 'hata',
        cevap: result.ok ? null : (result.error || 'Bilinmeyen hata'),
        waMessageId: result.ok ? (result.messageId || null) : null,
        gonderimTipi: 'toplu',
        kullanici: job.startedByUserName,
      })
    } else {
      job = { ...job, processed: job.processed + 1 }
    }

    const isLast = i === job.results.length - 1
    if (!isLast && !cancelRequested) {
      await delay(randomDelay())
    }
  }

  job = { ...job, status: job.status === 'cancelled' ? 'cancelled' : 'completed', finishedAt: Date.now() }
}

export function cancelBulkWhatsappSend(): void {
  if (job.status === 'running') {
    cancelRequested = true
  }
}
