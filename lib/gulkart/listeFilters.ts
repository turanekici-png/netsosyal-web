import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'

// Gülkart Listesi hem sayfanin kendisinde (app/(modules)/gulkart/liste/
// page.tsx - SSR veri sorgusu) hem de API route'unda ("Tümünü Seç" icin
// filtrelenen id listesi - bkz. app/api/gulkart/liste/route.ts GET
// ?idsOnly=1) AYNI WHERE kosuluna ihtiyac duyar - iki yerde AYRI AYRI
// yazilirsa (kolayca) birbirinden sapabilir ("Tümünü Seç" ekrandakinden
// FARKLI bir kayit kumesini secebilir). Bu yuzden TEK bir yerden paylasilir.
export function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

// "dosyaNo" gercek bir nakitkart sutunu DEGIL - LEFT JOIN edilen
// "dosyalar d" tablosundan gelen sanal bir alan (bkz. dataQuery/countQuery
// "d.dosyano AS \"dosyaNo\""). Filtre/arama bu alanda da calissin diye
// column map'e ve arama kosuluna ayrica eklenir.
export function buildGulkartListWhereClause(
  params: Record<string, string>,
  nakitkartColumns: string[],
  searchTerm: string,
) {
  const columnMap: Record<string, string> = Object.fromEntries(
    nakitkartColumns.map((column) => [column, `t.${quoteIdentifier(column)}`]),
  )
  columnMap.dosyaNo = 'd.dosyano'

  const filterCondition = buildMappedFilterCondition(params, columnMap)
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const searchCondition = buildTextSearchClause(
    [...nakitkartColumns.map((column) => `t.${quoteIdentifier(column)}`), 'd.dosyano'],
    searchTerm,
  )

  return `${filterCondition}${searchCondition}`
}
