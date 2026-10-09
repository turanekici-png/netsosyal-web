export interface PredefinedValue {
  id: string
  name: string
}

export type PredefinedValuesMap = Record<string, PredefinedValue[]>
export type PredefinedValueTitlesMap = Record<string, string>

export const DEFAULT_PREDEFINED_VALUES: PredefinedValuesMap = {
  fileStatus: [
    { id: '1', name: 'Aktif' },
    { id: '2', name: 'Pasif' },
    { id: '5', name: 'Ön İnceleme Yapılmış' },
    { id: '9', name: 'Arşivlendi' },
  ],
  assistanceStatus: [
    { id: '1', name: 'Devam Ediyor' },
    { id: '2', name: 'Tamamlandı' },
    { id: '3', name: 'İptal Edildi' },
    { id: '0', name: 'Yardım Almıyor' },
  ],
  relationship: [
    { id: '0', name: 'Kendisi' },
    { id: '1', name: 'Eşi' },
    { id: '2', name: 'Oğlu' },
    { id: '3', name: 'Kızı' },
    { id: '4', name: 'Annesi' },
    { id: '5', name: 'Babası' },
  ],
  maritalStatus: [
    { id: '1', name: 'Bekar' },
    { id: '2', name: 'Evli' },
    { id: '3', name: 'Dul' },
    { id: '4', name: 'Boşanmış' },
  ],
  gender: [
    { id: 'E', name: 'Erkek' },
    { id: 'K', name: 'Kadın' },
  ],
  healthStatus: [
    { id: '0', name: 'Sağlık Sorunu Yok' },
    { id: '1', name: 'Engelli' },
    { id: '2', name: 'Süreğen Hastalık' },
    { id: '3', name: 'Yaşlı/Bakıma Muhtaç' },
  ],
  familyType: [],
  // Kullanici istegi: yardim degerlendirmesinde kullanilan kriter turlerini
  // (aylik gelir siniri, arac modeli, tapu kaydi vb.) serbest metin olarak
  // tanimlayip listeleyebilecegimiz, ileride yeni satirlar eklenebilecek
  // (mevcut "+ Yeni Satir" mekanizmasiyla) bir referans listesi.
  yardimKriterleri: [
    { id: 'Aylık Gelir', name: '25000' },
    { id: 'Araç Modeli', name: '2010' },
    { id: 'Tapu Kaydı', name: '1 Mesken Kaydı Var' },
  ],
}

export const DEFAULT_PREDEFINED_VALUE_TITLES: PredefinedValueTitlesMap = {
  fileStatus: 'Dosya Durumu',
  assistanceStatus: 'Yardım Durumu',
  relationship: 'Yakınlık Derecesi',
  maritalStatus: 'Medeni Hal',
  gender: 'Cinsiyet',
  healthStatus: 'Sağlık Durumu',
  familyType: 'Aile Niteliği',
  yardimKriterleri: 'Yardım Kriterleri',
}

const turkishCharacterMap: Record<string, string> = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  I: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
}

export const normalizePredefinedText = (value: string) =>
  value
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (char) => turkishCharacterMap[char] ?? char)
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9]/g, '')

const staticCategoryAliases: Record<string, string[]> = {
  fileStatus: ['ddurumu', 'dosyadurumu', 'filestatus', 'dosyastatus', 'dosyadurum'],
  assistanceStatus: ['ydurumu', 'yardimdurumu', 'assistancestatus', 'yardimstatus', 'yardimdurum'],
  relationship: ['yakinlikderecesi', 'yakinlik', 'akraba', 'relation', 'relationship'],
  maritalStatus: ['medenihal', 'medenidurum', 'maritalstatus'],
  gender: ['cinsiyet', 'cinsiyeti', 'gender'],
  healthStatus: ['saglikdurumu', 'saglik', 'health', 'healthstatus'],
  familyType: ['aileniteligi', 'ailenitelik', 'ailetipi', 'familytype'],
}

export const resolvePredefinedCategory = (
  tableName: string,
  columnName: string,
  titles: PredefinedValueTitlesMap = DEFAULT_PREDEFINED_VALUE_TITLES,
  values: PredefinedValuesMap = DEFAULT_PREDEFINED_VALUES
) => {
  const table = normalizePredefinedText(tableName)
  const column = normalizePredefinedText(columnName)
  const availableCategories = new Set([...Object.keys(values), ...Object.keys(titles)])

  for (const category of availableCategories) {
    const normalizedCategory = normalizePredefinedText(category)
    const normalizedTitle = normalizePredefinedText(titles[category] ?? category)

    if (column === normalizedCategory || column === normalizedTitle) {
      return category
    }
  }

  for (const category of availableCategories) {
    const normalizedTitle = normalizePredefinedText(titles[category] ?? category)
    const aliases = staticCategoryAliases[category] ?? []

    if (
      column.includes(normalizedTitle) ||
      normalizedTitle.includes(column) ||
      aliases.some((alias) => {
        const normalizedAlias = normalizePredefinedText(alias)
        return column === normalizedAlias || column.includes(normalizedAlias)
      })
    ) {
      return category
    }
  }

  if (column.includes('durum') || column.includes('status')) {
    if (table.includes('yardim') || table.includes('assistance')) return 'assistanceStatus'
    if (table.includes('dosya') || table.includes('document') || table.includes('file')) return 'fileStatus'
  }

  return null
}

export const findPredefinedCategoryByCandidates = (
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  candidates: string[],
) => {
  const normalizedCandidates = candidates.map(normalizePredefinedText)
  const categoryKeys = Array.from(new Set([...Object.keys(values), ...Object.keys(titles)]))

  const exactCategory = categoryKeys.find((key) => {
    const normalizedKey = normalizePredefinedText(key)
    const normalizedTitle = normalizePredefinedText(titles[key] ?? key)

    return normalizedCandidates.some((candidate) => (
      normalizedKey === candidate ||
      normalizedTitle === candidate
    ))
  })

  if (exactCategory) return exactCategory

  return categoryKeys.find((key) => {
    const normalizedKey = normalizePredefinedText(key)
    const normalizedTitle = normalizePredefinedText(titles[key] ?? key)

    return normalizedCandidates.some((candidate) => (
      normalizedKey.includes(candidate) ||
      normalizedTitle.includes(candidate)
    ))
  }) ?? null
}

export const getPredefinedValueLabel = (
  values: PredefinedValuesMap,
  tableName: string,
  columnName: string,
  value: unknown,
  titles: PredefinedValueTitlesMap = DEFAULT_PREDEFINED_VALUE_TITLES
) => {
  if (value === null || value === undefined) return null

  const category = resolvePredefinedCategory(tableName, columnName, titles, values)
  if (!category) return null

  const match = values[category]?.find((item) => item.id === String(value))
  return match?.name ?? null
}
