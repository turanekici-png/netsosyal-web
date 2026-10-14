// Online Başvurular yönetim listesi (app/online/page.tsx) ile o listedeki
// toplu işlemlerin (bulk-update, transfer-to-cash) ORTAK sorgu tanımları.
//
// 2026-10-14: bu ifadeler eskiden üç dosyada ayrı ayrı kopyalanmıştı ve
// arama mantıkları farklılaşmıştı - liste Türkçe/büyük-küçük harf duyarsız
// aramayı (buildTextSearchClause) kullanırken "Filtrelenenleri Nakit
// Müracaata Aktar" ve filtreli toplu güncelleme eski ILIKE aramasını
// kullanıyordu. Sonuç: ekranda görünen kayıtlarla işlemin uyguladığı
// kayıtlar farklı olabiliyordu (örn. "sahin" araması listede "ŞAHİN"i
// gösterip aktarımda atlıyordu). Artık üçü de buradaki TEK tanımı kullanır.

import { buildMappedFilterCondition, buildTextSearchClause } from '@/lib/utils'
import type { Pool, PoolClient } from 'pg'

export const fullNameSql = `
  COALESCE(
    NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(t.ad, ''), NULLIF(t.soyad, ''))), ''),
    NULLIF(t.answers->>'fullName', ''),
    NULLIF(t.answers->>'f_name', '')
  )
`

// f_17836... anahtarları: alan eşleştirmesi (fieldKey) düzeltilmeden ÖNCE
// gelen eski başvuruların cevapları bu form alanı ID'leri altında
// saklanmıştı - eski kayıtlar boş görünmesin diye geriye dönük uyumluluk.
export const phoneSql = `COALESCE(NULLIF(t.answers->>'phone', ''), NULLIF(t.answers->>'f_phone', ''), NULLIF(t.answers->>'telefon', ''))`
export const incomeSql = `COALESCE(NULLIF(t.answers->>'income', ''), NULLIF(t.answers->>'f_income', ''))`
export const vehicleStatusSql = `COALESCE(NULLIF(t.answers->>'vehicleStatus', ''), NULLIF(t.answers->>'f_1783585922150', ''))`
export const vehicleModelYearSql = `COALESCE(NULLIF(t.answers->>'vehicleModelYear', ''), NULLIF(t.answers->>'f_1783665438908', ''))`
export const ibanSql = `COALESCE(NULLIF(t.answers->>'iban', ''), NULLIF(t.answers->>'f_1783668607481', ''))`
export const propertySql = `COALESCE(NULLIF(t.answers->>'propertyInfo', ''), NULLIF(t.answers->>'property', ''), NULLIF(t.answers->>'mulkiyet', ''), NULLIF(t.answers->>'mulkiyetBilgisi', ''))`
export const amountSql = `COALESCE(NULLIF(t.answers->>'amount', ''), NULLIF(t.answers->>'miktar', ''), NULLIF(t.answers->>'assistanceAmount', ''), NULLIF(t.answers->>'yardimMiktari', ''), NULLIF(t.answers->>'yardim_miktari', ''), NULLIF(t.answers->>'f_amount', ''))`
export const periodSql = `COALESCE(NULLIF(t.donem, ''), NULLIF(t.answers->>'period', ''), NULLIF(t.answers->>'donem', ''))`

// Mahalle: başvuru kaydında mahalleadi eskiden HİÇ doldurulmuyordu. Artık
// başvuru anında NVİ adresinden çıkarılıp yazılıyor (bkz.
// extractNeighborhoodFromAddress); eski/boş kayıtlarda ise aynı kural
// adresten SQL ile okunur. NVİ adresleri "FATİH MAH. 60-44. SK. ..."
// biçimindedir.
export const neighborhoodSql = `COALESCE(
  NULLIF(BTRIM(t.mahalleadi), ''),
  NULLIF(UPPER(BTRIM(SUBSTRING(t.adres FROM '(?i)^\\s*(.+?)\\s+mah(\\.|\\s|alles)'))), '')
)`

// Formdaki cevapların SADECE değerleri (anahtar adları değil) - eskiden
// "t.answers::text" aranıyordu, "phone"/"iban" gibi ANAHTAR adları her
// kayıtta geçtiği için bu kelimelerle yapılan arama tüm kayıtları getiriyordu.
const answersValuesSql = `(SELECT string_agg(a.value, ' ') FROM jsonb_each_text(COALESCE(t.answers, '{}'::jsonb)) a)`

export const ONLINE_FILTER_COLUMN_MAP: Record<string, string> = {
  id: 't.id',
  // created_at UTC olarak saklanır (DB saat dilimi GMT); tarih filtreleri
  // ("Bugün" vb.) Türkiye saatine göre çalışsın diye yerel saate çevrilir -
  // yoksa 00:00-03:00 arası gelen başvurular önceki güne sayılıyordu.
  basvuru_tarihi: `((t.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')`,
  tc: 't.tckimlikno',
  ad_soyad: fullNameSql,
  dogum_tarihi: 't.dogumtarihi',
  telefon: phoneSql,
  aylik_gelir: incomeSql,
  arac_durumu: vehicleStatusSql,
  arac_modeli: vehicleModelYearSql,
  iban: ibanSql,
  miktar: amountSql,
  mulkiyet_bilgisi: propertySql,
  yardim_turu: 't.yardim_turu',
  mahalle: neighborhoodSql,
  adres: 't.adres',
  durum: 't.status',
  donem: periodSql,
  etiket: 't.etiket',
  asama: 't.asama',
  aciklama: 't.aciklama',
  basvuru_yili: 't.basvuru_yili',
  donem_grubu: 't.donem_grubu',
}

const ONLINE_SEARCH_COLUMNS = [
  't.tckimlikno', fullNameSql, phoneSql, incomeSql, vehicleStatusSql, vehicleModelYearSql,
  ibanSql, amountSql, 't.yardim_turu', neighborhoodSql, 't.adres', 't.status', 't.aciklama',
  answersValuesSql,
]

// Listenin, filtreli toplu güncellemenin ve filtreli aktarımın kullandığı
// TEK WHERE koşulu ("t" takma adlı online_basvurular için).
export function buildOnlineApplicationsWhere(filters: Record<string, string>): string {
  const filterCondition = buildMappedFilterCondition(filters, ONLINE_FILTER_COLUMN_MAP)
  const searchCondition = buildTextSearchClause(ONLINE_SEARCH_COLUMNS, String(filters.search || '').trim())
  return `1=1 ${filterCondition} ${searchCondition}`
}

export function hasActiveOnlineFilter(filters: Record<string, string>) {
  return Boolean(String(filters.search || '').trim()) || Object.entries(filters).some(([key, value]) => key.startsWith('f_') && value)
}

// "FATİH MAH. 60-44. SK. ..." -> "FATİH" (dosyalar.mahalleadi ile aynı biçim)
export function extractNeighborhoodFromAddress(address: string | null | undefined): string | null {
  if (!address) return null
  const match = address.match(/^\s*(.+?)\s+MAH(?:ALLES[İI]|\.|\s)/i)
  if (!match) return null
  const name = match[1].trim().toLocaleUpperCase('tr-TR')
  return name && name.length <= 80 ? name : null
}

// ---------------------------------------------------------------------------
// İşlem kaydı (audit): veritabanındaki ortak sistem_audit_trigger_fn()
// tetikleyicisi dosyalar/yrd_* tablolarında her ekle/güncelle/sil işlemini
// eski+yeni değeriyle sistem_hareket_log'a yazıyor; online_basvurular'da bu
// tetikleyici YOKTU - silinen bir başvuru geri getirilemiyor, kimin neyi
// değiştirdiği bilinmiyordu. Aynı tetikleyici, ilk yazma işleminde (kendi
// kendini onaran desen - bkz. transfer-to-cash ensureYrdAyninaktiAdresColumn)
// bir kez eklenir. Silinen kayıt sistem_hareket_log.eski_deger'de tam haliyle
// durur.
let auditTriggerEnsured = false

export async function ensureOnlineApplicationsAuditTrigger(pool: Pool | PoolClient) {
  if (auditTriggerEnsured) return
  try {
    const existing = await pool.query(`
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'trg_audit_online_basvurular'
        AND tgrelid = 'public.online_basvurular'::regclass
      LIMIT 1
    `)
    if (existing.rows.length === 0) {
      const fn = await pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'sistem_audit_trigger_fn' LIMIT 1`)
      if (fn.rows.length > 0) {
        await pool.query(`
          CREATE TRIGGER trg_audit_online_basvurular
          AFTER INSERT OR UPDATE OR DELETE ON public.online_basvurular
          FOR EACH ROW EXECUTE FUNCTION public.sistem_audit_trigger_fn()
        `)
      }
    }
    auditTriggerEnsured = true
  } catch (error) {
    // İşlem kaydı eklenemese bile asıl işlem (sil/güncelle) engellenmesin.
    console.error('online_basvurular audit tetikleyicisi eklenemedi:', error)
  }
}
