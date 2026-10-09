import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { createAssistancePeriod } from '@/lib/services/assistancePeriod.service'
import { resolveCashPredefinedLabels } from '@/lib/services/cashPredefinedLabels.service'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { findConflictingAssistPersonTcs } from '@/lib/services/assistPersonTc.service'
import { isValidTcKimlikNo } from '@/lib/utils/tcKimlikNo'
import { normalizeTrPhoneOrNull } from '@/lib/phone'

export const dynamic = 'force-dynamic'

type ApplicationPayload = {
  recordId?: string
  sourceTable?: string
  fileId?: string
  type?: string
  applicantName?: string
  identityNumber?: string
  phone?: string
  date?: string
  period?: string
  startDate?: string
  endDate?: string
  amount?: string
  breakfastAmount?: string
  description?: string
  iban?: string
  householdIncome?: string
  applicantBirthDate?: string
  propertyInfo?: string
  vehicleInfo?: string
  label?: string
  specialCode?: string
  stageStatus?: string
  stageDescription?: string
  stageCode?: string
  // Kullanici istegi: "Otomatik Red İptal" tiki - SADECE Ayni/Nakdi (yrd_
  // ayninakti) icin anlamli. Isaretliyse bu muracaat Otomatik Red kontrolune
  // bir daha HIC dahil edilmez, kullanicinin elle sectigi Durumu/Asama
  // degeri OLDUGU GIBI kalir (bkz. lib/services/cashAutoReject.service.ts).
  otomatikRedIptal?: boolean
  // Kullanici istegi: "Yardım Kişi Sayısı" alaninda girilen TC kimlik
  // no'lari "-" ile birlestirilmis halde - SADECE Ayni/Nakdi (yrd_ayninakti)
  // icin anlamli (bkz. yrd_ayninakti.yardimkisitc).
  assistPersonTcList?: string
  // Kullanici istegi: "Yardım Kişi Sayısı" alaninin KENDISI - SADECE
  // Ayni/Nakdi icin anlamli (bkz. yrd_ayninakti.yardimkisisayisi).
  assistPersonCount?: string
}

const APPLICATION_TYPES: Record<string, string> = {
  Ekmek: 'yrd_ekmek',
  'Gıda Bankası': 'yrd_gidabankasi',
  'Destek Paketi': 'yrd_destekpaketi',
  'Hazır Yemek': 'yrd_haziryemek',
  Giyim: 'yrd_giyim',
  'Dönem Dışı Gıda': 'yrd_ddgidadosyali',
  'Ayni/Nakdi': 'yrd_ayninakti',
}

const APPLICATION_TABLES = new Set(Object.values(APPLICATION_TYPES))
let readyMealBreakfastColumnPromise: Promise<void> | null = null

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Kullanici istegi (Eylul 2026): muracaat telefonlari HER ZAMAN tek "0" ile
// baslar, aralarinda bosluk/ozel karakter olmaz (bkz. lib/phone.ts).
function cleanPhone(value: unknown) {
  return normalizeTrPhoneOrNull(cleanText(value))
}

function cleanDate(value: unknown) {
  const text = cleanText(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function cleanInt(value: unknown) {
  const text = cleanText(value)
  if (!text) return null
  const normalized = Number(text.replace(',', '.'))
  return Number.isFinite(normalized) ? Math.trunc(normalized) : null
}

function cleanBigInt(value: unknown) {
  const text = cleanText(value)
  return text && /^\d+$/.test(text) ? BigInt(text) : null
}

function cleanSourceTable(value: unknown) {
  const tableName = cleanText(value) ?? ''
  return APPLICATION_TABLES.has(tableName) ? tableName : ''
}

function getDatabaseErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return ''
  const directCode = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const metaCode =
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    'code' in error.meta &&
    typeof error.meta.code === 'string'
      ? error.meta.code
      : ''
  return directCode || metaCode
}

function isMissingColumnError(error: unknown) {
  const code = getDatabaseErrorCode(error)
  const message = error instanceof Error ? error.message.toLocaleLowerCase('tr-TR') : ''
  return code === '42703' || message.includes('column') && message.includes('does not exist')
}

async function ensureReadyMealBreakfastColumn() {
  if (!readyMealBreakfastColumnPromise) {
    readyMealBreakfastColumnPromise = (async () => {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'yrd_haziryemek'
          AND column_name = 'kahvaltimiktari'
      `

      if (columns.length === 0) {
        await prisma.$executeRawUnsafe('ALTER TABLE yrd_haziryemek ADD COLUMN kahvaltimiktari integer')
      }
    })().catch((error) => {
      readyMealBreakfastColumnPromise = null
      throw error
    })
  }

  await readyMealBreakfastColumnPromise
}

async function getCurrentUserId() {
  const user = await userService.getCurrent()
  const userId = user?.id ? Number(user.id) : null

  return Number.isInteger(userId) ? userId : null
}

const ASSISTANCE_TYPE_LABELS: Record<string, string> = {
  yrd_ekmek: 'Ekmek Yardımı',
  yrd_gidabankasi: 'Gıda Bankası Yardımı',
  yrd_destekpaketi: 'Destek Paketi',
  yrd_haziryemek: 'Hazır Yemek Yardımı',
  yrd_giyim: 'Giyim Yardımı',
  yrd_ddgidadosyali: 'Dönem Dışı Gıda Yardımı',
  yrd_ayninakti: 'Ayni/Nakdi Yardım',
}

// Kullanici istegi: bir dosyada AYNI yardim turunden yeni bir muracaat/yardim
// kaydi acilip acilamayacagi, yardim turune gore UC FARKLI kurala tabi:
//
// 1) GIYIM / DONEM DISI GIDA (yrd_giyim, yrd_ddgidadosyali): sadece HALEN
//    BEKLEYEN (durumu = 0, yani daha once acilmis ama henuz yardima
//    donusturulmemis/sonuclanmamis) bir kayit VARSA yeni acilis engellenir.
//    Onceki kayit zaten sonuclanmissa (durumu != 0 - yardima donusmus,
//    iptal edilmis, tamamlanmis vb.) o dosyada YENIDEN bir muracaat
//    acilabilir.
const REOPENABLE_AFTER_RESOLVED_TABLES = new Set(['yrd_giyim', 'yrd_ddgidadosyali'])

// 3) EKMEK / GIDA BANKASI / DESTEK PAKETI / HAZIR YEMEK: durumu NE OLURSA
//    OLSUN (bekleyen/aktif/iptal/tamamlanmis farketmeksizin) dosyada bu
//    turden HERHANGI BIR kayit varsa, ayni turden ikinci bir muracaat/yardim
//    BIR DAHA ASLA acilamaz - bu turlerin "donem" kavrami olmadigi icin
//    (Ayni/Nakdi'nin aksine) dosya basina EN FAZLA BIR kayit olabilir.
const ALWAYS_BLOCK_DUPLICATE_TABLES = new Set(['yrd_ekmek', 'yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_haziryemek'])

// 2) AYNI/NAKDI (yrd_ayninakti): diger yardim turlerinden farkli olarak bir
//    "donem" (periyodik odeme donemi) kavrami vardir - ayni dosyada FARKLI
//    donemler icin ayri ayri muracaat acilabilmesi gerekir. Kullanici istegi:
//    dosyadaki AYNI KISI (muracaateden) icin, AYNI donem icin, durumu NE
//    OLURSA OLSUN (bekleyen bir muracaat bile olsa) ikinci bir kayit
//    acilmasi mukerrer sayilir - FARKLI bir kisi (ayni dosya/hanedeki baska
//    bir birey) ayni donem icin KENDI muracaatini acabilir, bu engellenmez.
//
//    ONEMLI DUZELTME 1: "donem" parametresi burada HAM (kullanicinin secip
//    gonderdigi kod/deger) DEGIL, tam olarak veritabanina YAZILACAK/YAZILMIS
//    olan COZUMLENMIS/etiketlenmis deger (bkz. POST - resolveCashPredefinedLabels
//    sonucu cashLabels.period) OLMALIDIR - cunku donem sutununa HAM deger
//    degil bu cozumlenmis deger kaydediliyor; ham deger ile karsilastirma
//    (ilk surum) neredeyse HICBIR ZAMAN eslesmiyordu, bu yuzden mukerrer
//    kayitlar sessizce olusturulabiliyordu.
//
//    ONEMLI DUZELTME 2 (canli veri incelenerek bulundu): "donem" alani
//    GERCEKTE bazen TEK BIR ay/odeme DEGIL, GENIS bir PROGRAM/kategori adi
//    tasiyor - ör. "2025 EMEKLİ YARDIMI" donemi altinda Ocak'tan Aralik'a
//    kadar 12 AYRI kayit var, her biri "etiket" alaniyla ("01 OCAK ÖDEME",
//    "02 ŞUBAT ÖDEME" ...) ayrisiyor. Sadece "donem" karsilastirmasi bu
//    MESRU aylik odeme akisini yanlislikla engellerdi. Bu yuzden kontrol
//    "donem" ILE "etiket" IKILISINE gore yapilir - ikisi BIRLIKTE ayni ise
//    (ayni ay/odeme icin) mukerrer sayilir, sadece donem ayniyken etiket
//    FARKLIYSA (farkli ay/odeme) engellenmez. Canli veride tam olarak bu
//    ikiliyle (donem+etiket+kisi+dosya) eslesen GERCEK bir mukerrer kayit
//    da bulunup dogrulandi.
async function findPreviouslyOpenedAssistance(
  tableName: string,
  fileId: bigint,
  applicantName: string,
  period?: string | null,
  label?: string | null,
) {
  if (tableName === 'yrd_ayninakti') {
    const normalizedPeriod = (period ?? '').trim()
    const normalizedLabel = (label ?? '').trim()
    const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
      `SELECT id FROM yrd_ayninakti
       WHERE dosyaid = $1::bigint
         AND TRIM(COALESCE(muracaateden, '')) = TRIM($2::text)
         AND COALESCE(NULLIF(TRIM(donem), ''), '') = $3::text
         AND COALESCE(NULLIF(TRIM(etiket), ''), '') = $4::text
       LIMIT 1`,
      fileId.toString(),
      applicantName,
      normalizedPeriod,
      normalizedLabel,
    )
    return rows.length > 0
  }

  if (REOPENABLE_AFTER_RESOLVED_TABLES.has(tableName)) {
    const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
      `SELECT id FROM ${tableName} WHERE dosyaid = $1::bigint AND durumu = 0 LIMIT 1`,
      fileId.toString(),
    )
    return rows.length > 0
  }

  // ALWAYS_BLOCK_DUPLICATE_TABLES (Ekmek/Gıda Bankası/Destek Paketi/Hazır
  // Yemek) buraya duser - tanimlanmamis/beklenmeyen bir tablo gelirse de
  // (APPLICATION_TYPES disinda, olmamasi gereken bir durum) GUVENLI TARAFTA
  // kalinip ayni sekilde (durum filtresiz, HERHANGI bir kayit varsa engelle)
  // davranilir.
  if (!ALWAYS_BLOCK_DUPLICATE_TABLES.has(tableName)) {
    console.warn(`[applications] Bilinmeyen yardim turu icin mukerrer kontrolu varsayilan (durum filtresiz) davranisla calisiyor: ${tableName}`)
  }
  const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
    `SELECT id FROM ${tableName} WHERE dosyaid = $1::bigint LIMIT 1`,
    fileId.toString(),
  )
  return rows.length > 0
}

function formatDateOnly(date?: Date | string | null) {
  if (!date) return '-'
  const parsed = date instanceof Date ? date : new Date(date)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString('tr-TR')
}

// Kullanici istegi: "Yardım Kişileri (TC)" alaninda girilen TC'ler (a) resmi
// TC kimlik no kontrol basamagi algoritmasina uymalidir - sadece 11 haneli
// olmasi YETERLI DEGIL (bkz. lib/utils/tcKimlikNo.ts) VE (b) HER TC ICIN EN
// FAZLA 1 nakit yardimi yapilabilir - HALEN BEKLEYEN (durumu = 0) BASKA bir
// muracaatta zaten kayitli bir TC varsa kaydetme/guncelleme REDDEDILIR. Bu
// kontrol istemci tarafinda da yapilir (bkz. documents/page.tsx -
// handleSaveApplication) ama BURADA TEKRAR yapilmasi sarttir - istemci
// tarafi atlatilabilir/gecersiz kilinabilir (ör. API dogrudan cagrilirsa),
// veri butunlugu SADECE sunucu tarafinda garanti edilebilir.
async function validateAssistPersonTcList(
  rawList: string | null | undefined,
  excludeRecordId: string | null,
): Promise<string | null> {
  const text = (rawList ?? '').trim()
  if (!text) return null

  const tcs = text.split('-').map((tc) => tc.trim()).filter(Boolean)
  const invalidTc = tcs.find((tc) => !isValidTcKimlikNo(tc))
  if (invalidTc) {
    return `"${invalidTc}" geçerli bir TC Kimlik No değil.`
  }

  const conflicts = await findConflictingAssistPersonTcs(tcs, excludeRecordId)
  if (conflicts.length > 0) {
    const details = conflicts.map((c) => `${c.tc} - Dosya No: ${c.dosyaNo} (${c.applicantName})`).join('; ')
    return `Her TC kimlik no için en fazla 1 nakit yardımı yapılabilir. Şu TC(ler) halen beklemede olan başka bir müracaatta zaten kayıtlı: ${details}`
  }

  return null
}

// Kullanici istegi: Yardım Hareketleri penceresindeki AYNİ/NAKDİ listesinde
// (bkz. documents/page.tsx - "Yardım Hareketleri" modali) bir kayda cift
// tiklandiginda, o kaydin muracaat formu bilgisini (durumu ne olursa olsun -
// odenmis/iptal/beklemede farketmeksizin) SALT OKUNUR gostermek icin
// kullanilir. Mevcut "applications" listesi (bkz. app/api/documents/
// fetch/route.ts) SADECE durumu=0 (henuz sonuclanmamis) kayitlari
// dondurdugunden, cozumlenmis (odenmis/iptal edilmis) kayitlar icin ayri bir
// tekil-kayit sorgusu gerekiyordu - bu route o ihtiyaci karsilar, "Müracaat
// Düzenle" modalinin zaten bekledigi ApplicationRow bicimiyle birebir ayni
// sekilde doner (bkz. openEditApplicationModal).
export async function GET(request: Request) {
  try {
    // Salt-goruntuleme rotasi - sadece sayfa erisimi yeterlidir, ayrica bir
    // islem yetkisi gerekmez (guncelleme ise ayri sekilde requests.update
    // yetkisiyle PATCH ucunda kisitlanir, bkz. documents/page.tsx).
    const accessDenied = await requireApiAccess({ page: '/documents' })
    if (accessDenied) return accessDenied

    const { searchParams } = new URL(request.url)
    const id = cleanBigInt(searchParams.get('id'))
    const fileId = cleanBigInt(searchParams.get('fileId'))

    if (!id || !fileId) {
      return NextResponse.json({ success: false, error: 'Kayıt id ve dosya id zorunludur.' }, { status: 400 })
    }

    const rows = await prisma.$queryRaw<{
      record_id: bigint
      durumu: number | null
      muracaateden: string | null
      tckimlikno: string | null
      ceptel: string | null
      muracaattarihi: Date | null
      miktar: string | null
      asama: string | null
      donem: string | null
      etiket: string | null
      aciklama: string | null
      mulkiyet_bilgisi: string | null
      arac_bilgisi: string | null
      iban: string | null
      aylik_gelir: string | null
      dogum_tarihi: Date | null
      otomatikrediptal: boolean | null
      yardim_kisi_tc: string | null
      yardim_kisi_sayisi: number | null
    }[]>`
      SELECT
        t.id::bigint AS record_id,
        t.durumu,
        t.muracaateden,
        COALESCE(t.tckimlikno, b.tckimlikno) AS tckimlikno,
        COALESCE(t.ceptel, b.ceptel) AS ceptel,
        t.muracaattarihi,
        t.miktar::text AS miktar,
        t.asama::text AS asama,
        t.donem::text AS donem,
        t.etiket::text AS etiket,
        -- bkz. app/api/documents/fetch/route.ts'teki ayni duzeltme notu -
        -- SADECE muracaatnotu okunur (bos ise aciklama da bos gorunur,
        -- ilgisiz asamanotu/durumuaciklama'ya DUSULMEZ).
        NULLIF(t.muracaatnotu, '')::text AS aciklama,
        t.mulkiyetbilgisi::text AS mulkiyet_bilgisi,
        t.aracbilgisi::text AS arac_bilgisi,
        t.iban::text AS iban,
        t.aylikgelir::text AS aylik_gelir,
        t.dogumtarihi::date AS dogum_tarihi,
        t.otomatikrediptal,
        t.yardimkisitc::text AS yardim_kisi_tc,
        t.yardimkisisayisi AS yardim_kisi_sayisi
      FROM yrd_ayninakti t
      LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
      WHERE t.id = ${id} AND t.dosyaid = ${fileId}
      LIMIT 1
    `

    const row = rows[0]
    if (!row) {
      return NextResponse.json({ success: false, error: 'Müracaat kaydı bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        recordId: row.record_id.toString(),
        sourceTable: 'yrd_ayninakti',
        no: row.record_id.toString(),
        type: 'Ayni/Nakdi',
        identityNumber: row.tckimlikno || '-',
        fullName: row.muracaateden || '-',
        phone: row.ceptel || '-',
        stage: row.asama || '-',
        period: row.donem || '-',
        label: row.etiket || '-',
        applicationDate: formatDateOnly(row.muracaattarihi),
        status: String(row.durumu ?? ''),
        amount: row.miktar || '-',
        propertyInfo: row.mulkiyet_bilgisi || '',
        vehicleInfo: row.arac_bilgisi || '',
        iban: row.iban || '',
        householdIncome: row.aylik_gelir || '',
        applicantBirthDate: formatDateOnly(row.dogum_tarihi),
        description: row.aciklama || '-',
        approvalStatus: 'none',
        approvalRequestId: null,
        otomatikRedIptal: Boolean(row.otomatikrediptal),
        assistPersonTcList: row.yardim_kisi_tc || '',
        assistPersonCount: row.yardim_kisi_sayisi !== null ? String(row.yardim_kisi_sayisi) : '',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Müracaat kaydı alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.create', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = (await request.json()) as ApplicationPayload
    const fileId = cleanBigInt(body.fileId)
    const tableName = body.type ? APPLICATION_TYPES[body.type] : ''
    const applicantName = cleanText(body.applicantName)
    const applicationDate = cleanDate(body.date) ?? new Date()
    const amount = cleanInt(body.amount)
    const breakfastAmount = cleanInt(body.breakfastAmount)
    const description = cleanText(body.description)
    const period = cleanText(body.period)
    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = cleanDate(body.endDate)
    const label = cleanText(body.label)

    if (!fileId || !tableName || !applicantName) {
      return NextResponse.json(
        { success: false, error: 'Dosya, müracaat türü ve müracaat eden bilgisi zorunludur.' },
        { status: 400 },
      )
    }

    if (tableName === 'yrd_ayninakti') {
      const tcError = await validateAssistPersonTcList(body.assistPersonTcList, null)
      if (tcError) {
        return NextResponse.json({ success: false, error: tcError }, { status: 400 })
      }
    }

    // Ayni/Nakdi icin donem sutununa HAM "period" degil, COZUMLENMIS/etiketli
    // deger (cashLabels.period) yazilir (bkz. asagidaki INSERT) - mukerrer
    // kontrolu de AYNI cozumlenmis degerle yapilmalidir, aksi halde ham
    // deger hicbir zaman esleşmez ve kontrol etkisiz kalir (bkz. yukarida
    // findPreviouslyOpenedAssistance yorumu). Bu yuzden Ayni/Nakdi icin
    // cozumleme burada, kontrolden ONCE yapilir ve asagida (INSERT
    // sirasinda) TEKRAR cozumlenmez, ayni sonuc yeniden kullanilir.
    const cashLabels = tableName === 'yrd_ayninakti'
      ? await resolveCashPredefinedLabels(period, label, cleanText(body.stageStatus))
      : null

    if (await findPreviouslyOpenedAssistance(tableName, fileId, applicantName, cashLabels?.period ?? period, cashLabels?.label ?? label)) {
      const typeLabel = ASSISTANCE_TYPE_LABELS[tableName] || 'Bu yardım'
      const periodNote = tableName === 'yrd_ayninakti' ? ' Aynı kişi için aynı dönem/etikette tekrar açılamaz - farklı bir dönem veya etiket seçerek devam edebilirsiniz.' : ''
      return NextResponse.json(
        { success: false, error: `Bu dosyada daha önce açılmış bir ${typeLabel} kaydı var. Aynı yardım türü (aktif veya pasif) bir dosyada birden fazla açılamaz.${periodNote}` },
        { status: 409 },
      )
    }

    const rows = await withAuditedWrite(async (tx) => {
      if (tableName === 'yrd_ayninakti') {
        return tx.$queryRaw<{ id: string; sourceTable: string }[]>`
          INSERT INTO yrd_ayninakti (
            dosyaid, muracaateden, tckimlikno, ceptel, muracaattarihi, muracaatnotu,
            miktar, durumu, durumutarih, donem, iban, aylikgelir, etiket, dogumtarihi,
            mulkiyetbilgisi, aracbilgisi, muracaatozelkod, asama, asamanotu, asamaozelkod,
            yardimkisitc, yardimkisisayisi, ilkislemtarihi, islemtarihi
          )
          VALUES (
            ${fileId}, ${applicantName}, ${cleanText(body.identityNumber)}, ${cleanPhone(body.phone)}, ${applicationDate}, ${description},
            ${amount}, 0, ${applicationDate}, ${cashLabels!.period}, ${cleanText(body.iban)}, ${cleanInt(body.householdIncome)}, ${cashLabels!.label}, ${cleanDate(body.applicantBirthDate)},
            ${cleanText(body.propertyInfo)}, ${cleanText(body.vehicleInfo)}, ${cleanText(body.specialCode)}, ${cashLabels!.stage}, ${cleanText(body.stageDescription)}, ${cleanText(body.stageCode)},
            ${cleanText(body.assistPersonTcList)}, ${cleanInt(body.assistPersonCount)}, NOW(), NOW()
          )
          RETURNING id::text AS "id", 'yrd_ayninakti'::text AS "sourceTable"
        `
      }

      if (tableName === 'yrd_ddgidadosyali') {
        // Kullanici istegi (28 Agustos 2026): Donem Disi Gida muracaati
        // olusturulurken ODEME BITIS tarihi (bittarih) BELIRLENMESIN -
        // sadece muracaat kaydi olusur, odeme yapilinca islenir.
        return tx.$queryRaw<{ id: string; sourceTable: string }[]>`
          INSERT INTO yrd_ddgidadosyali (
            dosyaid, muracaateden, nedeni, muracaattarihi, miktar, aciklama,
            durumu, durumutarih, ilkislemtarihi, islemtarihi
          )
          VALUES (
            ${fileId}, ${applicantName}, ${period}, ${applicationDate}, ${amount}, ${description},
            0, ${applicationDate}, NOW(), NOW()
          )
          RETURNING id::text AS "id", 'yrd_ddgidadosyali'::text AS "sourceTable"
        `
      }

      if (tableName === 'yrd_giyim') {
        return tx.$queryRaw<{ id: string; sourceTable: string }[]>`
          INSERT INTO yrd_giyim (
            dosyaid, muracaateden, muracaattarihi, muracaataciklama, aciklama,
            durumu, durumutarih, miktar, donem, etiket, ilkislemtarihi, islemtarihi
          )
          VALUES (
            ${fileId}, ${applicantName}, ${applicationDate}, ${description}, ${description},
            0, ${applicationDate}, ${amount}, ${period}, ${label}, NOW(), NOW()
          )
          RETURNING id::text AS "id", 'yrd_giyim'::text AS "sourceTable"
        `
      }

      if (tableName === 'yrd_destekpaketi') {
        const currentUserId = await getCurrentUserId()
        const createdRows = await tx.$queryRaw<{ id: string; sourceTable: string }[]>`
          INSERT INTO yrd_destekpaketi (
            dosyaid, muracaateden, muracaattarihi, muracaataciklama,
            bastarih, bittarih, miktar, aciklama, durumu, durumutarih, donem,
            ilkislemtarihi, islemtarihi
          )
          VALUES (
            ${fileId}, ${applicantName}, ${applicationDate}, ${description},
            ${startDate}, ${endDate}, ${amount}, ${description}, 0, ${applicationDate}, ${period},
            NOW(), NOW()
          )
          RETURNING id::text AS "id", 'yrd_destekpaketi'::text AS "sourceTable"
        `
        const createdRow = createdRows[0]

        if (createdRow) {
          await tx.$executeRaw`
            INSERT INTO yrd_destekpaketihrk (
              kullaniciid, dosyaid, yardimid, islemadi, aciklama, miktar, islemtarihi
            )
            VALUES (
              ${currentUserId}, ${fileId}, ${BigInt(createdRow.id)}, ${'Yardım Başladı'}, ${"''"}, ${amount}, ${applicationDate}
            )
          `

          await createAssistancePeriod({
            db: tx,
            sourceTable: 'yrd_destekpaketi',
            recordId: BigInt(createdRow.id),
            fileId,
            currentUserId,
            periodDate: applicationDate,
          })
        }

        return createdRows
      }

      if (tableName === 'yrd_haziryemek') {
        await ensureReadyMealBreakfastColumn()
        return tx.$queryRaw<{ id: string; sourceTable: string }[]>`
          INSERT INTO yrd_haziryemek (
            dosyaid, muracaateden, muracaattarihi, muracaataciklama, sureturu,
            bastarih, bittarih, miktar, kisisayisi, kahvaltimiktari, aciklama,
            durumu, durumutarih, donem, etiket, ilkislemtarihi, islemtarihi
          )
          VALUES (
            ${fileId}, ${applicantName}, ${applicationDate}, ${description}, 0,
            ${startDate}, ${endDate}, ${amount}, ${amount}, ${breakfastAmount}, ${description},
            0, ${applicationDate}, ${period}, ${label}, NOW(), NOW()
          )
          RETURNING id::text AS "id", 'yrd_haziryemek'::text AS "sourceTable"
        `
      }

      if (tableName === 'yrd_gidabankasi') {
        const currentUserId = await getCurrentUserId()
        const createdRows = await tx.$queryRawUnsafe<{ id: string; sourceTable: string }[]>(
          `
            INSERT INTO yrd_gidabankasi (
              dosyaid, muracaateden, muracaattarihi, muracaataciklama, sureturu,
              bastarih, bittarih, miktar, aciklama, durumu, durumutarih, donem,
              etiket, ilkislemtarihi, islemtarihi
            )
            VALUES (
              $1::bigint, $2::text, $3::date, $4::text, 0,
              $5::date, $6::date, $7::int, $8::text, 0, $3::date, $9::text,
              $10::text, NOW(), NOW()
            )
            RETURNING id::text AS "id", 'yrd_gidabankasi'::text AS "sourceTable"
          `,
          fileId.toString(),
          applicantName,
          applicationDate.toISOString().slice(0, 10),
          description,
          startDate ? startDate.toISOString().slice(0, 10) : null,
          endDate ? endDate.toISOString().slice(0, 10) : null,
          amount,
          description,
          period,
          label,
        )
        const createdRow = createdRows[0]

        if (createdRow) {
          await tx.$executeRaw`
            INSERT INTO yrd_gidabankasihrk (
              kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar
            )
            VALUES (
              ${currentUserId}, NOW(), ${fileId}, ${BigInt(createdRow.id)}, ${'İlk Kayıt'}, ${"''"}, ${amount}
            )
          `

          await createAssistancePeriod({
            db: tx,
            sourceTable: 'yrd_gidabankasi',
            recordId: BigInt(createdRow.id),
            fileId,
            currentUserId,
            periodDate: applicationDate,
          })
        }

        return createdRows
      }

      return tx.$queryRawUnsafe<{ id: string; sourceTable: string }[]>(
        `
          INSERT INTO ${tableName} (
            dosyaid, muracaateden, muracaattarihi, muracaataciklama, sureturu,
            bastarih, bittarih, miktar, aciklama, durumu, durumutarih, donem,
            etiket, ilkislemtarihi, islemtarihi
          )
          VALUES (
            $1::bigint, $2::text, $3::date, $4::text, 0,
            $5::date, $6::date, $7::int, $8::text, 0, $3::date, $9::text,
            $10::text, NOW(), NOW()
          )
          RETURNING id::text AS "id", '${tableName}'::text AS "sourceTable"
        `,
        fileId.toString(),
        applicantName,
        applicationDate.toISOString().slice(0, 10),
        description,
        startDate ? startDate.toISOString().slice(0, 10) : null,
        endDate ? endDate.toISOString().slice(0, 10) : null,
        amount,
        description,
        period,
        label,
      )
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
  } catch (error) {
    console.error('Application create error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Müracaat kaydı eklenemedi.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = (await request.json()) as ApplicationPayload
    const recordId = cleanBigInt(body.recordId)
    const fileId = cleanBigInt(body.fileId)
    const tableName = cleanSourceTable(body.sourceTable)
    const applicantName = cleanText(body.applicantName)
    const applicationDate = cleanDate(body.date) ?? new Date()
    const amount = cleanInt(body.amount)
    const breakfastAmount = cleanInt(body.breakfastAmount)
    const description = cleanText(body.description)
    const period = cleanText(body.period)
    const startDate = cleanDate(body.startDate)
    const endDate = cleanDate(body.endDate)
    const label = cleanText(body.label)

    if (!recordId || !fileId || !tableName || !applicantName) {
      return NextResponse.json(
        { success: false, error: 'Kayıt, dosya, tablo ve müracaat eden bilgisi zorunludur.' },
        { status: 400 },
      )
    }

    if (tableName === 'yrd_ayninakti') {
      const tcError = await validateAssistPersonTcList(body.assistPersonTcList, recordId.toString())
      if (tcError) {
        return NextResponse.json({ success: false, error: tcError }, { status: 400 })
      }
    }

    const updatedCount = await withAuditedWrite(async (tx) => {
      if (tableName === 'yrd_ayninakti') {
        const cashLabels = await resolveCashPredefinedLabels(period, label, cleanText(body.stageStatus))
        const cashRecordRows = await tx.$queryRaw<{ asamaozelkod: string | null }[]>`
          SELECT asamaozelkod
          FROM yrd_ayninakti
          WHERE id = ${recordId} AND dosyaid = ${fileId}
          LIMIT 1
        `

        // Kullanici istegi (bkz. Nakit Yardimi Muracaat Duzenle penceresi):
        // bu UPDATE, yukaridaki INSERT (POST) ile AYNI alan setini
        // kapsamalidir - eskiden sadece donem/etiket/aciklama/mulkiyet/
        // arac/asama guncelleniyordu, telefon (ceptel), IBAN, aylik gelir,
        // muracaat tarihi, miktar, dogum tarihi, muracaat eden/TC ve asama
        // notlari SESSIZCE guncellenmiyordu - kullanici formda degistirip
        // "Guncelle" dese bile bu alanlar eski haliyle kaliyordu.
        const cashUpdatedCount = await tx.$executeRaw`
          UPDATE yrd_ayninakti
          SET muracaateden = ${applicantName},
              tckimlikno = ${cleanText(body.identityNumber)},
              ceptel = ${cleanPhone(body.phone)},
              muracaattarihi = ${applicationDate},
              muracaatnotu = ${description},
              miktar = ${amount},
              donem = ${cashLabels.period},
              iban = ${cleanText(body.iban)},
              aylikgelir = ${cleanInt(body.householdIncome)},
              etiket = ${cashLabels.label},
              dogumtarihi = ${cleanDate(body.applicantBirthDate)},
              mulkiyetbilgisi = ${cleanText(body.propertyInfo)},
              aracbilgisi = ${cleanText(body.vehicleInfo)},
              muracaatozelkod = ${cleanText(body.specialCode)},
              asama = ${cashLabels.stage},
              asamanotu = ${cleanText(body.stageDescription)},
              asamaozelkod = ${cleanText(body.stageCode)},
              otomatikrediptal = ${Boolean(body.otomatikRedIptal)},
              yardimkisitc = ${cleanText(body.assistPersonTcList)},
              yardimkisisayisi = ${cleanInt(body.assistPersonCount)},
              islemtarihi = NOW()
          WHERE id = ${recordId} AND dosyaid = ${fileId}
        `

        const onlineId = cashRecordRows[0]?.asamaozelkod?.match(/^ONLINE:(\d+)$/)?.[1]
        if (cashUpdatedCount > 0 && onlineId && description) {
          await tx.$executeRaw`
            UPDATE online_basvurular
            SET aciklama = ${description}
            WHERE id = ${BigInt(onlineId)}
          `
        }

        return cashUpdatedCount
      }

      if (tableName === 'yrd_ddgidadosyali') {
        // Kullanici istegi (28 Agustos 2026): Donem Disi Gida'da odeme
        // bitis tarihi (bittarih) elle/otomatik BELIRLENMEZ - guncellemede
        // de yazilmaz.
        return tx.$executeRaw`
          UPDATE yrd_ddgidadosyali
          SET muracaateden = ${applicantName},
              nedeni = ${period},
              muracaattarihi = ${applicationDate},
              miktar = ${amount},
              aciklama = ${description},
              islemtarihi = NOW()
          WHERE id = ${recordId} AND dosyaid = ${fileId}
        `
      }

      if (tableName === 'yrd_giyim') {
        try {
          return await tx.$executeRaw`
            UPDATE yrd_giyim
            SET muracaateden = ${applicantName},
                muracaattarihi = ${applicationDate},
                muracaataciklama = ${description},
                aciklama = ${description},
                miktar = ${amount},
                donem = ${period},
                etiket = ${label},
                islemtarihi = NOW()
            WHERE id = ${recordId} AND dosyaid = ${fileId}
          `
        } catch (error) {
          if (!isMissingColumnError(error)) {
            throw error
          }

          try {
            return await tx.$executeRaw`
              UPDATE yrd_giyim
              SET muracaateden = ${applicantName},
                  muracaattarihi = ${applicationDate},
                  aciklama = ${description},
                  miktar = ${amount},
                  donem = ${period},
                  etiket = ${label},
                  islemtarihi = NOW()
              WHERE id = ${recordId} AND dosyaid = ${fileId}
            `
          } catch (fallbackError) {
            if (!isMissingColumnError(fallbackError)) {
              throw fallbackError
            }

            return tx.$executeRaw`
              UPDATE yrd_giyim
              SET muracaateden = ${applicantName},
                  muracaattarihi = ${applicationDate},
                  aciklama = ${description},
                  miktar = ${amount}
              WHERE id = ${recordId} AND dosyaid = ${fileId}
            `
          }
        }
      }

      if (tableName === 'yrd_destekpaketi') {
        return tx.$executeRaw`
          UPDATE yrd_destekpaketi
          SET muracaateden = ${applicantName},
              muracaattarihi = ${applicationDate},
              muracaataciklama = ${description},
              bastarih = ${startDate},
              bittarih = ${endDate},
              miktar = ${amount},
              aciklama = ${description},
              donem = ${period},
              islemtarihi = NOW()
          WHERE id = ${recordId} AND dosyaid = ${fileId}
        `
      }

      if (tableName === 'yrd_haziryemek') {
        await ensureReadyMealBreakfastColumn()
        return tx.$executeRaw`
          UPDATE yrd_haziryemek
          SET muracaateden = ${applicantName},
              muracaattarihi = ${applicationDate},
              muracaataciklama = ${description},
              bastarih = ${startDate},
              bittarih = ${endDate},
              miktar = ${amount},
              kisisayisi = ${amount},
              kahvaltimiktari = ${breakfastAmount},
              aciklama = ${description},
              donem = ${period},
              etiket = ${label},
              islemtarihi = NOW()
          WHERE id = ${recordId} AND dosyaid = ${fileId}
        `
      }

      return tx.$executeRawUnsafe(
        `
          UPDATE ${tableName}
          SET muracaateden = $1::text,
              muracaattarihi = $2::date,
              muracaataciklama = $3::text,
              bastarih = $4::date,
              bittarih = $5::date,
              miktar = $6::int,
              aciklama = $7::text,
              donem = $8::text,
              etiket = $9::text,
              islemtarihi = NOW()
          WHERE id = $10::bigint AND dosyaid = $11::bigint
        `,
        applicantName,
        applicationDate.toISOString().slice(0, 10),
        description,
        startDate ? startDate.toISOString().slice(0, 10) : null,
        endDate ? endDate.toISOString().slice(0, 10) : null,
        amount,
        description,
        period,
        label,
        recordId.toString(),
        fileId.toString(),
      )
    }, getAuditMetaFromRequest(request))

    if (updatedCount === 0) {
      return NextResponse.json({ success: false, error: 'Güncellenecek müracaat kaydı bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, updatedCount })
  } catch (error) {
    console.error('Application update error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Müracaat kaydı güncellenemedi.' },
      { status: 500 },
    )
  }
}
