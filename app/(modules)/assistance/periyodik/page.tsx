import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type FilterValueRow = { field: string; value: string; label: string; count: number }
type ColumnValueOption = { value: string; label: string; count: number }

const REPORT_COLUMNS = ['mahalle', 'aktif_yardimlar']

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function mapFilterValueOptions(rows: FilterValueRow[]) {
  return rows.reduce((acc, row) => {
    if (!acc[row.field]) acc[row.field] = []

    acc[row.field].push({
      value: String(row.value),
      label: String(row.label),
      count: Number(row.count || 0),
    })

    return acc
  }, {} as Record<string, ColumnValueOption[]>)
}

export default async function PeriyodikYardimlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const offset = (currentPage - 1) * pageSize
  const searchTerm = params.search?.trim() || ''

  let kayitlar: Record<string, unknown>[] = []
  let totalCount = 0
  let errorMessage: string | null = null
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}

  try {
    const filterCondition = buildFilterCondition(params, 't')

    // "aktif_yardim_sayisi" ve "aktif_yardimlar": kullanicinin asil istegi -
    // bir dosyanin/kisinin AYNI ANDA birden fazla periyodik yardim alip
    // almadigini TEK BAKISTA gormek (ör. hem ekmek hem gida bankasi ayni
    // anda aktif mi). Her yardim turu icin LEFT JOIN zaten yapiliyordu -
    // burada sadece o join'lerin SONUCUNU (dolu/bos) sayip okunabilir bir
    // listeye ceviriyoruz. array_to_string 2 parametreli halinde NULL
    // elemanlari otomatik atlar, boylece sadece GERCEKTEN aktif olan
    // turler listelenir.
    const pivotQuery = `
      SELECT
        d.id::text as dosyaid,
        d.dosyano as dosyano,
        d.inceleme_puani as inceleme_puani,
        b.tckimlikno as tckimlikno,
        b.adisoyadi as adisoyadi,
        b.ceptel as telefon,
        d.mahalleadi as mahalle,
        d.adres as dosya_adresi,
        (SELECT COUNT(*)::int FROM bireyler b2 WHERE b2.dosyaid = d.id) as hane,
        -- ONEMLI: "aktif mi" kontrolu g.miktar/e.miktar UZERINDEN DEGIL,
        -- g.durumu/e.durumu UZERINDEN yapilir - canli veride dogrulandi:
        -- bazi aktif (durumu=2) hazir yemek kayitlarinin miktar alani BOS
        -- (39 kayit) - miktar'a bakmak bu kisileri YANLIŞLIKLA "aktif
        -- yardimi yok" gostermeye sebep oluyordu. durumu, JOIN kosulunda
        -- zaten "=2" ile sinirlandigi icin, join eslesirse HER ZAMAN
        -- doludur (NULL olamaz) - guvenilir "eslesti mi" gostergesi budur.
        (
          (CASE WHEN g.durumu IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN e.durumu IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN dp.durumu IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN hy.durumu IS NOT NULL THEN 1 ELSE 0 END)
        ) as aktif_yardim_sayisi,
        array_to_string(
          ARRAY[
            CASE WHEN g.durumu IS NOT NULL THEN 'Gıda Bankası' END,
            CASE WHEN e.durumu IS NOT NULL THEN 'Ekmek Yardımı' END,
            CASE WHEN dp.durumu IS NOT NULL THEN 'Destek Paketi' END,
            CASE WHEN hy.durumu IS NOT NULL THEN 'Hazır Yemek' END
          ], ', '
        ) as aktif_yardimlar,
        g.miktar as gida_miktar, g.bastarih as gida_bas, g.bittarih as gida_bit,
        e.miktar as ekmek_miktar, e.bastarih as ekmek_bas, e.bittarih as ekmek_bit,
        dp.miktar as destek_miktar, dp.bastarih as destek_bas, dp.bittarih as destek_bit,
        hy.miktar as hazir_miktar, hy.bastarih as hazir_bas, hy.bittarih as hazir_bit
      FROM (
        SELECT dosyaid, muracaateden FROM yrd_ekmek WHERE durumu = 2
        UNION
        SELECT dosyaid, muracaateden FROM yrd_gidabankasi WHERE durumu = 2
        UNION
        SELECT dosyaid, muracaateden FROM yrd_destekpaketi WHERE durumu = 2
        UNION
        SELECT dosyaid, muracaateden FROM yrd_haziryemek WHERE durumu = 2
      ) pd
      JOIN dosyalar d ON pd.dosyaid = d.id
      JOIN bireyler b ON b.dosyaid = d.id AND b.adisoyadi = pd.muracaateden
      LEFT JOIN yrd_gidabankasi g ON g.dosyaid = d.id AND g.muracaateden = pd.muracaateden AND g.durumu = 2
      LEFT JOIN yrd_ekmek e ON e.dosyaid = d.id AND e.muracaateden = pd.muracaateden AND e.durumu = 2
      LEFT JOIN yrd_destekpaketi dp ON dp.dosyaid = d.id AND dp.muracaateden = pd.muracaateden AND dp.durumu = 2
      LEFT JOIN yrd_haziryemek hy ON hy.dosyaid = d.id AND hy.muracaateden = pd.muracaateden AND hy.durumu = 2
      WHERE 1=1
    `

    let countQuery = `SELECT COUNT(*)::int as total FROM (${pivotQuery}) as t WHERE 1=1 ${filterCondition}`
    let dataQuery = `SELECT * FROM (${pivotQuery}) as t WHERE 1=1 ${filterCondition}`

    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause(['adisoyadi', 'tckimlikno', 'dosyano', 'mahalle', 'dosya_adresi'], searchTerm)
    if (searchCondition) {
      countQuery += searchCondition
      dataQuery += searchCondition
    }

    // Varsayilan siralama: AYNI ANDA en fazla yardim turu alan dosyalar
    // (kullanicinin asil aradigi kayitlar) listenin EN USTUNDE gorunsun -
    // manuel siralamaya/filtreye gerek kalmadan ilk bakista fark edilsin.
    dataQuery += ` ORDER BY aktif_yardim_sayisi DESC, dosyano DESC LIMIT ${pageSize} OFFSET ${offset}`

    const countResult = await sqlMonitorService.executeQuery(countQuery)
    totalCount = Number((countResult.rows[0] as { total?: unknown } | undefined)?.total || 0)

    const result = await sqlMonitorService.executeQuery(dataQuery)
    kayitlar = result.rows as Record<string, unknown>[]

    const searchConditionForOptions = searchCondition
    const optionSelectParts = REPORT_COLUMNS
      .filter((field) => field !== 'dosyaid')
      .map((field) => `
        SELECT ${sqlString(field)}::text AS field,
               NULLIF(t.${quoteIdentifier(field)}::text, '') AS value,
               NULLIF(t.${quoteIdentifier(field)}::text, '') AS label
        FROM (${pivotQuery}) as t
        WHERE 1=1 ${filterCondition} ${searchConditionForOptions}
      `)

    if (optionSelectParts.length > 0) {
      const filterValuesResult = await sqlMonitorService.executeQuery(`
        SELECT field, value, label, COUNT(*)::int AS count
        FROM (
          ${optionSelectParts.join('\nUNION ALL\n')}
        ) options
        WHERE value IS NOT NULL
          AND value <> ''
        GROUP BY field, value, label
        ORDER BY field, label;
      `)
      filterValueOptions = mapFilterValueOptions(filterValuesResult.rows as FilterValueRow[])
    }
  } catch (error: unknown) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  return (
    <div className="dy-yardim-rapor-17 space-y-6">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">
        Bu liste, <strong>aynı anda birden fazla periyodik yardım</strong> (gıda bankası, ekmek, destek paketi, hazır yemek) alan kişileri tek bakışta görmenizi sağlar.
        <strong> &quot;Aktif Yardım Sayısı&quot;</strong> sütunu 2 veya daha fazla olan satırlar, o kişinin o an birden fazla yardımı BİRLİKTE aldığını gösterir - liste varsayılan olarak bunları en üstte listeler.
        <strong> &quot;Aktif Yardımlar&quot;</strong> sütunu ise hangi yardımların aktif olduğunu isim isim yazar.
      </div>

      <ManagedReportTablePage
        eyebrow="Konsolide Yardım Yönetimi"
        title="Periyodik Yardımlar Listesi"
        routePath="/assistance/periyodik"
        organizedToolbar
        data={errorMessage ? [] : kayitlar}
        tableId="periyodik_yardimlar"
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        searchTerm={searchTerm}
        searchPlaceholder="Ad soyad, TC, dosya no, mahalle veya adres ara"
        emptyMessage="Görüntülenecek periyodik yardım kaydı bulunamadı."
        excludedColumns={['dosyaid']}
        // Kullanici istegi: hicbir sutun artik zorla gorunur/kilitli degil -
        // kullanici HER sutunu gosterip gizleyebilir (sayfa tasarimi
        // ozgurlugu).
        preferredColumnOrder={['dosyano', 'adisoyadi', 'aktif_yardim_sayisi', 'aktif_yardimlar', 'tckimlikno', 'telefon', 'inceleme_puani', 'mahalle', 'dosya_adresi', 'hane']}
        columnLabels={{
          aktif_yardim_sayisi: 'Aktif Yardım Sayısı',
          aktif_yardimlar: 'Aktif Yardımlar',
          inceleme_puani: 'İnceleme Puanı',
          mahalle: 'Mahalle',
          dosya_adresi: 'Dosya Adresi',
          gida_miktar: 'Gıda Bankası - Miktar',
          gida_bas: 'Gıda Bankası - Başlangıç',
          gida_bit: 'Gıda Bankası - Bitiş',
          ekmek_miktar: 'Ekmek Yardımı - Miktar',
          ekmek_bas: 'Ekmek Yardımı - Başlangıç',
          ekmek_bit: 'Ekmek Yardımı - Bitiş',
          destek_miktar: 'Destek Paketi - Miktar',
          destek_bas: 'Destek Paketi - Başlangıç',
          destek_bit: 'Destek Paketi - Bitiş',
          hazir_miktar: 'Hazır Yemek - Miktar',
          hazir_bas: 'Hazır Yemek - Başlangıç',
          hazir_bit: 'Hazır Yemek - Bitiş',
        }}
        filterValueOptions={filterValueOptions}
        exportFilePrefix="periyodik-yardimlar"
      />
    </div>
  )
}
