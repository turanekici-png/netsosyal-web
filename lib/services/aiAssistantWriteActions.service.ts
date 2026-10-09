import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { internalOrigin } from '@/lib/internalOrigin'
import { hasActionAccess } from '@/lib/services/asistanSql.service'
import type { UserPermissionConfig } from '@/lib/constants/userPermissions'

// Kullanici istegi (15 Eylul 2026, 39. tur): "sosyal asistan ... dosya
// acmaya, yardim veya muracaat eklemeye, bilgi degistirmeye ... yapabilsin
// ama SADECE yetki verilen kullanici yapabilsin". Kullanici, AskUserQuestion
// ile UC onemli karari NETLESTIRDI:
//   1) Yazma SERBEST SQL ile DEGIL, uygulamanin ZATEN dogrulanmis/test
//      edilmis mevcut API uc noktalari uzerinden yapilir (ham INSERT/UPDATE/
//      DELETE SQL YOK) - boylece is kurallari (dogrulama, mukerrer kontrolu,
//      audit) ATLANAMAZ.
//   2) Silme dahil TUM islemler acik olsun istendi - ANCAK arastirma
//      sirasinda bulundu: dosya/birey SERT SILME (requireDestructiveAuthorization,
//      bkz. lib/security/destructiveAuthorization.ts) kullanicinin SIFRESINI
//      YENIDEN girmesini gerektiren, sadece UI'daki bir modal ile alinabilen
//      tek kullanimlik bir belirtec ister - bu, bir sohbet mesaji ile
//      KARSILANAMAZ. Bu yuzden dosya/birey silme BILINCLI olarak
//      UYGULANMADI (asagida executeDeleteFile/executeDeletePerson YOK).
//      Nakit muracaati "silme" ise zaten uygulamanin kendi ic mantiginda
//      HIC bir zaman sert silme degil, "iptal" (durumu=1) - bu guvenlik
//      kisidina TAKILMAZ, bu yuzden cancel_nakit_application UYGULANDI.
//   3) Her yazma aracinda AI once "confirmed:false" ile bir ONIZLEME
//      dondurur (hicbir sey KAYDEDILMEZ), kullanici onayladiktan SONRA
//      AYNI arac "confirmed:true" ile TEKRAR cagrilir - GERCEK yazma o
//      zaman olur (bkz. asagida her execute* fonksiyonunun basindaki
//      "confirmed" kontrolu, ve lib/services/aiAssistant.service.ts'teki
//      sistem talimati kurallari).
//
// Yetki modeli (IKI KATMANLI):
//   a) "asistan.write" - SADECE "asistan uzerinden yazma acik mi" sorusuna
//      cevap verir (bkz. lib/constants/userPermissions.ts). Bu yoksa asagidaki
//      araclarin HICBIRI modele SUNULMAZ bile (bkz. aiAssistant.service.ts).
//   b) Asil islem yetkisi (documents.create, assistance.create vb.) - HER
//      yazma cagrisi, GERCEK API ucuna kullanicinin KENDI oturum cerezi
//      (Cookie header) ILE yapilir; o uc nokta requireApiAccess ile bu
//      yetkiyi KENDISI tekrar dogrular - burada AYRICA taklit/tekrar
//      edilmez, TEK dogruluk kaynagi budur (defans katmani, kod tekrari degil).

export function isAssistantWriteEnabled(permissionConfig: UserPermissionConfig | null): boolean {
  return hasActionAccess(permissionConfig, 'asistan.write')
}

export type WriteToolContext = {
  cookieHeader: string
}

type ApiResult = { success: boolean; data?: Record<string, unknown>; error?: string }

async function callInternalApi(path: string, method: string, body: unknown, cookieHeader: string): Promise<ApiResult> {
  const response = await fetch(`${internalOrigin()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null) as ApiResult | null
  if (!response.ok || !payload?.success) {
    return { success: false, error: payload?.error || `İşlem başarısız oldu (HTTP ${response.status}).` }
  }
  return payload
}

// Modelin (AI) gonderdigi arac parametreleri tip-guvenli DEGILDIR - eksik/
// yanlis turde alan gelebilir. Asagidaki yardimcilar bunu GUVENLI sekilde
// cikarir; zorunlu bir alan eksikse acik bir hata doner (executeRunSqlQuery
// ile AYNI savunmaci desen, bkz. aiAssistant.service.ts).
function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function requiredStr(args: Record<string, unknown>, key: string): string | { error: string } {
  const value = str(args, key)
  return value ?? { error: `"${key}" alanı zorunludur.` }
}
function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
function isErr(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value
}

type PersonInput = {
  id?: string
  tc?: string
  firstName?: string
  lastName?: string
  fatherName?: string
  motherName?: string
  birthPlace?: string
  birthDate?: string
  deathDate?: string
  gender?: string
  maritalStatus?: number | string | null
  nationality?: string
  relation?: number | string | null
  phone?: string
  neighborhood?: string
  district?: string
  address?: string
}

function toIsoDate(value: unknown): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value as string)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10)
}

// Ham "pg" satir degerlerini (unknown tipli) guvenli sekilde string'e cevirir.
function rowStr(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return String(value)
}

// "update_dosya_info" ve "add_household_member" icin GUVENLI temel: mevcut
// dosya + TUM bireyleri (id'leri KORUNARAK) oldugu gibi geri okur. Bu,
// /api/documents/update'in "TAM YER DEGISTIRME" davranisina (gonderilen
// listede olmayan HERKESI SILER) karsi tek savunma - id'ler eslesirse
// hicbir birey kaybolmaz (bkz. app/api/documents/update/route.ts).
async function loadCurrentFileForSafeMerge(fileId: string) {
  const fileRows = await prisma.$queryRaw<Array<{
    id: bigint; dosyano: string | null; durumu: number | null; aileniteligi: number | null
    adres: string | null; telefon: string | null; aciklama: string | null; mahalleadi: string | null
  }>>`SELECT id, dosyano, durumu, aileniteligi, adres, telefon, aciklama, mahalleadi FROM dosyalar WHERE id = ${BigInt(fileId)}`
  const file = fileRows[0]
  if (!file) return null

  const peopleRows = await prisma.$queryRaw<Array<{
    id: bigint; tckimlikno: string | null; adi: string | null; soyadi: string | null
    babaadi: string | null; anaadi: string | null; dogumyeri: string | null
    dogumtarihi: Date | null; olumtarihi: string | null; medenihali: number | null
    cinsiyeti: string | null; uyrugu: string | null; yakinligi: number | null
    nfilce: string | null; nfmahkoy: string | null; ceptel: string | null; adres: string | null
  }>>`SELECT id, tckimlikno, adi, soyadi, babaadi, anaadi, dogumyeri, dogumtarihi, olumtarihi, medenihali, cinsiyeti, uyrugu, yakinligi, nfilce, nfmahkoy, ceptel, adres FROM bireyler WHERE dosyaid = ${BigInt(fileId)} ORDER BY (yakinligi = 0) DESC, id ASC`

  const people: PersonInput[] = peopleRows.map((p) => ({
    id: p.id.toString(),
    tc: p.tckimlikno ?? undefined,
    firstName: p.adi ?? undefined,
    lastName: p.soyadi ?? undefined,
    fatherName: p.babaadi ?? undefined,
    motherName: p.anaadi ?? undefined,
    birthPlace: p.dogumyeri ?? undefined,
    birthDate: toIsoDate(p.dogumtarihi),
    deathDate: p.olumtarihi ?? undefined,
    gender: p.cinsiyeti ?? undefined,
    maritalStatus: p.medenihali ?? undefined,
    nationality: p.uyrugu ?? undefined,
    relation: p.yakinligi ?? undefined,
    phone: p.ceptel ?? undefined,
    district: p.nfilce ?? undefined,
    neighborhood: p.nfmahkoy ?? undefined,
    address: p.adres ?? undefined,
  }))

  const applicant = people.find((p) => Number(p.relation) === 0) ?? people[0]
  const household = people.filter((p) => p !== applicant)

  if (!applicant) return null

  return { file, applicant, household }
}

// --- 1) Dosya (vaka dosyası) oluşturma ---

export async function executeCreateDosya(args: Record<string, unknown>, ctx: WriteToolContext) {
  const firstName = requiredStr(args, 'firstName')
  if (isErr(firstName)) return firstName
  const lastName = requiredStr(args, 'lastName')
  if (isErr(lastName)) return lastName
  const phone = str(args, 'phone')
  const identityNumber = str(args, 'identityNumber')
  const address = str(args, 'address')
  const description = str(args, 'description')
  const confirmed = args.confirmed === true

  const summary = `Yeni dosya açılacak: ${firstName} ${lastName}${phone ? ` (Tel: ${phone})` : ' (telefon numarası girilmedi)'}${address ? `, Adres: ${address}` : ''}.`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY KAYDEDİLMEDİ.' }
  }

  const result = await callInternalApi('/api/documents/create', 'POST', {
    applicant: { firstName, lastName, phone, tc: identityNumber, address },
    address,
    description,
    requirePhone: !phone ? false : undefined,
  }, ctx.cookieHeader)

  if (!result.success) return { error: result.error }
  return { success: true, fileId: result.data?.fileId, fileNo: result.data?.fileNo, message: `Dosya oluşturuldu (Dosya No: ${result.data?.fileNo}).` }
}

// --- 2) Dosya bilgisi güncelleme (durum/açıklama/adres/telefon/aile niteliği) ---

export async function executeUpdateDosyaInfo(args: Record<string, unknown>, ctx: WriteToolContext) {
  const fileId = requiredStr(args, 'fileId')
  if (isErr(fileId)) return fileId
  const status = num(args, 'status')
  const description = str(args, 'description')
  const address = str(args, 'address')
  const phone = str(args, 'phone')
  const familyType = num(args, 'familyType')
  const confirmed = args.confirmed === true

  const current = await loadCurrentFileForSafeMerge(fileId)
  if (!current) return { error: 'Dosya bulunamadı.' }

  const changes: string[] = []
  if (status !== undefined) changes.push(`Durum: ${status}`)
  if (description !== undefined) changes.push(`Açıklama: "${description}"`)
  if (address !== undefined) changes.push(`Adres: "${address}"`)
  if (phone !== undefined) changes.push(`Telefon: ${phone}`)
  if (familyType !== undefined) changes.push(`Aile Niteliği: ${familyType}`)

  const summary = `Dosya No ${current.file.dosyano} güncellenecek - ${changes.join(', ') || 'değişiklik belirtilmedi'}. Hane bireyleri (${current.household.length + 1} kişi) AYNEN korunacak.`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY KAYDEDİLMEDİ.' }
  }

  const applicant = { ...current.applicant, phone: phone ?? current.applicant.phone }

  const result = await callInternalApi('/api/documents/update', 'POST', {
    fileId,
    fileNo: current.file.dosyano,
    status: status ?? current.file.durumu,
    familyType: familyType ?? current.file.aileniteligi,
    address: address ?? current.file.adres,
    phone: phone ?? current.file.telefon,
    description: description ?? current.file.aciklama,
    applicant,
    household: current.household,
  }, ctx.cookieHeader)

  if (!result.success) return { error: result.error }
  return { success: true, message: 'Dosya bilgileri güncellendi.' }
}

// --- 3) Haneye yeni birey ekleme ---

export async function executeAddHouseholdMember(args: Record<string, unknown>, ctx: WriteToolContext) {
  const fileId = requiredStr(args, 'fileId')
  if (isErr(fileId)) return fileId
  const firstName = requiredStr(args, 'firstName')
  if (isErr(firstName)) return firstName
  const lastName = requiredStr(args, 'lastName')
  if (isErr(lastName)) return lastName
  const relation = num(args, 'relation')
  const identityNumber = str(args, 'identityNumber')
  const birthDate = str(args, 'birthDate')
  const phone = str(args, 'phone')
  const confirmed = args.confirmed === true

  const current = await loadCurrentFileForSafeMerge(fileId)
  if (!current) return { error: 'Dosya bulunamadı.' }

  const summary = `Dosya No ${current.file.dosyano} hanesine yeni kişi eklenecek: ${firstName} ${lastName}. Mevcut ${current.household.length + 1} kişi AYNEN korunacak.`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY KAYDEDİLMEDİ.' }
  }

  const newPerson: PersonInput = { firstName, lastName, relation, tc: identityNumber, birthDate, phone }

  const result = await callInternalApi('/api/documents/update', 'POST', {
    fileId,
    fileNo: current.file.dosyano,
    status: current.file.durumu,
    familyType: current.file.aileniteligi,
    address: current.file.adres,
    phone: current.file.telefon,
    description: current.file.aciklama,
    applicant: current.applicant,
    household: [...current.household, newPerson],
  }, ctx.cookieHeader)

  if (!result.success) return { error: result.error }
  return { success: true, message: `${firstName} ${lastName} haneye eklendi.` }
}

// --- 4) Yardım/müracaat ekleme (Ekmek, Gıda Bankası, Destek Paketi, Hazır
//     Yemek, Giyim, Dönem Dışı Gıda, Ayni/Nakdi ortak uç noktası) ---

const APPLICATION_TYPE_LABELS: Record<string, string> = {
  Ekmek: 'Ekmek Yardımı',
  'Gıda Bankası': 'Gıda Bankası',
  'Destek Paketi': 'Destek Paketi',
  'Hazır Yemek': 'Hazır Yemek',
  Giyim: 'Giyim Yardımı',
  'Dönem Dışı Gıda': 'Dönem Dışı Gıda',
  'Ayni/Nakdi': 'Nakit Yardımı',
}

// Kullanici istegi (15 Eylul 2026, 43. tur) - "herhangi bir yardimin
// bilgisini guncelle dedigimde guncellesin": ayni turleri (yukaridaki
// APPLICATION_TYPE_LABELS) hangi TABLOYA eslendigini burada da tekrarliyoruz
// (bkz. app/api/documents/applications/route.ts APPLICATION_TYPES) - "type"
// PATCH'e degil, GUVENLI tablo secimi icin SADECE burada kullanilir.
const APPLICATION_TABLE_BY_TYPE: Record<string, string> = {
  Ekmek: 'yrd_ekmek',
  'Gıda Bankası': 'yrd_gidabankasi',
  'Destek Paketi': 'yrd_destekpaketi',
  'Hazır Yemek': 'yrd_haziryemek',
  Giyim: 'yrd_giyim',
  'Dönem Dışı Gıda': 'yrd_ddgidadosyali',
  'Ayni/Nakdi': 'yrd_ayninakti',
}

export async function executeAddApplication(args: Record<string, unknown>, ctx: WriteToolContext) {
  const fileId = requiredStr(args, 'fileId')
  if (isErr(fileId)) return fileId
  const type = requiredStr(args, 'type')
  if (isErr(type)) return type
  const applicantName = requiredStr(args, 'applicantName')
  if (isErr(applicantName)) return applicantName
  const identityNumber = str(args, 'identityNumber')
  const phone = str(args, 'phone')
  const amount = str(args, 'amount')
  const period = str(args, 'period')
  const description = str(args, 'description')
  const confirmed = args.confirmed === true

  if (!APPLICATION_TYPE_LABELS[type]) {
    return { error: `Geçersiz yardım türü: "${type}". Geçerli türler: ${Object.keys(APPLICATION_TYPE_LABELS).join(', ')}.` }
  }
  const typeLabel = APPLICATION_TYPE_LABELS[type]

  const summary = `Dosya ${fileId} için ${typeLabel} müracaatı eklenecek - Başvuran: ${applicantName}${amount ? `, Miktar: ${amount}` : ''}${period ? `, Dönem: ${period}` : ''}.`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY KAYDEDİLMEDİ.' }
  }

  const result = await callInternalApi('/api/documents/applications', 'POST', {
    fileId, type, applicantName, identityNumber, phone, amount, period, description,
  }, ctx.cookieHeader)

  if (!result.success) return { error: result.error }
  return { success: true, message: `${typeLabel} müracaatı eklendi.` }
}

// PATCH /api/documents/applications, GONDERILMEYEN her alani NULL yapan bir
// TAM DEGISTIRME (full replace) uc noktasidir (bkz. route.ts - "SET
// muracaateden = ${applicantName}" gibi her sutun DOGRUDAN body'den yazilir,
// eksikse null). Bu yuzden update_application, oncelikle KAYDIN GUNCEL
// halini okuyup, SADECE kullanicinin degistirmek istedigi alanlari
// UZERINE yazip GERI KALANINI KORUYARAK gonderir - aksi halde "sadece
// miktari degistir" gibi bir istek, diger TUM alanlari (aciklama, donem,
// telefon vb.) SESSIZCE bosaltirdi.
//
// Kullanici istegi (15 Eylul 2026, 45. tur): "yardımı buluyor, listede
// gösteriyor, güncelle dediğimde kayıt bulunamadı hatası veriyor" - KOK
// NEDEN bulundu: eskiden bu fonksiyon HEM recordId HEM AI'nin ayrica
// tahmin ettigi fileId'nin İKİSİNİN de eslesmesini SART kosuyordu
// (WHERE id=$1 AND dosyaid=$2) - AI, dogru kaydi bulsa bile fileId'yi
// yanlis/eksik ilettiginde (ör. baska bir dosyanin id'sini karistirinca)
// sorgu SIFIR SATIR donuyor, "kayit bulunamadi" goruluyordu. recordId
// (birincil anahtar) TEK BASINA zaten kaydi kesin olarak belirliyor - bu
// yuzden ARTIK SADECE id ile aranir, dogru dosyaid VERITABANINDAN
// okunarak DONER (AI'nin ayrica dogru tahmin etmesine gerek KALMAZ).
type ApplicationCurrentValues = {
  fileId: string
  applicantName: string; identityNumber?: string; phone?: string; date?: string; period?: string
  description?: string; amount?: string; iban?: string; label?: string; stageStatus?: string
}

async function loadCurrentApplicationForSafeMerge(tableName: string, recordId: string): Promise<ApplicationCurrentValues | null> {
  const { getSqlMonitorPool } = await import('@/lib/services/sqlMonitor.service')
  const pool = getSqlMonitorPool()

  if (tableName === 'yrd_ayninakti') {
    const r = await pool.query(
      'SELECT dosyaid, muracaateden, tckimlikno, ceptel, muracaattarihi, muracaatnotu, miktar, donem, iban, etiket, asama FROM yrd_ayninakti WHERE id = $1',
      [recordId],
    )
    const row = r.rows[0]
    if (!row) return null
    return {
      fileId: rowStr(row.dosyaid) ?? '',
      applicantName: rowStr(row.muracaateden) ?? '', identityNumber: rowStr(row.tckimlikno), phone: rowStr(row.ceptel),
      date: toIsoDate(row.muracaattarihi), period: rowStr(row.donem), description: rowStr(row.muracaatnotu),
      amount: rowStr(row.miktar), iban: rowStr(row.iban), label: rowStr(row.etiket), stageStatus: rowStr(row.asama),
    }
  }

  if (tableName === 'yrd_ddgidadosyali') {
    const r = await pool.query('SELECT dosyaid, muracaateden, nedeni, muracaattarihi, miktar FROM yrd_ddgidadosyali WHERE id = $1', [recordId])
    const row = r.rows[0]
    if (!row) return null
    return { fileId: rowStr(row.dosyaid) ?? '', applicantName: rowStr(row.muracaateden) ?? '', period: rowStr(row.nedeni), date: toIsoDate(row.muracaattarihi), amount: rowStr(row.miktar) }
  }

  // Diger 5 tablo (yrd_giyim, yrd_destekpaketi, yrd_haziryemek, yrd_ekmek,
  // yrd_gidabankasi) ayni genel kalibi (muracaateden/muracaattarihi/
  // aciklama/miktar/donem/etiket) paylasir - route.ts'teki karsilik gelen
  // dallarla/varsayilan dalla AYNI sutunlar.
  const r = await pool.query(
    `SELECT dosyaid, muracaateden, muracaattarihi, aciklama, miktar, donem, etiket FROM ${tableName} WHERE id = $1`,
    [recordId],
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    fileId: rowStr(row.dosyaid) ?? '',
    applicantName: rowStr(row.muracaateden) ?? '', date: toIsoDate(row.muracaattarihi), description: rowStr(row.aciklama),
    amount: rowStr(row.miktar), period: rowStr(row.donem), label: rowStr(row.etiket),
  }
}

export async function executeUpdateApplication(args: Record<string, unknown>, ctx: WriteToolContext) {
  const recordId = requiredStr(args, 'recordId')
  if (isErr(recordId)) return recordId
  const type = requiredStr(args, 'type')
  if (isErr(type)) return type
  const amount = str(args, 'amount')
  const period = str(args, 'period')
  const description = str(args, 'description')
  const phone = str(args, 'phone')
  const identityNumber = str(args, 'identityNumber')
  const applicantName = str(args, 'applicantName')
  const stageStatus = str(args, 'stageStatus')
  const confirmed = args.confirmed === true

  const tableName = APPLICATION_TABLE_BY_TYPE[type]
  if (!tableName) {
    return { error: `Geçersiz yardım türü: "${type}". Geçerli türler: ${Object.keys(APPLICATION_TABLE_BY_TYPE).join(', ')}.` }
  }
  const typeLabel = APPLICATION_TYPE_LABELS[type]

  // Kullanici istegi (15 Eylul 2026, 45. tur): fileId ARTIK istenmez/
  // guvenilmez - kayit SADECE recordId ile bulunur, dogru dosyaid
  // VERITABANINDAN okunur (bkz. loadCurrentApplicationForSafeMerge yorumu).
  let current: ApplicationCurrentValues | null
  try {
    current = await loadCurrentApplicationForSafeMerge(tableName, recordId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Kayıt okunamadı.' }
  }
  if (!current) {
    return { error: `${typeLabel} türünde, id'si ${recordId} olan bir müracaat/yardım kaydı bulunamadı. Doğru türü seçtiğinizden emin olun (ör. bir Nakit Yardımı kaydı "Ekmek" türüyle aranmış olabilir) - run_sql_query ile kaydın hangi tabloda olduğunu tekrar kontrol edin.` }
  }

  const changes: string[] = []
  if (amount !== undefined) changes.push(`Miktar: ${amount}`)
  if (period !== undefined) changes.push(`Dönem: ${period}`)
  if (description !== undefined) changes.push(`Açıklama: "${description}"`)
  if (phone !== undefined) changes.push(`Telefon: ${phone}`)
  if (applicantName !== undefined) changes.push(`Başvuran Adı: ${applicantName}`)
  if (stageStatus !== undefined) changes.push(`Aşama/Durum: ${stageStatus}`)

  const summary = `${typeLabel} müracaatı (kayıt no ${recordId}) güncellenecek - ${changes.join(', ') || 'değişiklik belirtilmedi'}. Diğer tüm alanlar AYNEN korunacak.`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY KAYDEDİLMEDİ.' }
  }

  const result = await callInternalApi('/api/documents/applications', 'PATCH', {
    recordId,
    fileId: current.fileId,
    sourceTable: tableName,
    applicantName: applicantName ?? current.applicantName,
    identityNumber: identityNumber ?? current.identityNumber,
    phone: phone ?? current.phone,
    date: current.date,
    period: period ?? current.period,
    description: description ?? current.description,
    amount: amount ?? current.amount,
    iban: current.iban,
    label: current.label,
    stageStatus: stageStatus ?? current.stageStatus,
  }, ctx.cookieHeader)

  if (!result.success) return { error: result.error }
  return { success: true, message: `${typeLabel} müracaatı güncellendi.` }
}

// --- 5) Nakit yardımı müracaat aşaması/durumu güncelleme ---

export async function executeUpdateNakitStage(args: Record<string, unknown>, ctx: WriteToolContext) {
  const recordId = requiredStr(args, 'recordId')
  if (isErr(recordId)) return recordId
  const stage = requiredStr(args, 'stage')
  if (isErr(stage)) return stage
  const confirmed = args.confirmed === true

  const summary = `Nakit yardımı müracaatı (kayıt no ${recordId}) aşaması "${stage}" olarak güncellenecek.`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY KAYDEDİLMEDİ.' }
  }

  // Kullanici istegi (15 Eylul 2026, 45. tur): "yardımı buluyor, güncelle
  // dediğimde kayıt bulunamadı hatası veriyor" - KOK NEDEN: /api/documents/
  // nakit-asama SADECE henuz karara baglanmamis (durumu=0) kayitlarda
  // calisir (bkz. route.ts "WHERE durumu = 0"); kullanici zaten AKTIF bir
  // "yardım" (durumu != 0) kaydinin asamasini degistirmek isterse bu uc
  // nokta SESSIZCE 0 satir gunceller, "bulunamadi" hatasi olarak goruluyordu.
  // ARTIK: once HIZLI/DAR yol denenir (cogu durumda budur), basarisiz olursa
  // VAZGECILMEZ - GENEL (durumu kisidi olmayan) PATCH /api/documents/
  // applications yoluna dusulur - boylece kullanici hangi durumda oldugunu
  // bilmese/soylemese bile islem HER HALUKARDA tamamlanir.
  const quickResult = await callInternalApi('/api/documents/nakit-asama', 'PATCH', {
    updates: [{ id: recordId, asama: stage }],
  }, ctx.cookieHeader)

  if (quickResult.success) {
    return { success: true, message: 'Müracaat aşaması güncellendi.' }
  }

  let current: ApplicationCurrentValues | null
  try {
    current = await loadCurrentApplicationForSafeMerge('yrd_ayninakti', recordId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : quickResult.error ?? 'Aşama güncellenemedi.' }
  }
  if (!current) return { error: `Id'si ${recordId} olan bir Nakit Yardımı kaydı bulunamadı.` }

  const fallbackResult = await callInternalApi('/api/documents/applications', 'PATCH', {
    recordId,
    fileId: current.fileId,
    sourceTable: 'yrd_ayninakti',
    applicantName: current.applicantName,
    identityNumber: current.identityNumber,
    phone: current.phone,
    date: current.date,
    period: current.period,
    description: current.description,
    amount: current.amount,
    iban: current.iban,
    label: current.label,
    stageStatus: stage,
  }, ctx.cookieHeader)

  if (!fallbackResult.success) return { error: fallbackResult.error }
  return { success: true, message: 'Müracaat aşaması güncellendi.' }
}

// --- 6) Nakit yardımı müracaatını iptal etme (durumu=1, kalıcı silme DEĞİL) ---

export async function executeCancelNakitApplication(args: Record<string, unknown>, ctx: WriteToolContext) {
  const recordId = requiredStr(args, 'recordId')
  if (isErr(recordId)) return recordId
  const reason = requiredStr(args, 'reason')
  if (isErr(reason)) return reason
  const confirmed = args.confirmed === true

  const summary = `Nakit yardımı müracaatı (kayıt no ${recordId}) İPTAL EDİLECEK. Neden: "${reason}". (Not: kayıt kalıcı olarak silinmez, "İptal Edildi" durumuna alınır.)`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY YAPILMADI.' }
  }

  const result = await callInternalApi('/api/requests/nakit/cancel', 'PATCH', {
    id: recordId,
    cancelDate: new Date().toISOString().slice(0, 10),
    cancelReason: reason,
  }, ctx.cookieHeader)

  if (!result.success) return { error: result.error }
  return { success: true, message: 'Müracaat iptal edildi.' }
}

// --- 7) İptal edilmiş bir nakit yardımı müracaatını GERİ ALMA (durumu=1 -> 0) ---

export async function executeRestoreNakitApplication(args: Record<string, unknown>, ctx: WriteToolContext) {
  const recordId = requiredStr(args, 'recordId')
  if (isErr(recordId)) return recordId
  const confirmed = args.confirmed === true

  const summary = `Nakit yardımı müracaatı (kayıt no ${recordId}) GERİ ALINACAK - iptal durumu kaldırılıp "Yeni Müracaat" durumuna döndürülecek.`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY YAPILMADI.' }
  }

  const result = await callInternalApi('/api/assistance/nakit/bulk-update', 'PATCH', {
    mode: 'selected',
    ids: [recordId],
    changes: { durumu: 0 },
  }, ctx.cookieHeader)

  if (!result.success) return { error: result.error }
  return { success: true, message: 'Müracaat geri alındı (iptal durumu kaldırıldı).' }
}

// --- 8) Nakit yardımı müracaatını KALICI OLARAK SİLME (gerçek DELETE -
//     yrd_ayninakti kaydı, dosyanın/hanenin KENDİSİNE ASLA DOKUNMAZ) ---

export async function executeDeleteNakitApplication(args: Record<string, unknown>, ctx: WriteToolContext) {
  const recordId = requiredStr(args, 'recordId')
  if (isErr(recordId)) return recordId
  const confirmed = args.confirmed === true

  const summary = `Nakit yardımı müracaatı (kayıt no ${recordId}) KALICI OLARAK SİLİNECEK. Bu işlem GERİ ALINAMAZ (iptal ile aynı şey değildir).`
  if (!confirmed) {
    return { requiresConfirmation: true, summary, note: 'Bu bir ÖNİZLEMEDİR, HENÜZ HİÇBİR ŞEY SİLİNMEDİ.' }
  }

  const result = await callInternalApi(`/api/assistance/${encodeURIComponent(recordId)}`, 'DELETE', {}, ctx.cookieHeader)

  if (!result.success) return { error: result.error }
  return { success: true, message: 'Müracaat kalıcı olarak silindi.' }
}
