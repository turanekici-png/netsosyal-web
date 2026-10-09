import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { AcezeRecordsTable } from './AcezeRecordsTable'

type SearchParams = { page?: string; search?: string } & Record<string, string>

export async function AcezeRecordsList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const pageSize = 50
  const search = params.search?.trim() || ''
  const locationFilter = buildMappedFilterCondition(params, {
    mahalle: 'd.mahalleadi',
    dosya_adresi: 'd.adres',
    tutar: 't.tutar',
    adisoyadi: 't.adisoyadi',
    tckimlikno: 't.tckimlikno',
    nedeni: 't.nedeni',
    hastalikadi: 't.hastalikadi',
  })
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const searchSql = buildTextSearchClause(
    ['t.adisoyadi', 't.tckimlikno', 't.nedeni', 't.hastalikadi', 'd.dosyano', 'd.mahalleadi', 'd.adres'],
    search,
  )
  const whereSql = `WHERE 1=1 ${locationFilter} ${searchSql}`

  try {
    const [countResult, dataResult] = await Promise.all([
      sqlMonitorService.executeQuery(`SELECT COUNT(*)::int AS total FROM yrd_aceze t LEFT JOIN dosyalar d ON d.id = t.dosyaid ${whereSql}`),
      sqlMonitorService.executeQuery(`SELECT d.dosyano, d.mahalleadi AS mahalle, d.adres AS dosya_adresi, t.* FROM yrd_aceze t LEFT JOIN dosyalar d ON d.id = t.dosyaid ${whereSql} ORDER BY t.id DESC LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}`),
    ])
    const rows = JSON.parse(JSON.stringify(dataResult.rows)) as Record<string, unknown>[]
    return <AcezeRecordsTable rows={rows} totalCount={Number(countResult.rows[0]?.total || 0)} currentPage={currentPage} pageSize={pageSize} searchTerm={search} />
  } catch (error) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">Veritabanı Hatası: {error instanceof Error ? error.message : String(error)}</div>
  }
}
