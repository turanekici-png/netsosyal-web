import { NextRequest, NextResponse } from 'next/server'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { createCashPredefinedLabelResolver } from '@/lib/services/cashPredefinedLabels.service'

export const dynamic = 'force-dynamic'

// "Yardım Hareketleri" penceresindeki Ayni/Nakdi sekmesi icin veri kaynagi.
//
// Dosya sayfasindaki asil Yardımlar/Müracaatlar tablolari icin
// app/api/documents/fetch/route.ts, yrd_ayninakti kayitlarini su sekilde
// bolusturuyor: durumu=0 -> Müracaatlar, durumu=6 -> HİÇBİR YERDE (bilerek
// disarida birakiliyor), digerleri -> Yardımlar. Bu rapor penceresinde ise
// kullanici durumu 0, 1 ve 6 olan TUM kayitlarin gorunmesini istedi - bu
// yuzden o filtreye DOKUNMADAN (ana tablolari bozmamak icin), ayrica bu uctan
// dogrudan yrd_ayninakti'ni okuyoruz.
type CashAidRow = {
  record_id: bigint
  durumu: number | null
  durum_tarihi: Date | null
  miktar: string | null
  asama: string | null
  donem: string | null
  etiket: string | null
  muracaat_aciklama: string | null
  aciklama: string | null
}

function normalizeBigInt(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : null
}

function formatDate(date?: Date | null) {
  return date ? date.toLocaleDateString('tr-TR') : '-'
}

function formatCode(value?: number | null) {
  return value === null || value === undefined ? '-' : String(value)
}

export async function GET(request: NextRequest) {
  try {
    const dosyaId = normalizeBigInt(request.nextUrl.searchParams.get('dosyaId'))

    if (!dosyaId) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    const [result, cashLabelResolver] = await Promise.all([
      getSqlMonitorPool().query<CashAidRow>(
        `
          SELECT
            t.id::bigint AS record_id,
            t.durumu,
            -- Muracaat tarihi (t.muracaattarihi) TUM hareketlerde ayni kalir
            -- (dosyanin ilk basvuru tarihi) - listede her satirda tekrar edip
            -- "hep ayni gun" gorunmesine sebep oluyordu. Bunun yerine durumun
            -- FIILEN degistigi tarihi (t.durumutarih) gosteriyoruz; o da bos
            -- ise son islem zamanina (t.islemtarihi), o da yoksa en son
            -- muracaat tarihine dusuyoruz.
            COALESCE(t.durumutarih::timestamp, t.islemtarihi, t.muracaattarihi::timestamp) AS durum_tarihi,
            t.miktar::text AS miktar,
            t.asama::text AS asama,
            t.donem::text AS donem,
            t.etiket::text AS etiket,
            NULLIF(t.muracaatnotu, '')::text AS muracaat_aciklama,
            -- bkz. app/api/documents/fetch/route.ts'teki ayni duzeltme notu -
            -- SADECE muracaatnotu okunur (bos ise aciklama da bos gorunur,
            -- ilgisiz asamanotu/durumuaciklama'ya DUSULMEZ).
            NULLIF(t.muracaatnotu, '')::text AS aciklama
          FROM public.yrd_ayninakti t
          WHERE t.dosyaid = $1::bigint
            AND t.durumu IN (0, 1, 6)
          ORDER BY COALESCE(t.durumutarih::timestamp, t.islemtarihi, t.muracaattarihi::timestamp) DESC NULLS LAST, t.id DESC;
        `,
        [dosyaId],
      ),
      createCashPredefinedLabelResolver(),
    ])

    const data = result.rows.map((row, index) => {
      const cashLabels = cashLabelResolver(row.donem, row.etiket)
      return {
        recordId: row.record_id.toString(),
        sourceTable: 'yrd_ayninakti',
        no: String(index + 1),
        type: 'Ayni/Nakdi',
        date: formatDate(row.durum_tarihi),
        startDate: '-',
        endDate: '-',
        periodInfo: cashLabels.period || '-',
        label: cashLabels.label || '',
        status: formatCode(row.durumu),
        amount: row.miktar || '-',
        stage: row.asama || '-',
        paymentDay: '-',
        paymentStartDate: '-',
        paymentEndDate: '-',
        // Ana sorguda (fetch/route.ts) yrd_ayninakti icin odeme_aciklama
        // sutunu her zaman NULL - bu tabloda "odeme aciklamasi" kavrami yok.
        paymentDescription: '-',
        muracaatDescription: row.muracaat_aciklama || '-',
        description: row.aciklama || '-',
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Nakit yardım kayıtları alınamadı.' },
      { status: 500 },
    )
  }
}
