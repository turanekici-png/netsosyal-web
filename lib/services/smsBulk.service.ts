// Sosyal Yardım Yönetim Sistemi - Toplu SMS gönderim servisi
//
// Herhangi bir liste ekranında (Dosyalar, Bireyler, Yardım Raporları, Nakit
// Müracaatları vb.) seçilen kayıtların TAMAMINA aynı mesajı, Ayarlar >
// Sistem Ayarları > SMS Entegrasyonu'nda tanımlı AKTİF SMS firması üzerinden
// (bkz. smsProvider.service.ts) sırayla gönderir. Mimari, whatsappBulk.
// service.ts ile BİREBİR aynı desendedir (arka planda çalışan tek bir iş,
// /api/sms/bulk-status ile anlık izlenir) - tek fark, SMS gönderiminde
// WhatsApp'taki gibi bir "kısıtlama/ban riski" olmadığından gecikme çok daha
// kısa tutulur (sadece sağlayıcının hız sınırını rahatsız etmemek için).

import { sendSmsMessage, getActiveSmsProviderTestPhone } from './smsProvider.service'
import { prisma } from '@/lib/db/prisma'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'

export interface SmsBulkRecipientInput {
  id: string
  phone: string | null | undefined
  label?: string | null
  dosyaNo?: string | null
  dosyaId?: string | null
  personalizedMessage?: string | null
}

export type SmsBulkResultStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface SmsBulkResultItem {
  id: string
  phone: string
  label: string
  status: SmsBulkResultStatus
  error?: string
  dosyaNo?: string | null
  dosyaId?: string | null
  finalMessage: string
}

export type SmsBulkJobStatus = 'idle' | 'running' | 'completed' | 'cancelled'

export interface SmsBulkJobState {
  status: SmsBulkJobStatus
  total: number
  processed: number
  message: string
  results: SmsBulkResultItem[]
  startedAt: number | null
  finishedAt: number | null
  startedByUserName?: string | null
}

const MIN_DELAY_MS = 300
const MAX_DELAY_MS = 800
// Kullanici istegi (Eylul 2026): "bu sinir olmasin" - eski 500 sinir kaldirildi.
// Yerine yalnizca kazara tum veritabanina gonderimi engelleyen cok yuksek bir
// guvenlik tavani birakildi. Gonderim, SECILEN kayitlarin TAMAMINA yapilir.
const MAX_BULK_RECIPIENTS = 50000

let job: SmsBulkJobState = {
  status: 'idle',
  total: 0,
  processed: 0,
  message: '',
  results: [],
  startedAt: null,
  finishedAt: null,
}

let cancelRequested = false

export function getSmsBulkJobState(): SmsBulkJobState {
  return job
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomDelay(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS))
}

export interface StartSmsBulkResult {
  ok: boolean
  error?: string
}

export function startBulkSmsSend(recipients: SmsBulkRecipientInput[], message: string, startedByUserName?: string | null): StartSmsBulkResult {
  if (job.status === 'running') {
    return { ok: false, error: 'Zaten devam eden bir toplu SMS gönderimi var. Bitmesini bekleyin ya da iptal edin.' }
  }

  const trimmedMessage = message.trim()
  if (!trimmedMessage) {
    return { ok: false, error: 'Mesaj metni boş olamaz.' }
  }
  if (recipients.length === 0) {
    return { ok: false, error: 'Seçili kayıt yok.' }
  }
  if (recipients.length > MAX_BULK_RECIPIENTS) {
    return { ok: false, error: `Güvenlik sınırı: tek seferde en fazla ${MAX_BULK_RECIPIENTS.toLocaleString('tr-TR')} kayıt.` }
  }

  const results: SmsBulkResultItem[] = recipients.map((recipient) => {
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

  void runSmsBulkJob()

  return { ok: true }
}

async function runSmsBulkJob(): Promise<void> {
  // Kullanici istegi (Eylul 2026): test numarasi ARTIK her mesajin kopyasini
  // ALMAZ. Bunun yerine, Ayarlar > SMS Entegrasyonu'ndaki aktif firmanin
  // "Test Telefon Numarasi" listeye TEK bir alici olarak eklenir -> tipki
  // diger kayitlar gibi SADECE 1 SMS alir (asil mesaj). Boylece gonderimin
  // calistigi telefonda dogrulanir ama 300 kisilik iste test numarasi 300
  // SMS ile bogulmaz. Zaten secime dahilse tekrar eklenmez.
  const testPhone = await getActiveSmsProviderTestPhone().catch(() => null)
  if (testPhone) {
    const testNormalized = normalizeWhatsappPhoneNumber(testPhone)
    if (testNormalized && !job.results.some((r) => r.phone === testNormalized)) {
      const testItem: SmsBulkResultItem = {
        id: '__test__',
        phone: testNormalized,
        label: 'TEST NUMARASI',
        status: 'pending',
        dosyaNo: null,
        dosyaId: null,
        finalMessage: job.message,
      }
      job = { ...job, results: [...job.results, testItem], total: job.total + 1 }
    }
  }

  for (let i = 0; i < job.results.length; i++) {
    if (cancelRequested) {
      job = { ...job, status: 'cancelled', finishedAt: Date.now() }
      return
    }

    const item = job.results[i]
    if (item.status !== 'skipped') {
      const result = await sendSmsMessage(item.phone, item.finalMessage)
      const updatedResults = [...job.results]
      updatedResults[i] = {
        ...item,
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? undefined : (result.error || 'Gönderilemedi'),
      }
      job = { ...job, results: updatedResults, processed: job.processed + 1 }

      await prisma.sms_gonderim_log.create({
        data: {
          telefon: item.phone,
          adisoyadi: item.label !== '-' ? item.label : null,
          dosyano: item.dosyaNo,
          dosyaid: item.dosyaId,
          mesaj: item.finalMessage,
          durum: result.ok ? 'gönderildi' : 'hata',
          cevap: result.ok ? null : (result.error || result.raw || 'Bilinmeyen hata'),
          sms_tipi: 'toplu',
          kanal: 'sms',
          kullanici: job.startedByUserName,
        },
      }).catch(() => { /* loglama basarisiz olsa bile gonderim sonucu degismez */ })
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

export function cancelBulkSmsSend(): void {
  if (job.status === 'running') {
    cancelRequested = true
  }
}
