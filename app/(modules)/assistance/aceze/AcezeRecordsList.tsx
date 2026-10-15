import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { AcezeRecordsTable } from './AcezeRecordsTable'
import { ASSISTANCE_USER_COLUMNS_SELECT, ASSISTANCE_USER_COLUMN_SQL } from '@/lib/assistance/assistanceColumns'
import { getBeneficiaryKodEtiketleri } from '@/lib/documents/documentKodEtiketleri'
import { jsonbLiteral } from '@/lib/documents/documentsListQuery'

type SearchParams = { page?: string; search?: string } & Record<string, string>

const ACEZE_COLUMNS = [
  'id', 'adisoyadi', 'tckimlikno', 'tutar', 'tarih', 'nedeni', 'gidecegiyer', 'kisisayisi',
  'uyrugu', 'babaadi', 'anaadi', 'dogumyeri', 'dogumtarihi', 'medenihali', 'cinsiyeti',
  'saglikdurumu', 'hastalikadi', 'ceptel', 'nufuskytili',
  'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi', 'dosyaid',
]

export async function AcezeRecordsList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const search = params.search?.trim() || ''
  // 2026-10-15: tablonun TUM alanlari listede (bkz. AcezeRecordsTable) - her
  // sutun basligi filtresi de calissin diye harita tum alanlari kapsar.
  // Saglik durumu kodu (formun duzenledigi ham alan) AYNEN kalir; yaninda
  // Hazır Değerler > Sağlık Durumu karsiligi "saglik_durumu_adi" olarak gelir.
  const saglikEtiketleri = jsonbLiteral((await getBeneficiaryKodEtiketleri()).saglik)
  const saglikAdiSql = `COALESCE(${saglikEtiketleri} ->> t.saglikdurumu::text, t.saglikdurumu::text)`
  const filterColumnMap: Record<string, string> = {
    mahalle: 'd.mahalleadi',
    dosya_adresi: 'd.adres',
    dosyano: 'd.dosyano',
    saglik_durumu_adi: saglikAdiSql,
    ...ASSISTANCE_USER_COLUMN_SQL,
  }
  for (const column of ACEZE_COLUMNS) filterColumnMap[column] = `t.${column}`
  const locationFilter = buildMappedFilterCondition(params, filterColumnMap)
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const searchSql = buildTextSearchClause(
    ['t.adisoyadi', 't.tckimlikno', 't.nedeni', 't.hastalikadi', 'd.dosyano', 'd.mahalleadi', 'd.adres'],
    search,
  )
  const whereSql = `WHERE 1=1 ${locationFilter} ${searchSql}`

  try {
    const [countResult, dataResult] = await Promise.all([
      sqlMonitorService.executeQuery(`SELECT COUNT(*)::int AS total FROM yrd_aceze t LEFT JOIN dosyalar d ON d.id = t.dosyaid ${whereSql}`),
      sqlMonitorService.executeQuery(`SELECT d.dosyano, d.mahalleadi AS mahalle, d.adres AS dosya_adresi, t.*, ${saglikAdiSql} AS saglik_durumu_adi, ${ASSISTANCE_USER_COLUMNS_SELECT} FROM yrd_aceze t LEFT JOIN dosyalar d ON d.id = t.dosyaid ${whereSql} ORDER BY t.id DESC LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}`),
    ])
    const rows = JSON.parse(JSON.stringify(dataResult.rows)) as Record<string, unknown>[]
    return <AcezeRecordsTable rows={rows} totalCount={Number(countResult.rows[0]?.total || 0)} currentPage={currentPage} pageSize={pageSize} searchTerm={search} />
  } catch (error) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">Veritabanı Hatası: {error instanceof Error ? error.message : String(error)}</div>
  }
}
