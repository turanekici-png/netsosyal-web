import 'server-only'
import { Pool } from 'pg'
import { createUtcTypeOverrides } from '@/lib/db/pgTypeParsers'
import { hasPageAccess } from '@/lib/constants/pageAccess'
import type { UserPermissionConfig } from '@/lib/constants/userPermissions'

// Sosyal Asistan (14 Eylul 2026, 23. tur) - "tam SQL'e hakim" bir yapay
// zeka asistani icin GUVENLI, salt-okunur sorgu katmani. Asistan kendi
// SQL'ini yazar ama BURADAKI kontrollerin TAMAMINDAN gecmeden calismaz:
//
//   1) Ayri, salt-okunur bir Postgres rolu (ASISTAN_DATABASE_URL) - SQL
//      dogrulamasi bir sekilde atlatilsa BILE veritabani seviyesinde yazma
//      FIZIKSEL olarak mumkun degil (bkz. deploy notlari - rol henuz
//      canlida OLUSTURULMADI, bkz. memory "sosyal-asistan-ai.md").
//   2) validateSql(): tek SELECT/WITH ifadesi, tehlikeli anahtar kelime
//      yok, LIMIT yoksa otomatik eklenir.
//   3) checkTablePermissions(): sorguda gecen tablolar, soran kullanicinin
//      MEVCUT sayfa/islem yetkisiyle karsilastirilir (allow-list, eslemesi
//      olmayan tablo VARSAYILAN OLARAK REDDEDILIR).
//   4) Her calistirma logService ile denetim kaydina yazilir (bkz.
//      app/api/asistan/chat/route.ts).

const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|grant|revoke|truncate|copy|create|execute|call\s|merge|lock|vacuum|reindex|listen|notify|prepare|deallocate|into)\b/i

const DANGEROUS_PATTERNS = [
  /pg_catalog\.pg_/i,
  /information_schema\./i,
  /pg_read_file/i,
  /pg_ls_dir/i,
  /pg_read_binary_file/i,
  /dblink/i,
  /pg_sleep/i,
  /\bsifre\b/i, // kullanicilar.sifre - hic bir sorguda dondurulmemeli
]

export type SqlValidationResult =
  | { ok: true; sql: string }
  | { ok: false; error: string }

export function validateAssistantSql(rawSql: string): SqlValidationResult {
  const trimmed = (rawSql ?? '').trim()
  if (!trimmed) return { ok: false, error: 'Boş sorgu.' }

  const withoutTrailingSemicolon = trimmed.replace(/;+\s*$/, '')
  if (withoutTrailingSemicolon.includes(';')) {
    return { ok: false, error: 'Birden fazla ifade içeren sorgulara izin verilmiyor (tek bir SELECT olmalı).' }
  }

  if (!/^(with|select)\b/i.test(withoutTrailingSemicolon)) {
    return { ok: false, error: 'Sadece SELECT (veya WITH ... SELECT) sorgularına izin veriliyor.' }
  }

  if (FORBIDDEN_KEYWORDS.test(withoutTrailingSemicolon)) {
    return { ok: false, error: 'Sorgu izin verilmeyen bir anahtar kelime veya sütun içeriyor.' }
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(withoutTrailingSemicolon)) {
      return { ok: false, error: 'Sorgu izin verilmeyen bir sistem tablosuna/fonksiyona veya hassas sütuna erişmeye çalışıyor.' }
    }
  }

  // Kullanici istegi (2026-09-16): "listede sınır olmasın, liste kaç
  // kişilikse onu versin" - eskiden LIMIT verilmezse otomatik 200'e
  // kesiliyordu (kullaniciya gosterilen/xlsx'e aktarilan tablo bu yuzden
  // hep en fazla 200 satirdi). Artik model LIMIT vermezse sorgu TÜM
  // eşleşen satırları döner - sadece yanlışlıkla/kötü niyetli TÜM
  // tabloyu (ör. 129 bin satırlık bireyler) dökmeye çalışan bir sorgunun
  // sunucuyu/tarayıcıyı kilitlememesi için çok yüksek bir GÜVENLİK TAVANI
  // (normal, filtreli bir liste sorgusunda asla görülmez) bırakıldı.
  const hasLimit = /\blimit\s+\d+/i.test(withoutTrailingSemicolon)
  const finalSql = hasLimit ? withoutTrailingSemicolon : `${withoutTrailingSemicolon}\nLIMIT 50000`

  return { ok: true, sql: finalSql }
}

// "WITH cte_adi AS (...)" ile tanimlanan gecici isimler gercek tablo
// degildir - yetki kontrolunden MUAF tutulur (asil kisit, CTE'nin ICINDEKI
// gercek FROM/JOIN hedeflerine zaten ayrica uygulanir).
function extractCteNames(sql: string): Set<string> {
  const names = new Set<string>()
  const regex = /(?:^|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(sql))) {
    names.add(match[1].toLowerCase())
  }
  return names
}

export function extractReferencedTables(sql: string): string[] {
  const cteNames = extractCteNames(sql)
  const names = new Set<string>()
  const regex = /\b(?:from|join)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(sql))) {
    const name = match[1].toLowerCase()
    if (!cteNames.has(name)) names.add(name)
  }
  return [...names]
}

type TablePermissionRule = {
  pages?: string[]
  actions?: string[]
  // true ise herkes (kisitli kullanici dahil) erisebilir - /communication
  // istisnasiyla ayni mantik.
  open?: boolean
}

// Deny-by-default: burada olmayan bir tablo REDDEDILIR. Yeni bir tablo
// eklendiginde (ya da asistanin yeni bir alani kapsamasi istendiginde)
// buraya bir satir eklenmesi yeterli.
const TABLE_PERMISSION_MAP: Record<string, TablePermissionRule> = {
  // Dosya / hane
  dosyalar: { pages: ['/documents', '/reports'] },
  bireyler: { pages: ['/documents', '/reports', '/beneficiary'] },
  beklenen_evraklar: { pages: ['/documents'] },
  dosyano2: { pages: ['/documents'] },
  mahalleler: { open: true },

  // Yardim turleri
  yrd_ayninakti: { pages: ['/documents', '/assistance', '/reports', '/requests'] },
  yrd_aceze: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_ddgidadosyali: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_ddgidadosyasiz: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_destekpaketi: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_destekpaketihrk: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_digerkrmalyrdm: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_ekmek: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_ekmekhrk: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_emtia: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_emtia_log: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_gidabankasi: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_gidabankasidnm: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_gidabankasihrk: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_giyim: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_haziryemek: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_haziryemekhrk: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_kirtasiye: { pages: ['/documents', '/assistance', '/reports'] },
  yrd_yakacak: { pages: ['/documents', '/assistance', '/reports'] },
  cenaze_yemekleri: { pages: ['/documents', '/assistance', '/reports'] },
  yardim_sayac: { pages: ['/reports'] },
  yardim_hareketleri: { pages: ['/reports', '/documents'] },
  nakitkart: { pages: ['/gulkart', '/documents'] },
  nakitkartrezerv: { pages: ['/gulkart', '/documents'] },
  mobil_yardim_tipleri: { pages: ['/assistance', '/documents'] },
  yardim_onay_talepleri: { pages: ['/approval-queue', '/documents'] },
  onay_islemleri: { pages: ['/approval-queue', '/documents'] },

  // Online basvurular
  online_basvurular: { pages: ['/online'] },

  // Ev ziyareti - 21. turda eklenen AYNI ayri yetki
  evziyareti: { actions: ['documents.homeVisits.view'] },

  // Kullanici / personel
  kullanicilar: { actions: ['users.manage'] },
  app_kullanici_yetkileri: { actions: ['users.manage'] },
  kullanici_yetkileri: { actions: ['users.manage'] },
  mobil_kullanicilar: { actions: ['users.manage'] },

  // Ayarlar / sistem
  app_settings: { actions: ['settings.update'] },
  ayarlar: { actions: ['settings.update'] },
  sistem_ayarlar: { actions: ['settings.update'] },
  hazir_degerler: { actions: ['settings.update'] },
  ref_kod: { actions: ['settings.update'] },
  sayacno: { actions: ['settings.update'] },
  sayacnover: { actions: ['settings.update'] },
  sistem_zamanli_gorevler: { pages: ['/scheduled-tasks'], actions: ['settings.update'] },
  sistem_audit_revizyonlar: { actions: ['sql.manage'] },
  sistem_hareket_log: { pages: ['/logs'], actions: ['sql.manage'] },
  push_subscriptions: { actions: ['settings.update'] },
  sistem_bildirimler: { open: true },
  sistem_mesaj_sablonlari: { actions: ['settings.update'] },
  sistem_evrak_takip: { pages: ['/documents'] },
  efatura_log: { actions: ['settings.update'] },

  // Iletisim - /communication ile ayni: herkese acik
  kurum_ici_iletisim: { open: true },
  kurum_ici_iletisim_ekler: { open: true },
  kurum_ici_iletisim_alicilar: { open: true },
  kutuici: { open: true },
  whatsapp_gonderim_log: { pages: ['/reports'] },
  sms_gonderim_log: { pages: ['/reports'] },

  // Is akisi / tahkikat
  sistem_gorevler: { pages: ['/workflow'] },
  tahkikatraporlari: { pages: ['/workflow', '/documents'] },
}

export function hasActionAccess(permissionConfig: UserPermissionConfig | null, actionId: string): boolean {
  if (!permissionConfig || permissionConfig.isAdmin) return true
  if (permissionConfig.isActive === false) return false
  if (!permissionConfig.allowedActions?.length) return true
  return permissionConfig.allowedActions.includes(actionId)
}

export type TablePermissionCheck =
  | { ok: true }
  | { ok: false; deniedTables: string[] }

export function checkTablePermissions(
  permissionConfig: UserPermissionConfig | null,
  tableNames: string[],
): TablePermissionCheck {
  if (!permissionConfig || permissionConfig.isAdmin) return { ok: true }
  if (permissionConfig.isActive === false) return { ok: false, deniedTables: tableNames }

  const deniedTables: string[] = []

  for (const table of tableNames) {
    const rule = TABLE_PERMISSION_MAP[table]
    if (!rule) {
      deniedTables.push(table)
      continue
    }
    if (rule.open) continue

    const pageOk = rule.pages?.some((page) => hasPageAccess(permissionConfig, page)) ?? false
    const actionOk = rule.actions?.some((action) => hasActionAccess(permissionConfig, action)) ?? false

    if (!pageOk && !actionOk) deniedTables.push(table)
  }

  return deniedTables.length === 0 ? { ok: true } : { ok: false, deniedTables }
}

const globalForAssistantPool = globalThis as unknown as {
  assistantReadOnlyPool?: Pool
}

export function getAssistantReadOnlyPool(): Pool {
  if (!globalForAssistantPool.assistantReadOnlyPool) {
    const connectionString = process.env.ASISTAN_DATABASE_URL
    if (!connectionString) {
      throw new Error('ASISTAN_DATABASE_URL tanımlı değil - salt-okunur veritabanı rolü henüz kurulmadı.')
    }

    globalForAssistantPool.assistantReadOnlyPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      types: createUtcTypeOverrides(),
    } as any)
  }

  return globalForAssistantPool.assistantReadOnlyPool
}

export type AssistantQueryResult = {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
}

export async function runAssistantQuery(sql: string): Promise<AssistantQueryResult> {
  const pool = getAssistantReadOnlyPool()
  const result = await pool.query(sql) as unknown as {
    rows: Record<string, unknown>[]
    rowCount: number | null
    fields: { name: string }[]
  }
  const columns = result.fields?.map((field) => field.name) ?? []
  return {
    columns,
    rows: result.rows as Record<string, unknown>[],
    rowCount: result.rowCount ?? result.rows.length,
  }
}
