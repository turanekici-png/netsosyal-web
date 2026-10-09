import { prisma } from '@/lib/db/prisma'
import { foldTurkish, sqlFoldExpr } from '@/lib/utils'
import { MessageReportClient } from '../MessageReportClient'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100

type WhatsappLogRow = {
  id: number
  telefon: string | null
  adisoyadi: string | null
  dosyano: string | null
  dosyaid: string | null
  mesaj: string | null
  durum: string | null
  cevap: string | null
  sms_tipi: string | null
  kullanici: string | null
  created_at: Date | null
}

const GONDERIM_TIPI_LABELS: Record<string, string> = {
  tekil: 'Tekil',
  toplu: 'Toplu',
  'otomatik-bildirim': 'Otomatik Bildirim',
}

// "sms_gonderim_log" ORTAK bir tablodur (bkz. ../page.tsx'teki not) - bu
// sayfa sadece kanal='whatsapp' olan, yani bu uygulama üzerinden WhatsApp ile
// gönderilen (tekil, toplu, otomatik onay bildirimleri dahil) mesajları
// listeler - bkz. lib/services/whatsappLog.service.ts.
export default async function WhatsappRaporlariPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; durum?: string }>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const offset = (currentPage - 1) * PAGE_SIZE
  const searchTerm = params.search?.trim() || ''
  // Kullanici istegi: hatali/iletilen mesajlari filtreleyebilme - önceden
  // arama kutusu sadece telefon/ad/dosyano/mesaj icinde ariyordu, durum
  // (gönderildi/iletildi/okundu/hata) hiç filtrelenemiyordu.
  const durumFilter = params.durum?.trim() || ''

  // GUVENLIK: kullanici girdisi parametrelenir ($1, $2 ...) - string olarak
  // sorguya GOMULMEZ, boylece SQL enjeksiyonu elenir.
  const queryParams: unknown[] = []
  let searchCondition = ''
  if (searchTerm) {
    // Türkçe-duyarsız (büyük/küçük harf + aksan) - bkz. ../page.tsx
    queryParams.push(`%${foldTurkish(searchTerm)}%`)
    const p = `$${queryParams.length}`
    searchCondition = `AND (
        ${sqlFoldExpr('telefon')} LIKE ${p}
        OR ${sqlFoldExpr('adisoyadi')} LIKE ${p}
        OR ${sqlFoldExpr('dosyano')} LIKE ${p}
        OR ${sqlFoldExpr('mesaj')} LIKE ${p}
      )`
  }
  let durumCondition = ''
  if (durumFilter) {
    queryParams.push(durumFilter)
    durumCondition = `AND durum = $${queryParams.length}`
  }

  let rows: WhatsappLogRow[] = []
  let totalCount = 0
  let errorMessage: string | null = null

  try {
    const countResult = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*)::bigint AS total FROM sms_gonderim_log WHERE kanal = 'whatsapp' ${searchCondition} ${durumCondition}`,
      ...queryParams,
    )
    totalCount = Number(countResult[0]?.total || 0)

    rows = await prisma.$queryRawUnsafe<WhatsappLogRow[]>(
      `SELECT id, telefon, adisoyadi, dosyano, dosyaid, mesaj, durum, cevap, sms_tipi, kullanici, created_at
      FROM sms_gonderim_log
      WHERE kanal = 'whatsapp' ${searchCondition} ${durumCondition}
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
    tip: row.sms_tipi ? (GONDERIM_TIPI_LABELS[row.sms_tipi] || row.sms_tipi) : '-',
    tarih: row.created_at ? new Date(row.created_at).toLocaleDateString('tr-TR') : '-',
    saat: row.created_at ? new Date(row.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-',
    gonderen: row.kullanici || '-',
  }))

  return (
    <>
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600 print:hidden">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}
      <MessageReportClient
        title="WhatsApp Raporları"
        eyebrow="Raporlar"
        icon="💬"
        accentGradient="from-emerald-600 to-teal-600"
        routePath="/reports/sms/whatsapp"
        data={data}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        searchTerm={searchTerm}
        statusFilterValue={durumFilter}
        statusOptions={[
          { value: 'gönderildi', label: 'Gönderildi' },
          { value: 'iletildi', label: 'İletildi' },
          { value: 'okundu', label: 'Okundu' },
          { value: 'hata', label: 'Hata' },
        ]}
        preferredColumnOrder={['dosyano', 'adisoyadi', 'telefon', 'mesaj', 'durum', 'tip', 'tarih', 'saat', 'gonderen', 'cevap']}
        columnLabels={{
          dosyano: 'Dosya No',
          adisoyadi: 'Ad Soyad',
          telefon: 'Telefon',
          mesaj: 'Mesaj İçeriği',
          durum: 'Durum',
          cevap: 'Hata Detayı',
          tip: 'Gönderim Türü',
          tarih: 'Tarih',
          saat: 'Saat',
          gonderen: 'Gönderen',
        }}
        emptyMessage="Görüntülenecek WhatsApp gönderim kaydı bulunamadı."
        exportFilePrefix="whatsapp-raporu"
      />
    </>
  )
}
