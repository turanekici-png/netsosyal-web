// WhatsApp uzerinden gonderilen HER mesaji (tekil, toplu ve otomatik onay
// bildirimleri dahil) "sms_gonderim_log" tablosuna (kanal='whatsapp' ile)
// kaydeder - kullanicinin istegi uzerine SMS ve WhatsApp gonderimleri ARTIK
// TEK ORTAK tabloda birikir (bkz. prisma/schema.prisma - sms_gonderim_log
// modelindeki not, migration 20260816090000_add_sms_gonderim_log_kanal).
// Bu kayitlar Raporlar > SMS/WhatsApp Raporlari ekraninin "WhatsApp
// Raporlari" sekmesinde VE Dosya Yonetimi > Mesaj Raporlari'nda listelenir.
// Loglama HER ZAMAN "yan islem" (best-effort) olarak calisir - basarisiz
// olsa bile asil gonderim akisini ASLA bozmaz.
import { prisma } from '@/lib/db/prisma'

export type WhatsappGonderimTipi = 'tekil' | 'toplu' | 'otomatik-bildirim'

export interface LogWhatsappSendInput {
  telefon: string
  adisoyadi?: string | null
  dosyano?: string | null
  dosyaid?: string | null
  mesaj: string
  durum: 'gönderildi' | 'hata'
  cevap?: string | null
  gonderimTipi: WhatsappGonderimTipi
  kullanici?: string | null
  // whatsapp-web.js'in gonderilen mesaja verdigi benzersiz kimlik
  // (Message.id._serialized) - sonradan gelecek 'message_ack' olaylarinin
  // (iletildi/okundu) HANGI satiri guncelleyecegini bulmak icin saklanir.
  waMessageId?: string | null
}

export async function logWhatsappSend(input: LogWhatsappSendInput): Promise<void> {
  try {
    await prisma.sms_gonderim_log.create({
      data: {
        telefon: input.telefon,
        adisoyadi: input.adisoyadi || null,
        dosyano: input.dosyano || null,
        dosyaid: input.dosyaid || null,
        mesaj: input.mesaj,
        durum: input.durum,
        cevap: input.cevap || null,
        sms_tipi: input.gonderimTipi,
        kullanici: input.kullanici || null,
        kanal: 'whatsapp',
        wa_message_id: input.waMessageId || null,
      },
    })
  } catch {
    // Loglama basarisiz olsa bile mesaj zaten gonderildi/denendi - kritik degil.
  }
}

// whatsapp-web.js'in MessageAck degerleri (bkz. node_modules/whatsapp-web.js/index.d.ts):
// ACK_ERROR=-1, ACK_PENDING=0, ACK_SERVER=1 (sunucuya ulasti), ACK_DEVICE=2
// (alicinin cihazina teslim edildi), ACK_READ=3 (OKUNDU - mavi tik),
// ACK_PLAYED=4 (sesli mesaj dinlendi). Burada kopyalanmiyor (paketin kendi
// enum'una bagli kalmamak, servis dosyasini paketten bagimsiz test
// edilebilir tutmak icin) - sadece sayisal karsilik kullanilir.
const ACK_DURUM_BY_RANK: { minAck: number; durum: string; rank: number }[] = [
  { minAck: 3, durum: 'okundu', rank: 3 },
  { minAck: 2, durum: 'iletildi', rank: 2 },
  { minAck: 1, durum: 'gönderildi', rank: 1 },
]

const DURUM_RANK: Record<string, number> = {
  'hata': -1,
  'gönderildi': 1,
  'gonderildi': 1,
  'iletildi': 2,
  'okundu': 3,
}

// Bir WhatsApp mesajinin durumu degistiginde (sunucuya ulasti / cihaza
// teslim edildi / OKUNDU) ilgili kaydi gunceller - bkz.
// lib/services/whatsappWeb.service.ts 'message_ack' dinleyicisi. Durum
// SADECE ILERİ gider (ör. bir "okundu" kaydi, gec gelen bir "iletildi"
// olayiyla geriye alinmaz) - bu yuzden once mevcut durum okunur.
export async function recordWhatsappMessageAck(waMessageId: string, ack: number): Promise<void> {
  if (!waMessageId || ack < 1) return

  const nextStep = ACK_DURUM_BY_RANK.find((step) => ack >= step.minAck)
  if (!nextStep) return

  try {
    const existing = await prisma.sms_gonderim_log.findFirst({
      where: { wa_message_id: waMessageId },
      select: { id: true, durum: true },
    })
    if (!existing) {
      // TANI amaçlı log: wa_message_id eşleşen bir satır bulunamadı - ya
      // gönderim sırasında messageId hiç alınamamış (bkz. sendWhatsappMessage
      // logu) ya da bu wa_message_id daha önce hiç kaydedilmemiş.
      console.log(`[WhatsApp] Ack güncellemesi atlandı - wa_message_id eşleşmedi: ${waMessageId}`)
      return
    }

    const currentRank = DURUM_RANK[(existing.durum || '').trim().toLocaleLowerCase('tr-TR')] ?? 0
    if (nextStep.rank <= currentRank) return

    await prisma.sms_gonderim_log.update({
      where: { id: existing.id },
      data: { durum: nextStep.durum },
    })
    console.log(`[WhatsApp] Mesaj durumu güncellendi - id=${existing.id} yeni durum=${nextStep.durum}`)
  } catch (error) {
    // Yan islem - okuma/iletim durumu guncellenemezse gonderim kaydi zaten
    // yerinde durur, kritik degil, ama TANI icin loglanir.
    console.error('[WhatsApp] recordWhatsappMessageAck hatasi:', error)
  }
}
