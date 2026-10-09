import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'

// Gülkart Rezerv hem sayfanin kendisinde (app/(modules)/gulkart/rezerv/
// page.tsx - SSR veri sorgusu) hem de API route'unda ("Tümünü Seç" icin
// filtrelenen id listesi - bkz. app/api/gulkart/rezerv/route.ts GET
// ?idsOnly=1) AYNI WHERE kosuluna ihtiyac duyar - iki yerde AYRI AYRI
// yazilirsa (kolayca) birbirinden sapabilir. Bu yuzden TEK bir yerden
// paylasilir (bkz. lib/gulkart/listeFilters.ts - Gülkart Listesi'ndeki
// AYNI desen).
export function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

export function buildGulkartRezervWhereClause(
  params: Record<string, string>,
  columns: string[],
  searchTerm: string,
) {
  const columnMap: Record<string, string> = Object.fromEntries(
    columns.map((column) => [column, `t.${quoteIdentifier(column)}`]),
  )

  const filterCondition = buildMappedFilterCondition(params, columnMap)
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const searchCondition = buildTextSearchClause(
    columns.map((column) => `t.${quoteIdentifier(column)}`),
    searchTerm,
  )

  return `${filterCondition}${searchCondition}`
}
