import { prisma } from '@/lib/db/prisma'
import { foldTurkish, sqlFoldExpr } from '@/lib/utils'
import { MessageReportClient } from './MessageReportClient'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100

type SmsLogRow = {
  id: number
  telefon: string | null
  adisoyadi: string | null
  dosyano: string | null
  tckimlikno: string | null
  mesaj: string | null
  durum: string | null
  cevap: string | null
  created_at: Date | null
  sms_tipi: string | null
  sablon: string | null
  kullanici: string | null
}

// "sms_gonderim_log" ORTAK bir tablodur: SMS kayıtları bu uygulamanın
// DIŞINDAKİ (eski/harici) SMS entegrasyonu tarafından, WhatsApp kayıtları
// (kanal='whatsapp') ise bu uygulama tarafından yazılır - bkz.
// lib/services/whatsappLog.service.ts. Bu sayfa sadece kanal='sms' (veya hiç
// belirtilmemiş eski kayıtlar - varsayılan 'sms'dir) olanları listeler; kanal
// başına 2 sekmeli üst menüde ("SMS Raporları" / "WhatsApp Raporları" -
// layout.tsx) diğer sekme whatsapp/page.tsx'tedir.
export default async function SmsRaporlariPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; durum?: string }>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const offset = (currentPage - 1) * PAGE_SIZE
  const searchTerm = params.search?.trim() || ''
  // Kullanici istegi: hatali/iletilen mesajlari filtreleyebilme (bkz.
  // whatsapp/page.tsx'teki ayni not).
  const durumFilter = params.durum?.trim() || ''

  // GUVENLIK: kullanici girdisi artik string olarak sorguya GOMULMEZ -
  // parametrelenir ($1, $2 ...). Boylece SQL enjeksiyonu tamamen elenir.
  const queryParams: unknown[] = []
  let searchCondition = ''
  if (searchTerm) {
    // Türkçe-duyarsız (büyük/küçük harf + aksan): terim katlanır, kolonlar
    // sqlFoldExpr ile katlanır. sqlFoldExpr'de kullanıcı girdisi YOK (sadece
    // sabit sütun adı + sabit translate harfleri) -> güvenli.
    queryParams.push(`%${foldTurkish(searchTerm)}%`)
    const p = `$${queryParams.length}`
    searchCondition = `AND (
        ${sqlFoldExpr('telefon')} LIKE ${p}
        OR ${sqlFoldExpr('adisoyadi')} LIKE ${p}
        OR ${sqlFoldExpr('dosyano')} LIKE ${p}
        OR ${sqlFoldExpr('tckimlikno')} LIKE ${p}
        OR ${sqlFoldExpr('mesaj')} LIKE ${p}
      )`
  }
  let durumCondition = ''
  if (durumFilter) {
    queryParams.push(durumFilter)
    durumCondition = `AND durum = $${queryParams.length}`
  }

  let rows: SmsLogRow[] = []
  let totalCount = 0
  let errorMessage: string | null = null

  try {
    const countResult = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*)::bigint AS total FROM sms_gonderim_log WHERE kanal = 'sms' ${searchCondition} ${durumCondition}`,
      ...queryParams,
    )
    totalCount = Number(countResult[0]?.total || 0)

    rows = await prisma.$queryRawUnsafe<SmsLogRow[]>(
      `SELECT id, telefon, adisoyadi, dosyano, tckimlikno, mesaj, durum, cevap, created_at, sms_tipi, sablon, kullanici
      FROM sms_gonderim_log
      WHERE kanal = 'sms' ${searchCondition} ${durumCondition}
      ORDER BY id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      ...queryParams,
    )
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  const data = rows.map((row) => ({
    dosyano: row.dosyano || '-',
    adisoyadi: row.adisoyadi || '-',
    telefon: row.telefon || '-',
    mesaj: row.mesaj || '-',
    durum: row.durum || '-',
    cevap: row.cevap || '-',
    tarih: row.created_at ? new Date(row.created_at).toLocaleDateString('tr-TR') : '-',
    saat: row.created_at ? new Date(row.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-',
    gonderen: row.kullanici || '-',
    sablon: row.sablon || '-',
  }))

  return (
    <>
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600 print:hidden">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}
      <MessageReportClient
        title="SMS Raporları"
        eyebrow="Raporlar"
        icon="✉️"
        accentGradient="from-[#0076b6] to-[#005f95]"
        routePath="/reports/sms"
        data={data}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        searchTerm={searchTerm}
        statusFilterValue={durumFilter}
        statusOptions={[
          { value: 'gonderildi', label: 'Gönderildi' },
          { value: 'hata', label: 'Hata' },
        ]}
        preferredColumnOrder={['dosyano', 'adisoyadi', 'telefon', 'mesaj', 'durum', 'tarih', 'saat', 'gonderen', 'sablon', 'cevap']}
        columnLabels={{
          dosyano: 'Dosya No',
          adisoyadi: 'Ad Soyad',
          telefon: 'Telefon',
          mesaj: 'Mesaj İçeriği',
          durum: 'Durum',
          cevap: 'Servis Yanıtı',
          tarih: 'Tarih',
          saat: 'Saat',
          gonderen: 'Gönderen',
          sablon: 'Şablon',
        }}
        emptyMessage="Görüntülenecek SMS gönderim kaydı bulunamadı."
        exportFilePrefix="sms-raporu"
      />
    </>
  )
}
