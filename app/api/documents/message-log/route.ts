import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// Bir dosyaya bugune kadar gonderilen TUM SMS ve WhatsApp mesajlarini TEK bir
// kronolojik listede gosterir - Dosya Yonetimi > SMS Islemleri > "Mesaj
// Raporlari" butonu bunu kullanir (bkz. app/(modules)/documents/page.tsx).
// "sms_gonderim_log" hem harici SMS entegrasyonu HEM DE bu uygulamanin
// gonderdigi WhatsApp mesajlari (kanal='whatsapp') tarafindan doldurulan
// ORTAK tablodur - bkz. prisma/schema.prisma modeli, lib/services/whatsappLog.service.ts.
// WhatsApp icin "durum" zamanla ilerler: gönderildi -> iletildi -> okundu
// (bkz. whatsappLog.service.ts -> recordWhatsappMessageAck, whatsapp-web.js
// 'message_ack' olayi) - bu sayede bir mesajin GÖRÜLÜP görülmediği bellidir.
const DURUM_LABELS: Record<string, string> = {
  'gonderildi': 'Gönderildi',
  'gönderildi': 'Gönderildi',
  'iletildi': 'İletildi (Teslim Edildi)',
  'okundu': 'Okundu',
  'hata': 'Gönderilemedi (Hata)',
}

const GONDERIM_TIPI_LABELS: Record<string, string> = {
  tek: 'Tekil',
  tekil: 'Tekil',
  toplu: 'Toplu',
  'otomatik-bildirim': 'Otomatik Bildirim',
}

// Sadece WhatsApp sekmesinde kullanilir - mesajin gonderim asamasini
// WhatsApp'in kendi tik simgeleriyle tutarli sekilde gosterir.
type ReadStatus = 'read' | 'delivered' | 'sent' | 'failed' | 'unknown'

function resolveReadStatus(normalizedDurum: string): ReadStatus {
  if (normalizedDurum === 'okundu') return 'read'
  if (normalizedDurum === 'iletildi') return 'delivered'
  if (normalizedDurum === 'gonderildi' || normalizedDurum === 'gönderildi') return 'sent'
  if (normalizedDurum === 'hata') return 'failed'
  return 'unknown'
}

export async function GET(request: NextRequest) {
  const accessDenied = await requireApiAccess({ action: 'documents.sms', page: '/documents' })
  if (accessDenied) return accessDenied

  const { searchParams } = new URL(request.url)
  const fileId = (searchParams.get('fileId') || '').trim()
  const fileNo = (searchParams.get('fileNo') || '').trim()

  if (!fileId && !fileNo) {
    return NextResponse.json({ success: false, error: 'Dosya numarası veya ID zorunludur.' }, { status: 400 })
  }

  try {
    const rows = await prisma.sms_gonderim_log.findMany({
      where: {
        OR: [
          ...(fileNo ? [{ dosyano: fileNo }] : []),
          ...(fileId ? [{ dosyaid: fileId }] : []),
        ],
      },
      orderBy: { created_at: 'desc' },
    })

    const data = rows.map((row) => {
      const normalizedDurum = (row.durum || '').trim().toLocaleLowerCase('tr-TR')
      const kanal: 'sms' | 'whatsapp' = row.kanal === 'whatsapp' ? 'whatsapp' : 'sms'
      return {
        kanal,
        telefon: row.telefon || '-',
        adisoyadi: row.adisoyadi || '-',
        mesaj: row.mesaj || '-',
        durum: row.durum || '-',
        durumLabel: normalizedDurum ? (DURUM_LABELS[normalizedDurum] || row.durum) : '-',
        basarili: normalizedDurum !== 'hata' && normalizedDurum !== '',
        readStatus: resolveReadStatus(normalizedDurum),
        cevap: row.cevap || '',
        tip: row.sms_tipi ? (GONDERIM_TIPI_LABELS[row.sms_tipi] || row.sms_tipi) : '-',
        kullanici: row.kullanici || '-',
        tarih: row.created_at ? new Date(row.created_at).toLocaleDateString('tr-TR') : '-',
        saat: row.created_at ? new Date(row.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-',
        createdAtIso: row.created_at ? new Date(row.created_at).toISOString() : null,
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Message log fetch error:', error)
    return NextResponse.json({ success: false, error: 'Mesaj kayıtları alınırken hata oluştu.' }, { status: 500 })
  }
}
