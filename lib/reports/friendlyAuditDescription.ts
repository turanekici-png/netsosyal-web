// Denetim (audit) trigger'i (bkz. sistem_audit_trigger_fn, veritabaninda
// tanimli) her degisiklikte teknik bir aciklama yazar: "yrd_ekmek
// tablosunda guncelle işlemi" gibi. Bu, hangi dosyada / hangi yardimda /
// hangi alanda ne degistigini anlatmaz. Bu modul, ayni satirin eski_deger /
// yeni_deger JSON anlik goruntulerini kullanarak OKUMA ANINDA daha
// anlasilir bir Turkce cumle uretir - trigger'in kendisi veya gecmis
// kayitlar degistirilmez, sadece ekranda gosterilen metin iyilestirilir.

export type FriendlyAuditInput = {
  tableName: string
  operationType: string
  recordId: string | null
  oldValue: unknown
  newValue: unknown
  fallbackDescription?: string | null
}

const TABLE_LABELS: Record<string, string> = {
  dosyalar: 'Dosya',
  bireyler: 'Birey',
  tahkikatraporlari: 'İnceleme Raporu',
  guncelleme_formu: 'Güncelleme Formu',
  on_inceleme_raporlari: 'Ön İnceleme Raporu',
  inceleme_formu: 'Tahkikat Formu',
  inceleme_degerlendirme_formu: 'Tahkikat Formu',
  inceleme_form_soru: 'Tahkikat Formu Sorusu',
  inceleme_form_secenekler: 'Tahkikat Formu Seçeneği',
  inceleme_form_cevaplar: 'Tahkikat Formu Cevabı',
  yrd_aceze: 'Aceze Yardımı',
  yrd_ayninakti: 'Ayni/Nakdi Yardım',
  yrd_ddgidadosyali: 'Dönem Dışı Gıda Yardımı',
  yrd_destekpaketi: 'Destek Paketi Yardımı',
  yrd_ekmek: 'Ekmek Yardımı',
  yrd_gidabankasi: 'Gıda Bankası Yardımı',
  yrd_giyim: 'Giyim Yardımı',
  yrd_haziryemek: 'Hazır Yemek Yardımı',
  kullanicilar: 'Kullanıcı',
  hazir_degerler: 'Hazır Değer',
  nakitkart: 'Nakit Kart',
  evziyareti: 'Ev Ziyareti',
  kullanici_yetkileri: 'Kullanıcı Yetkisi',
  sistem_bildirimler: 'Bildirim',
  sistem_evrak_takip: 'Evrak Takip',
  sistem_gorevler: 'Görev',
  sistem_mesaj_sablonlari: 'Mesaj Şablonu',
  dosya_notlari: 'Dosya Notu',
}

const YARDIM_TABLES = new Set([
  'yrd_aceze', 'yrd_ayninakti', 'yrd_ddgidadosyali', 'yrd_destekpaketi',
  'yrd_ekmek', 'yrd_gidabankasi', 'yrd_giyim', 'yrd_haziryemek',
])

const FIELD_LABELS: Record<string, string> = {
  durumu: 'durum',
  durumutarih: 'durum tarihi',
  durumuaciklama: 'durum açıklaması',
  aciklama: 'açıklama',
  telefon: 'telefon',
  ceptel: 'cep telefonu',
  adres: 'adres',
  mahalleadi: 'mahalle',
  nfmahkoy: 'mahalle',
  nfilce: 'ilçe',
  kartno: 'kart no',
  incelemepuani: 'inceleme puanı',
  inceleme_puani: 'inceleme puanı',
  tutar: 'tutar',
  miktar: 'miktar',
  adisoyadi: 'ad soyad',
  tckimlikno: 'T.C. kimlik no',
  dosyano: 'dosya no',
  binano: 'bina no',
  daireno: 'daire no',
  cadde: 'cadde',
  sokak: 'sokak',
  kullaniciid: 'atanan kullanıcı',
}

// Bu alanlar hemen her yazma isleminde otomatik degistigi icin "degisen
// alanlar" listesinde gosterilmez - gosterilseler "guncellendi" her satirda
// gorunur ama hicbir anlam tasimaz.
const NOISE_FIELDS = new Set([
  'islemtarihi', 'ilkislemtarihi', 'ilkkullaniciid', 'guncellemetarihi',
  'revision_no', 'id',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function fieldLabel(field: string) {
  return FIELD_LABELS[field] || field
}

function tableLabel(tableName: string) {
  return TABLE_LABELS[tableName] || tableName
}

// Kaydin hangi dosya/kisiye ait oldugunu okunakli sekilde ozetler -
// "1234 numaralı dosya" / "Ahmet Yılmaz" gibi. Once en spesifik alan
// denenir, bulunamazsa bir sonrakine gecilir.
function identify(row: Record<string, unknown> | null, recordId: string | null): string {
  if (!row) return recordId ? `#${recordId}` : ''

  const dosyano = textOf(row.dosyano)
  if (dosyano) return `${dosyano} numaralı dosya`

  const adisoyadi = textOf(row.adisoyadi) || [textOf(row.adi), textOf(row.soyadi)].filter(Boolean).join(' ')
  if (adisoyadi) return adisoyadi

  const muracaateden = textOf(row.muracaateden)
  if (muracaateden) return muracaateden

  const kartno = textOf(row.kartno)
  if (kartno) return `${kartno} kart no'lu kayıt`

  return recordId ? `#${recordId}` : ''
}

function diffFields(oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null): string[] {
  if (!oldRow || !newRow) return []

  const keys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)])
  const changed: string[] = []

  for (const key of keys) {
    if (NOISE_FIELDS.has(key)) continue
    const before = oldRow[key]
    const after = newRow[key]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    changed.push(key)
  }

  return changed
}

export function buildFriendlyAuditDescription(input: FriendlyAuditInput): string {
  const { tableName, recordId, fallbackDescription } = input
  const op = (input.operationType || '').toLocaleLowerCase('tr-TR')
  const oldRow = asRecord(input.oldValue)
  const newRow = asRecord(input.newValue)
  const label = tableLabel(tableName)
  const subject = identify(newRow || oldRow, recordId)
  const isYardim = YARDIM_TABLES.has(tableName)

  const isInsert = op === 'ekle' || op === 'insert'
  const isDelete = op === 'sil' || op === 'delete'
  const isUpdate = op === 'guncelle' || op === 'update'

  if (isInsert) {
    if (isYardim) return subject ? `${subject} için ${label.toLocaleLowerCase('tr-TR')} kaydı başlatıldı.` : `${label} kaydı başlatıldı.`
    return subject ? `${subject}: ${label.toLocaleLowerCase('tr-TR')} kaydı oluşturuldu.` : `${label} kaydı oluşturuldu.`
  }

  if (isDelete) {
    if (isYardim) return subject ? `${subject} için ${label.toLocaleLowerCase('tr-TR')} kaydı silindi.` : `${label} kaydı silindi.`
    return subject ? `${subject}: ${label.toLocaleLowerCase('tr-TR')} kaydı silindi.` : `${label} kaydı silindi.`
  }

  if (isUpdate) {
    const changedFields = diffFields(oldRow, newRow)

    if (changedFields.includes('durumu')) {
      const before = textOf(oldRow?.durumu)
      const after = textOf(newRow?.durumu)
      if (isYardim) {
        return subject
          ? `${subject} kaydının durumu değiştirildi (${before || '-'} → ${after || '-'}).`
          : `${label} durumu değiştirildi (${before || '-'} → ${after || '-'}).`
      }
      return subject
        ? `${subject}: durum ${before || '-'} değerinden ${after || '-'} değerine değiştirildi.`
        : `${label} durumu ${before || '-'} değerinden ${after || '-'} değerine değiştirildi.`
    }

    if (changedFields.length === 0) {
      return subject ? `${subject}: ${label.toLocaleLowerCase('tr-TR')} kaydında güncelleme yapıldı.` : `${label} kaydında güncelleme yapıldı.`
    }

    const fieldNames = changedFields.slice(0, 4).map(fieldLabel).join(', ')
    const extra = changedFields.length > 4 ? ` ve ${changedFields.length - 4} alan daha` : ''
    return subject
      ? `${subject}: ${fieldNames}${extra} alanında güncelleme yapıldı.`
      : `${label} kaydında ${fieldNames}${extra} alanında güncelleme yapıldı.`
  }

  return fallbackDescription || `${label} kaydında ${op || 'bir işlem'} yapıldı.`
}
