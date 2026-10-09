// Paylasilan "coklu sutun siralama" yardimcilari - kullanici istegi: baslikta
// bir sutuna tikla = SADECE o sutuna gore sirala (zaten birincil sutunsa
// yonunu degistir); Shift+tikla = MEVCUT siralamaya EK bir kademe olarak
// ekle (ya da o sutun zaten ekliyse yonunu degistir). Hem AdvancedTable
// (istemci tarafi, kucuk/tam yuklu tablolar icin) hem de sunucu tarafinda
// coklu-ORDER BY olusturan rapor sayfalari (bkz. lib/beneficiary/,
// lib/documents/, app/(modules)/assistance/... vb.) BU TEK kaynagi kullanir.

export type SortDirectionValue = 'asc' | 'desc'
export type SortSpec = { key: string; direction: SortDirectionValue }

const SORT_KEY_PATTERN = /^[a-zA-Z0-9_]+$/

/**
 * URL/parametre formatindan ("anahtar:yon,anahtar2:yon2") SortSpec dizisine
 * cozer. Gecersiz/bos parcalar sessizce atlanir - asla SQL'e dogrudan
 * yazilmaz, sadece bir sonraki adimda whitelist (columnMap) ile eslestirilir.
 */
export function parseSortParam(raw: string | null | undefined): SortSpec[] {
  if (!raw) return []

  return raw
    .split(',')
    .map((part): SortSpec | null => {
      const [rawKey, rawDir] = part.split(':')
      const key = (rawKey || '').trim()
      if (!key || !SORT_KEY_PATTERN.test(key)) return null
      return { key, direction: rawDir === 'desc' ? 'desc' : 'asc' }
    })
    .filter((spec): spec is SortSpec => spec !== null)
}

export function encodeSortParam(specs: SortSpec[]): string {
  return specs.map((spec) => `${spec.key}:${spec.direction}`).join(',')
}

/**
 * Baslik tiklama/Shift+tiklama davranisi - hem istemci (AdvancedTable) hem
 * sunucu-yonlendirmeli sayfalarin (ManagedReportTablePage, Bireyler,
 * Dosyalar) URL olusturma kodu AYNI mantigi kullanir.
 */
export function toggleSortSpec(current: SortSpec[], key: string, additive: boolean): SortSpec[] {
  if (!additive) {
    if (current.length === 1 && current[0].key === key) {
      return [{ key, direction: current[0].direction === 'asc' ? 'desc' : 'asc' }]
    }
    return [{ key, direction: 'asc' }]
  }

  const existingIndex = current.findIndex((spec) => spec.key === key)
  if (existingIndex === -1) {
    return [...current, { key, direction: 'asc' }]
  }

  const next = [...current]
  next[existingIndex] = {
    key,
    direction: next[existingIndex].direction === 'asc' ? 'desc' : 'asc',
  }
  return next
}

/**
 * Guvenli, coklu-sutun ORDER BY olusturucu. Once columnMap'te ONCEDEN
 * tanimli (whitelisted) anahtarlara bakilir; orada yoksa (ör. t.* icindeki
 * herhangi bir kolon icin dinamik "sanal olmayan" siralama destegi gereken
 * sayfalarda - bkz. AssistanceRequestListPage.tsx) opsiyonel bir
 * resolveFallback fonksiyonu cagrilir - o da bir SQL parcasi DONMEZSE
 * (ör. guvenli-kimlik regex'i gecmezse) o kademe sessizce ATLANIR, ham
 * girdi ASLA dogrudan SQL'e yazilmaz. tiebreaker (ör. "t.id DESC") HER
 * ZAMAN son sirada eklenir, boylece esit siralama degerlerinde bile sonuc
 * HER ZAMAN ayni/stabil sirada kalir (sayfalama arasi kayma olmaz).
 */
export function buildMultiColumnOrderBy(
  specs: SortSpec[],
  columnMap: Record<string, string>,
  tiebreaker: string,
  resolveFallback?: (key: string) => string | undefined,
): string {
  const terms = specs
    .map((spec) => ({ spec, column: columnMap[spec.key] || resolveFallback?.(spec.key) }))
    .filter((entry): entry is { spec: SortSpec; column: string } => Boolean(entry.column))
    .map(({ spec, column }) => `${column} ${spec.direction.toUpperCase()} NULLS LAST`)

  return terms.length > 0 ? `${terms.join(', ')}, ${tiebreaker}` : tiebreaker
}
