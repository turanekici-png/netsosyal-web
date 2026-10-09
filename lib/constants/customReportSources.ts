// "İlişkili tablo" - ana rapor kaynağının yanına, aralarındaki dosyaid/id
// ilişkisi üzerinden ekstra sütunlar getirebileceğimiz tablolar (bkz.
// app/(modules)/reports/ozel/page.tsx - buildJoinSql). Kullanıcı bu tabloları
// isteğe bağlı olarak "işaretleyerek" rapora dahil edebilir - "farklı
// tablolardan da rapor tasarlama" özelliğinin temeli budur.
export type JoinableSource = {
  id: string
  label: string
  tableName: string
  // Ana kaynağın (t) hangi sütunu, bu tablonun (alias) hangi sütununa eşit.
  sourceColumn: string
  joinedColumn: string
  // true ise (bireyler gibi dosya başına birden fazla satır olabilecek
  // tablolarda) sadece "birincil" kaydı getirir (yakinligi=0 veya tipi=0,
  // yoksa en küçük id) - bkz. sayfa sorgusundaki LATERAL JOIN.
  primaryOnly?: boolean
}

export type CustomReportSource = {
  id: string
  label: string
  tableName: string
  defaultColumns?: string[]
  joinable?: JoinableSource[]
}

const DOSYA_JOIN: JoinableSource = {
  id: 'dosya',
  label: 'Dosya Bilgileri',
  tableName: 'dosyalar',
  sourceColumn: 'dosyaid',
  joinedColumn: 'id',
}

const BIREY_JOIN: JoinableSource = {
  id: 'birey',
  label: 'Başvuru Sahibi (Birey)',
  tableName: 'bireyler',
  sourceColumn: 'dosyaid',
  joinedColumn: 'dosyaid',
  primaryOnly: true,
}

const BIREY_JOIN_BY_ID: JoinableSource = {
  id: 'birey',
  label: 'Başvuru Sahibi (Birey)',
  tableName: 'bireyler',
  sourceColumn: 'id',
  joinedColumn: 'dosyaid',
  primaryOnly: true,
}

const YARDIM_TABLE_JOINABLE = [DOSYA_JOIN, BIREY_JOIN]

export const CUSTOM_REPORT_SOURCES: CustomReportSource[] = [
  {
    id: 'nakit-yardimi',
    label: 'Nakit Yardımı',
    tableName: 'yrd_ayninakti',
    defaultColumns: ['id', 'dosyaid', 'muracaateden', 'donem', 'asama', 'durumu', 'dosya__adresno', 'miktar', 'tarih'],
    joinable: YARDIM_TABLE_JOINABLE,
  },
  {
    id: 'ekmek-yardimi',
    label: 'Ekmek Yardımı',
    tableName: 'yrd_ekmek',
    defaultColumns: ['id', 'dosyaid', 'muracaateden', 'durumu', 'dosya__adresno', 'bastarih', 'bittarih'],
    joinable: YARDIM_TABLE_JOINABLE,
  },
  {
    id: 'gida-yardimi',
    label: 'Gıda Yardımı',
    tableName: 'yrd_gidabankasi',
    defaultColumns: ['id', 'dosyaid', 'muracaateden', 'donem', 'etiket', 'durumu', 'dosya__adresno'],
    joinable: YARDIM_TABLE_JOINABLE,
  },
  {
    id: 'destek-paketi',
    label: 'Destek Paketi',
    tableName: 'yrd_destekpaketi',
    defaultColumns: ['id', 'dosyaid', 'muracaateden', 'donem', 'etiket', 'durumu', 'dosya__adresno'],
    joinable: YARDIM_TABLE_JOINABLE,
  },
  {
    id: 'hazir-yemek',
    label: 'Hazır Yemek',
    tableName: 'yrd_haziryemek',
    defaultColumns: ['id', 'dosyaid', 'muracaateden', 'durumu', 'dosya__adresno', 'bastarih', 'bittarih'],
    joinable: YARDIM_TABLE_JOINABLE,
  },
  {
    id: 'giyim-yardimi',
    label: 'Giyim Yardımı',
    tableName: 'yrd_giyim',
    defaultColumns: ['id', 'dosyaid', 'muracaateden', 'durumu', 'dosya__adresno', 'tarih'],
    joinable: YARDIM_TABLE_JOINABLE,
  },
  {
    id: 'donem-disi-gida',
    label: 'Dönem Dışı Gıda',
    tableName: 'yrd_ddgidadosyali',
    defaultColumns: ['id', 'dosyaid', 'muracaateden', 'durumu', 'dosya__adresno', 'tarih'],
    joinable: YARDIM_TABLE_JOINABLE,
  },
  {
    id: 'dosyalar',
    label: 'Dosyalar',
    tableName: 'dosyalar',
    defaultColumns: ['id', 'dosyano', 'durumu', 'adresno', 'mahalleadi', 'telefon', 'ilkislemtarihi'],
    joinable: [BIREY_JOIN_BY_ID],
  },
  {
    id: 'bireyler',
    label: 'Bireyler',
    tableName: 'bireyler',
    defaultColumns: ['id', 'dosyaid', 'tckimlikno', 'adisoyadi', 'yakinligi', 'medenihali', 'dogumtarihi'],
    joinable: [DOSYA_JOIN],
  },
  {
    id: 'online-basvurular',
    label: 'Online Başvurular',
    tableName: 'online_basvurular',
    defaultColumns: ['id', 'created_at', 'tckimlikno', 'ad', 'soyad', 'yardim_turu', 'status', 'mahalleadi', 'adresno'],
  },
]

export function getCustomReportSource(sourceId?: string) {
  return CUSTOM_REPORT_SOURCES.find((source) => source.id === sourceId) ?? CUSTOM_REPORT_SOURCES[0]
}
