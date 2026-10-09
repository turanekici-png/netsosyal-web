import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { prisma } from '@/lib/db/prisma'
import { updateExpiredAssistanceStatuses } from '@/lib/services/assistanceExpiry.service'
import { createCashPredefinedLabelResolver } from '@/lib/services/cashPredefinedLabels.service'
import { userService } from '@/lib/services'
import { triggerStaleAddressAutoRefresh } from '@/lib/services/addressAutoRefresh.service'

export const dynamic = 'force-dynamic'

type DocumentSearchRow = {
  file_id: bigint
  dosyano: string | null
  dosya_muracaat_tarihi: Date | null
  dosya_durumu: number | null
  dosya_aile_niteligi: number | null
  dosya_aciklama: string | null
  dosya_adres: string | null
  dosya_telefon: string | null
  dosya_mahalleadi: string | null
  dosya_cadde: string | null
  dosya_sokak: string | null
  dosya_binano: string | null
  dosya_daireno: string | null
  dosya_adresno: string | null
  dosya_kartno: string | null
  dosya_inceleme_puani: number | null
  dosya_created_at: Date | null
  dosya_updated_at: Date | null
  birey_id: bigint
  yakinligi: number | null
  uyrugu: string | null
  tckimlikno: string | null
  adi: string | null
  soyadi: string | null
  babaadi: string | null
  anaadi: string | null
  dogumyeri: string | null
  dogumtarihi: Date | null
  medenihali: number | null
  cinsiyeti: string | null
  nfilce: string | null
  nfmahkoy: string | null
  saglikdurumu: number | null
  ceptel: string | null
  adisoyadi: string | null
  adres: string | null
  tipi: number | null
  adresno: string | null
  olumtarihi: string | null
}

type ServiceMovementRow = {
  source_type: string
  source_table: string
  record_id: bigint
  durumu: number | null
  muracaateden: string | null
  tckimlikno: string | null
  ceptel: string | null
  muracaattarihi: Date | null
  bastarih: Date | null
  bittarih: Date | null
  miktar: string | null
  raw_miktar: string | null
  kahvaltimiktari: string | null
  asama: string | null
  donem: string | null
  etiket: string | null
  muracaat_aciklama: string | null
  aciklama: string | null
  odemegunu: string | null
  odeme_baslangic: Date | null
  odeme_bitis: Date | null
  odeme_aciklama: string | null
  donem_odendi_mi: number | null
  kartno: string | null
  karttarih: Date | null
  kartaciklama: string | null
  mulkiyet_bilgisi: string | null
  arac_bilgisi: string | null
  iban: string | null
  aylik_gelir: string | null
  dogum_tarihi: Date | null
  // Bu kaydin GUNCEL donemi/kendisi icin bekleyen ya da karara baglanmis bir
  // yazdirma onay talebi var mi (bkz. yardim_onay_talepleri): 0=beklemede,
  // 1=onaylandi, 2=reddedildi, 3=talep eden tarafindan iptal edildi,
  // NULL=hic talep yok. Sadece Gida Bankasi, Destek Paketi ve Donem Disi
  // Gida icin anlamli - digerlerinde NULL.
  approval_status: number | null
  // Yukaridaki talebin kendi id'si - "Onaya Gönder"i geri almak (iptal)
  // icin istemcinin PATCH /api/documents/approval-requests/{id} cagirirken
  // ihtiyaci olan kimlik (bkz. documents/page.tsx - cancelApprovalRequest).
  approval_request_id: bigint | null
  // Kullanici istegi: "Otomatik Red İptal" tiki - SADECE yrd_ayninakti icin
  // anlamli (digerlerinde NULL/false); isaretliyse bu muracaat Otomatik Red
  // kontrolune (bkz. lib/services/cashAutoReject.service.ts) hic dahil
  // edilmez - kullanicinin elle belirledigi Durumu/Asama DEGISTIRILMEZ.
  otomatikrediptal: boolean | null
  // Kullanici istegi: "Yardım Hareketleri" penceresindeki tum raporlarda
  // alisveris miktari da gorunsun. Bu sutun sadece yrd_gidabankasi,
  // yrd_destekpaketi, yrd_ddgidadosyali ve yrd_giyim tablolarinda VAR -
  // Ekmek (yrd_ekmek), Ayni/Nakdi (yrd_ayninakti) ve Hazir Yemek
  // (yrd_haziryemek) tablolarinda bu alan hic tutulmuyor, bu turler icin
  // asagida NULL secilir.
  alisveris_miktari: string | null
  // Kullanici istegi: "Yardım Kişi Sayısı" ile girilen TC kimlik no'lari
  // "-" ile birlestirilmis halde - SADECE yrd_ayninakti icin var (bkz.
  // yrd_ayninakti.yardimkisitc), digerlerinde NULL.
  yardim_kisi_tc: string | null
  // "Yardım Kişi Sayısı" alaninin KENDISI - SADECE yrd_ayninakti icin var
  // (bkz. yrd_ayninakti.yardimkisisayisi), digerlerinde NULL.
  yardim_kisi_sayisi: string | null
}

type ExternalAidRow = {
  source_type: string
  record_id: bigint
  muracaateden: string | null
  tckimlikno: string | null
  ceptel: string | null
  muracaattarihi: Date | null
  miktar: string | null
  kurumadi: string | null
  yardimturu: string | null
  aciklama: string | null
}

type DocumentNoteRow = {
  id: bigint
  title: string | null
  note: string | null
  tarih: Date | null
  requested_by: string | null
  status: string | null
  identity_number: string | null
  person_name: string | null
}

type ImageRecordRow = {
  image_data: Buffer | Uint8Array | string | null
}

const globalForDkmPrisma = globalThis as unknown as {
  dkmPrisma: PrismaClient | undefined
  readyMealBreakfastColumnPromise: Promise<void> | undefined
  documentEvaluationScoreColumnPromise: Promise<void> | undefined
}

function getDkmConnectionString() {
  if (process.env.SOSYALYARDIMDKM_DATABASE_URL) {
    return process.env.SOSYALYARDIMDKM_DATABASE_URL
  }

  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL tanımlı değil.')
  }

  const url = new URL(connectionString)
  url.pathname = '/sosyalyardimdkm'
  return url.toString()
}

function getDkmPrisma() {
  if (!globalForDkmPrisma.dkmPrisma) {
    globalForDkmPrisma.dkmPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: getDkmConnectionString() }),
    })
  }

  return globalForDkmPrisma.dkmPrisma
}

function toImageSource(value: Buffer | Uint8Array | string | null) {
  if (!value) return null
  const mimeType = 'image/jpeg'

  if (typeof value === 'string') {
    const trimmedValue = value.trim()

    if (!trimmedValue) return null
    if (trimmedValue.startsWith('data:image/') || trimmedValue.startsWith('http') || trimmedValue.startsWith('/')) {
      return trimmedValue
    }
    if (trimmedValue.startsWith('\\x')) {
      return `data:${mimeType};base64,${Buffer.from(trimmedValue.slice(2), 'hex').toString('base64')}`
    }

    return `data:${mimeType};base64,${trimmedValue}`
  }

  return `data:${mimeType};base64,${Buffer.from(value).toString('base64')}`
}

function cleanText(value?: string | null) {
  const text = value?.trim()
  return text && text !== '-' ? text : ''
}

function firstTextOrDash(...values: Array<string | null | undefined>) {
  return values.map(cleanText).find(Boolean) || '-'
}

async function getDocumentPhotoUrl(beneficiaryId: bigint) {
  try {
    const rows = await getDkmPrisma().$queryRaw<ImageRecordRow[]>`
      SELECT
        resim AS image_data
      FROM public.bireyresim
      WHERE bireyid = ${beneficiaryId}
        AND resim IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
    `
    const imageRow = rows[0]

    if (!imageRow) return null

    return toImageSource(imageRow.image_data)
  } catch (error) {
    console.warn('Document photo could not be loaded:', error)
    return null
  }
}

function formatDate(date?: Date | string | null) {
  if (!date) return '-'
  const parsed = date instanceof Date ? date : new Date(date)
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString('tr-TR')
}

function splitName(fullName?: string | null) {
  const parts = cleanText(fullName).split(/\s+/).filter(Boolean)

  if (parts.length === 0) {
    return { firstName: '-', lastName: '-' }
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '-' }
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts.at(-1) || '-',
  }
}

function initials(fullName?: string | null) {
  const parts = cleanText(fullName).split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] || 'D') + (parts.at(-1)?.[0] || 'A')
}

function formatGender(gender?: string | null) {
  const normalized = gender?.trim().toLocaleUpperCase('tr-TR')

  if (normalized === 'K') return 'Kadın'
  if (normalized === 'E') return 'Erkek'

  return gender || '-'
}

function formatCode(value?: number | null) {
  return value === null || value === undefined ? '-' : String(value)
}

function formatMaritalStatus(value?: number | null) {
  return formatCode(value)
}

function formatRelation(value?: number | null) {
  return formatCode(value)
}

function extractNeighborhood(address?: string | null) {
  const match = address?.match(/^\s*(.+?)\s+MAH\.?/i)
  return match?.[1]?.trim() ? `${match[1].trim()} MAH.` : '-'
}

function beneficiaryNameParts(beneficiary: { adi?: string | null; soyadi?: string | null; adisoyadi?: string | null }) {
  const firstName = cleanText(beneficiary.adi)
  const lastName = cleanText(beneficiary.soyadi)
  const splitFullName = splitName(beneficiary.adisoyadi)

  if (firstName || lastName) {
    return {
      firstName: firstName || splitFullName.firstName,
      lastName: lastName || splitFullName.lastName,
    }
  }

  return splitFullName
}

function mapApplicationRow(row: ServiceMovementRow, index: number) {
  const description = resolveApplicationDescription(row)

  return {
    recordId: row.record_id.toString(),
    sourceTable: row.source_table,
    no: String(index + 1),
    type: row.source_type,
    identityNumber: row.tckimlikno || '-',
    fullName: row.muracaateden || '-',
    phone: row.ceptel || '-',
    stage: row.asama || '-',
    period: row.donem || '-',
    label: row.etiket || '-',
    applicationDate: formatDate(row.muracaattarihi),
    startDate: formatDate(row.bastarih),
    endDate: formatDate(row.bittarih),
    status: formatCode(row.durumu),
    amount: row.miktar || '-',
    mealAmount: row.raw_miktar || '',
    breakfastAmount: row.kahvaltimiktari || '',
    propertyInfo: row.mulkiyet_bilgisi || '',
    vehicleInfo: row.arac_bilgisi || '',
    iban: row.iban || '',
    householdIncome: row.aylik_gelir || '',
    applicantBirthDate: formatDate(row.dogum_tarihi),
    description: description || '-',
    // Sadece Dönem Dışı Gıda icin anlamli (bkz. yardim_onay_talepleri LATERAL
    // join) - mapAssistanceRow ile AYNI mantik, "Müracaatlar" listesindeki
    // yazdir butonu icin de gerekli (bkz. documents/page.tsx - getPrintButtonState).
    approvalStatus: (
      row.approval_status === 0 ? 'pending' :
      row.approval_status === 1 ? 'approved' :
      row.approval_status === 2 ? 'rejected' :
      'none'
    ) as 'none' | 'pending' | 'approved' | 'rejected',
    approvalRequestId: row.approval_request_id ? row.approval_request_id.toString() : null,
    otomatikRedIptal: Boolean(row.otomatikrediptal),
    assistPersonTcList: row.yardim_kisi_tc || '',
    assistPersonCount: row.yardim_kisi_sayisi || '',
  }
}

function resolveApplicationDescription(row: ServiceMovementRow) {
  const text = String(row.aciklama || '').trim()
  if (!text || text === '-') return ''

  if (row.source_table !== 'yrd_ayninakti') return text

  const onlineMatch = text.match(/(?:^|;\s*)A[cç][ıi]klama:\s*(.*)$/i)
  if (onlineMatch) return onlineMatch[1]?.trim() || ''

  return /^Online basvuru ID:/i.test(text) ? '' : text
}

function mapAssistanceRow(row: ServiceMovementRow, index: number) {
  return {
    recordId: row.record_id.toString(),
    sourceTable: row.source_table,
    no: String(index + 1),
    type: row.source_type,
    date: formatDate(row.muracaattarihi),
    startDate: formatDate(row.bastarih),
    endDate: formatDate(row.bittarih),
    periodInfo: row.donem || '-',
    label: row.etiket || '',
    status: formatCode(row.durumu),
    amount: row.miktar || '-',
    mealAmount: row.raw_miktar || '',
    breakfastAmount: row.kahvaltimiktari || '',
    // Kullanici istegi: "Yardım Hareketleri" penceresindeki tum raporlarda
    // alisveris miktari da gorunsun - sadece Gıda Bankası, Destek Paketi,
    // Dönem Dışı Gıda ve Giyim icin dolu gelir (bkz. yukaridaki
    // ServiceMovementRow.alisveris_miktari notu), digerlerinde '-'.
    shoppingAmount: row.alisveris_miktari || '-',
    paymentDay: row.odemegunu || '-',
    paymentStartDate: formatDate(row.odeme_baslangic),
    paymentEndDate: formatDate(row.odeme_bitis),
    paymentDescription: row.odeme_aciklama || '-',
    // "1" = bu donemin odemesi ZATEN yapilmis (dnm_durumu=1). Sadece Gıda
    // Bankası/Destek Paketi icin anlamli - digerlerinde NULL.
    paymentDonePeriod: row.donem_odendi_mi === 1,
    breadCardNo: row.kartno || '',
    breadCardDate: formatDate(row.karttarih),
    breadCardDescription: row.kartaciklama || '',
    propertyInfo: row.mulkiyet_bilgisi || '',
    vehicleInfo: row.arac_bilgisi || '',
    iban: row.iban || '',
    householdIncome: row.aylik_gelir || '',
    applicantBirthDate: formatDate(row.dogum_tarihi),
    muracaatDescription: row.muracaat_aciklama || '-',
    description: row.aciklama || '-',
    // Dönem Dışı Gıda/Giyim'de durumuaciklama'nin kendisi (asli/gercek
    // deger, 'Açıklama' sutunundaki gibi baska bir alanla COALESCE
    // edilmeden) - "Yardım Hareketleri" penceresindeki Aşama sutununu besler.
    stage: row.asama || '-',
    // Sadece Gıda Bankası/Destek Paketi/Dönem Dışı Gıda icin anlamli - bu
    // kaydin GUNCEL donemi/kendisi icin en son yazdirma onay talebinin
    // durumu (bkz. yardim_onay_talepleri). Digerlerinde 'none'.
    approvalStatus: (
      row.approval_status === 0 ? 'pending' :
      row.approval_status === 1 ? 'approved' :
      row.approval_status === 2 ? 'rejected' :
      'none'
    ) as 'none' | 'pending' | 'approved' | 'rejected',
    approvalRequestId: row.approval_request_id ? row.approval_request_id.toString() : null,
  }
}

async function ensureReadyMealBreakfastColumn() {
  if (!globalForDkmPrisma.readyMealBreakfastColumnPromise) {
    globalForDkmPrisma.readyMealBreakfastColumnPromise = (async () => {
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
      globalForDkmPrisma.readyMealBreakfastColumnPromise = undefined
      throw error
    })
  }

  await globalForDkmPrisma.readyMealBreakfastColumnPromise
}

async function ensureDocumentEvaluationScoreColumn() {
  if (!globalForDkmPrisma.documentEvaluationScoreColumnPromise) {
    globalForDkmPrisma.documentEvaluationScoreColumnPromise = (async () => {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'dosyalar'
          AND column_name = 'inceleme_puani'
      `

      if (columns.length === 0) {
        await prisma.$executeRawUnsafe('ALTER TABLE public.dosyalar ADD COLUMN inceleme_puani integer')
        await prisma.$executeRawUnsafe(`
          DO $$
          BEGIN
            IF to_regclass('public.inceleme_formu') IS NOT NULL THEN
              UPDATE public.dosyalar d
              SET inceleme_puani = latest.toplam_puan
              FROM (
                SELECT DISTINCT ON (dosyaid)
                  dosyaid,
                  toplam_puan
                FROM public.inceleme_formu
                ORDER BY dosyaid, form_tarihi DESC NULLS LAST, islemtarihi DESC NULLS LAST, id DESC
              ) latest
              WHERE d.id = latest.dosyaid;
            END IF;
          END $$;
        `)
      }
    })().catch((error) => {
      globalForDkmPrisma.documentEvaluationScoreColumnPromise = undefined
      throw error
    })
  }

  await globalForDkmPrisma.documentEvaluationScoreColumnPromise
}

export async function GET(request: NextRequest) {
  try {
    await updateExpiredAssistanceStatuses()
    await ensureReadyMealBreakfastColumn()
    await ensureDocumentEvaluationScoreColumn()

    const fileNo = request.nextUrl.searchParams.get('fileNo')?.trim()
    const fileId = request.nextUrl.searchParams.get('fileId')?.trim()

    if (!fileNo && !fileId) {
      return NextResponse.json({ success: false, error: 'Dosya numarası veya ID zorunludur.' }, { status: 400 })
    }

    let rows: DocumentSearchRow[] = []

    if (fileId) {
      rows = await prisma.$queryRaw<DocumentSearchRow[]>`
        SELECT
          d.id AS file_id,
          d.dosyano,
          d.muracaattarihi AS dosya_muracaat_tarihi,
          d.durumu AS dosya_durumu,
          d.aileniteligi AS dosya_aile_niteligi,
          d.aciklama AS dosya_aciklama,
          d.adres AS dosya_adres,
          d.telefon AS dosya_telefon,
          d.mahalleadi AS dosya_mahalleadi,
          d.cadde AS dosya_cadde,
          d.sokak AS dosya_sokak,
          d.binano AS dosya_binano,
          d.daireno AS dosya_daireno,
          d.adresno AS dosya_adresno,
          d.kartno AS dosya_kartno,
          d.inceleme_puani AS dosya_inceleme_puani,
          d.ilkislemtarihi AS dosya_created_at,
          d.islemtarihi AS dosya_updated_at,
          b.id AS birey_id,
          b.yakinligi,
          b.uyrugu,
          b.tckimlikno,
          b.adi,
          b.soyadi,
          b.babaadi,
          b.anaadi,
          b.dogumyeri,
          b.dogumtarihi,
          b.medenihali,
          b.cinsiyeti,
          b.nfilce,
          b.nfmahkoy,
          b.saglikdurumu,
          b.ceptel,
          b.adisoyadi,
          b.adres,
          b.tipi,
          b.adresno,
          b.olumtarihi
        FROM dosyalar d
        LEFT JOIN bireyler b ON b.dosyaid = d.id
        WHERE d.id = ${BigInt(fileId)}
        ORDER BY
          CASE WHEN b.tipi = 1 THEN 0 WHEN b.yakinligi = 0 THEN 1 ELSE 2 END,
          b.id ASC
      `
    } else {
      rows = await prisma.$queryRaw<DocumentSearchRow[]>`
        SELECT
          d.id AS file_id,
          d.dosyano,
          d.muracaattarihi AS dosya_muracaat_tarihi,
          d.durumu AS dosya_durumu,
          d.aileniteligi AS dosya_aile_niteligi,
          d.aciklama AS dosya_aciklama,
          d.adres AS dosya_adres,
          d.telefon AS dosya_telefon,
          d.mahalleadi AS dosya_mahalleadi,
          d.cadde AS dosya_cadde,
          d.sokak AS dosya_sokak,
          d.binano AS dosya_binano,
          d.daireno AS dosya_daireno,
          d.adresno AS dosya_adresno,
          d.kartno AS dosya_kartno,
          d.inceleme_puani AS dosya_inceleme_puani,
          d.ilkislemtarihi AS dosya_created_at,
          d.islemtarihi AS dosya_updated_at,
          b.id AS birey_id,
          b.yakinligi,
          b.uyrugu,
          b.tckimlikno,
          b.adi,
          b.soyadi,
          b.babaadi,
          b.anaadi,
          b.dogumyeri,
          b.dogumtarihi,
          b.medenihali,
          b.cinsiyeti,
          b.nfilce,
          b.nfmahkoy,
          b.saglikdurumu,
          b.ceptel,
          b.adisoyadi,
          b.adres,
          b.tipi,
          b.adresno,
          b.olumtarihi
        FROM dosyalar d
        LEFT JOIN bireyler b ON b.dosyaid = d.id
        WHERE d.dosyano = ${fileNo}
        ORDER BY
          CASE WHEN b.tipi = 1 THEN 0 WHEN b.yakinligi = 0 THEN 1 ELSE 2 END,
          b.id ASC
      `
    }

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Dosya bulunamadı.' }, { status: 404 })
    }

    if (!rows[0].birey_id) {
      return NextResponse.json({ success: false, error: 'Bu dosyaya bağlı birey bulunamadı.' }, { status: 404 })
    }

    const file = rows[0]
    const primaryBeneficiary = rows[0]

    // Bu dosyadaki bireylerden adresi 1 aydan eski (ya da hiç sorgulanmamış)
    // olanlar varsa, arka planda NVİ'den otomatik güncellenir - dosya
    // AÇILDIĞINDA tetiklenir, kullanıcı hiçbir şey yapmasa bile. Sadece
    // "kaç bireyin adresi güncellenecek" tespiti (hızlı bir sorgu) burada
    // BEKLENİR - asıl NVİ sorguları arka planda devam eder, bu isteği asla
    // geciktirmez/bozmaz (bkz. lib/services/addressAutoRefresh.service.ts).
    // Dönen bilgi, ekranda "Adres NVİ'den güncelleniyor..." bildirimini
    // göstermek için kullanılır.
    const addressRefresh = await triggerStaleAddressAutoRefresh(file.file_id, request)
      .catch(() => ({ triggered: false, staleCount: 0 }))

    const { firstName, lastName } = beneficiaryNameParts(primaryBeneficiary)
    const photoUrlPromise = getDocumentPhotoUrl(primaryBeneficiary.birey_id)
    const cashLabelResolverPromise = createCashPredefinedLabelResolver()

    // Asagidaki sorgular (hareketler, dis kurum yardimlari, notlar) ve bildirim
    // temizleme yazmasi birbirinden bagimsizdir - hepsi sadece file.file_id/dosyano
    // kullanir, birbirinin sonucuna ihtiyac duymaz. Sirayla (await await await) calistirmak
    // yerine Promise.all ile paralel calistirmak, dosya acma suresini veritabani
    // gidis-donuslerinin toplami yerine en yavas sorgu kadar sureye indirir.
    const serviceRowsPromise = prisma.$queryRaw<ServiceMovementRow[]>`
      SELECT * FROM (
        SELECT
          'Ekmek'::text AS source_type,
          'yrd_ekmek'::text AS source_table,
          t.id::bigint AS record_id,
          t.durumu,
          t.muracaateden,
          b.tckimlikno,
          b.ceptel,
          t.muracaattarihi,
          t.bastarih,
          t.bittarih,
          t.miktar::text AS miktar,
          t.miktar::text AS raw_miktar,
          NULL::text AS kahvaltimiktari,
          NULL::text AS asama,
          COALESCE(NULLIF(t.donemadi, ''), NULLIF(t.donemstr, ''), NULLIF(t.donem, ''))::text AS donem,
          t.etiket::text AS etiket,
          NULLIF(t.muracaataciklama, '')::text AS muracaat_aciklama,
          COALESCE(t.aciklama, t.durumuaciklama)::text AS aciklama,
          NULL::text AS odemegunu,
          t.dnm_bastarih AS odeme_baslangic,
          NULL::date AS odeme_bitis,
          t.dnm_durumuaciklama::text AS odeme_aciklama,
          t.dnm_durumu AS donem_odendi_mi,
          t.kartno::text AS kartno,
          t.karttarih AS karttarih,
          t.kartaciklama::text AS kartaciklama,
          NULL::text AS mulkiyet_bilgisi,
          NULL::text AS arac_bilgisi,
          NULL::text AS iban,
          NULL::text AS aylik_gelir,
          NULL::date AS dogum_tarihi,
          NULL::smallint AS approval_status,
          NULL::bigint AS approval_request_id,
          NULL::boolean AS otomatikrediptal,
          NULL::text AS alisveris_miktari,
          NULL::text AS yardim_kisi_tc,
          NULL::text AS yardim_kisi_sayisi
        FROM yrd_ekmek t
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
        WHERE t.dosyaid = ${file.file_id}

        UNION ALL

        SELECT
          'Gıda Bankası'::text AS source_type,
          'yrd_gidabankasi'::text AS source_table,
          t.id::bigint AS record_id,
          t.durumu,
          t.muracaateden,
          b.tckimlikno,
          b.ceptel,
          t.muracaattarihi,
          t.bastarih,
          t.bittarih,
          t.miktar::text AS miktar,
          t.miktar::text AS raw_miktar,
          NULL::text AS kahvaltimiktari,
          NULL::text AS asama,
          COALESCE(NULLIF(t.donemstr, ''), NULLIF(t.donem, ''), t.donemint::text)::text AS donem,
          t.etiket::text AS etiket,
          NULLIF(t.muracaataciklama, '')::text AS muracaat_aciklama,
          COALESCE(t.aciklama, t.durumuaciklama)::text AS aciklama,
          t.donemint::text AS odemegunu,
          payment.payment_start AS odeme_baslangic,
          CASE
            WHEN payment.payment_start IS NOT NULL THEN payment_end.payment_end
            ELSE t.dnm_durumutarih
          END AS odeme_bitis,
          t.dnm_durumuaciklama::text AS odeme_aciklama,
          t.dnm_durumu AS donem_odendi_mi,
          NULL::text AS kartno,
          NULL::date AS karttarih,
          NULL::text AS kartaciklama,
          NULL::text AS mulkiyet_bilgisi,
          NULL::text AS arac_bilgisi,
          NULL::text AS iban,
          NULL::text AS aylik_gelir,
          NULL::date AS dogum_tarihi,
          approval.durum AS approval_status,
          approval.id AS approval_request_id,
          NULL::boolean AS otomatikrediptal,
          t.alisverismiktari::text AS alisveris_miktari,
          NULL::text AS yardim_kisi_tc,
          NULL::text AS yardim_kisi_sayisi
        FROM yrd_gidabankasi t
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
        LEFT JOIN LATERAL (
          SELECT m.odemegunu::int AS payment_day, m.odemegunubitis::int AS payment_end_day
          FROM dosyalar d
          LEFT JOIN mahalleler m
            ON m.id = d.mahalleid
            OR lower(trim(m.mahalleadi)) = lower(trim(d.mahalleadi))
          WHERE d.id = t.dosyaid
          ORDER BY CASE WHEN m.id = d.mahalleid THEN 0 ELSE 1 END
          LIMIT 1
        ) neighborhood ON TRUE
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN t.donemint IS NOT NULL
              AND neighborhood.payment_day IS NOT NULL
              AND (t.donemint % 100) BETWEEN 1 AND 12
            THEN make_date(
              (t.donemint / 100)::int,
              (t.donemint % 100)::int,
              GREATEST(
                1,
                LEAST(
                  neighborhood.payment_day,
                  EXTRACT(DAY FROM (
                    date_trunc('month', make_date((t.donemint / 100)::int, (t.donemint % 100)::int, 1))
                    + INTERVAL '1 month - 1 day'
                  ))::int
                )
              )
            )
            ELSE t.dnm_bastarih
          END AS payment_start
        ) payment ON TRUE
        LEFT JOIN LATERAL (
          -- Mahallenin "Ödeme Bitiş Günü" alanı, başlangıç tarihine EKLENECEK
          -- GÜN SAYISIDIR (mutlak bir "ayın günü" DEĞİL) - ör. başlangıç 3,
          -- bitiş(süre) 7 ise bitiş tarihi 3+7=10'dur. Sonuç HİÇBİR ZAMAN bir
          -- sonraki aya SARKMAZ - o ayın son gününü aşarsa ayın son gününe
          -- sabitlenir (ör. başlangıç 25, süre 7 ise 25+7=32 Ağustos'u aştığı
          -- için bitiş Ağustos'un son günü 31'e sabitlenir). Bitiş günü
          -- tanımlı değilse ESKİ davranış korunur: 7 gün (bkz.
          -- lib/utils/paymentWindow.ts - aynı algoritma).
          SELECT CASE
            WHEN payment.payment_start IS NULL THEN NULL::date
            ELSE LEAST(
              payment.payment_start + (COALESCE(neighborhood.payment_end_day, 7)::text || ' days')::interval,
              date_trunc('month', payment.payment_start) + INTERVAL '1 month - 1 day'
            )::date
          END AS payment_end
        ) payment_end ON TRUE
        LEFT JOIN LATERAL (
          -- Bu kaydin GUNCEL donemi (t.donemint) icin en son verilen onay
          -- karari (bkz. lib/constants/authorizedPersonnel.ts ve
          -- app/api/documents/approval-requests) - donem her degistiginde
          -- (yeni ay) FARKLI bir talep aranir, eski onay otomatik gecersiz
          -- kalir (kullanicinin "sadece o donem icin gecerli olsun" istegi).
          SELECT id, durum FROM yardim_onay_talepleri
          WHERE kayit_turu = 'yrd_gidabankasi' AND kayit_id = t.id AND donem IS NOT DISTINCT FROM t.donemint
          ORDER BY id DESC LIMIT 1
        ) approval ON TRUE
        WHERE t.dosyaid = ${file.file_id}

        UNION ALL

        SELECT
          'Destek Paketi'::text AS source_type,
          'yrd_destekpaketi'::text AS source_table,
          t.id::bigint AS record_id,
          t.durumu,
          t.muracaateden,
          b.tckimlikno,
          b.ceptel,
          t.muracaattarihi,
          t.bastarih,
          t.bittarih,
          t.miktar::text AS miktar,
          t.miktar::text AS raw_miktar,
          NULL::text AS kahvaltimiktari,
          NULL::text AS asama,
          COALESCE(NULLIF(t.donemstr, ''), NULLIF(t.donem, ''), t.donemint::text)::text AS donem,
          NULL::text AS etiket,
          NULLIF(t.muracaataciklama, '')::text AS muracaat_aciklama,
          COALESCE(t.aciklama, t.durumuaciklama)::text AS aciklama,
          t.donemint::text AS odemegunu,
          payment.payment_start AS odeme_baslangic,
          CASE
            WHEN payment.payment_start IS NOT NULL THEN payment_end.payment_end
            ELSE NULL::date
          END AS odeme_bitis,
          t.dnm_durumuaciklama::text AS odeme_aciklama,
          t.dnm_durumu AS donem_odendi_mi,
          NULL::text AS kartno,
          NULL::date AS karttarih,
          NULL::text AS kartaciklama,
          NULL::text AS mulkiyet_bilgisi,
          NULL::text AS arac_bilgisi,
          NULL::text AS iban,
          NULL::text AS aylik_gelir,
          NULL::date AS dogum_tarihi,
          approval.durum AS approval_status,
          approval.id AS approval_request_id,
          NULL::boolean AS otomatikrediptal,
          t.alisverismiktari::text AS alisveris_miktari,
          NULL::text AS yardim_kisi_tc,
          NULL::text AS yardim_kisi_sayisi
        FROM yrd_destekpaketi t
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
        LEFT JOIN LATERAL (
          SELECT m.odemegunu::int AS payment_day, m.odemegunubitis::int AS payment_end_day
          FROM dosyalar d
          LEFT JOIN mahalleler m
            ON m.id = d.mahalleid
            OR lower(trim(m.mahalleadi)) = lower(trim(d.mahalleadi))
          WHERE d.id = t.dosyaid
          ORDER BY CASE WHEN m.id = d.mahalleid THEN 0 ELSE 1 END
          LIMIT 1
        ) neighborhood ON TRUE
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN t.donemint IS NOT NULL
              AND neighborhood.payment_day IS NOT NULL
              AND (t.donemint % 100) BETWEEN 1 AND 12
            THEN make_date(
              (t.donemint / 100)::int,
              (t.donemint % 100)::int,
              GREATEST(
                1,
                LEAST(
                  neighborhood.payment_day,
                  EXTRACT(DAY FROM (
                    date_trunc('month', make_date((t.donemint / 100)::int, (t.donemint % 100)::int, 1))
                    + INTERVAL '1 month - 1 day'
                  ))::int
                )
              )
            )
            ELSE t.dnm_bastarih
          END AS payment_start
        ) payment ON TRUE
        LEFT JOIN LATERAL (
          -- (Ayni algoritma - bkz. yukaridaki Gida Bankasi blogundaki
          -- aciklama ve lib/utils/paymentWindow.ts)
          SELECT CASE
            WHEN payment.payment_start IS NULL THEN NULL::date
            ELSE LEAST(
              payment.payment_start + (COALESCE(neighborhood.payment_end_day, 7)::text || ' days')::interval,
              date_trunc('month', payment.payment_start) + INTERVAL '1 month - 1 day'
            )::date
          END AS payment_end
        ) payment_end ON TRUE
        LEFT JOIN LATERAL (
          SELECT id, durum FROM yardim_onay_talepleri
          WHERE kayit_turu = 'yrd_destekpaketi' AND kayit_id = t.id AND donem IS NOT DISTINCT FROM t.donemint
          ORDER BY id DESC LIMIT 1
        ) approval ON TRUE
        WHERE t.dosyaid = ${file.file_id}

        UNION ALL

        SELECT
          'Dönem Dışı Gıda'::text AS source_type,
          'yrd_ddgidadosyali'::text AS source_table,
          t.id::bigint AS record_id,
          t.durumu,
          t.muracaateden,
          b.tckimlikno,
          b.ceptel,
          t.muracaattarihi,
          t.muracaattarihi AS bastarih,
          t.bittarih,
          t.miktar::text AS miktar,
          t.miktar::text AS raw_miktar,
          NULL::text AS kahvaltimiktari,
          COALESCE(t.durumuaciklama, 'Müracaat')::text AS asama,
          t.nedeni::text AS donem,
          t.nedeni::text AS etiket,
          NULL::text AS muracaat_aciklama,
          COALESCE(t.aciklama, t.durumuaciklama)::text AS aciklama,
          NULL::text AS odemegunu,
          NULL::date AS odeme_baslangic,
          NULL::date AS odeme_bitis,
          NULL::text AS odeme_aciklama,
          NULL::int AS donem_odendi_mi,
          NULL::text AS kartno,
          NULL::date AS karttarih,
          NULL::text AS kartaciklama,
          NULL::text AS mulkiyet_bilgisi,
          NULL::text AS arac_bilgisi,
          NULL::text AS iban,
          NULL::text AS aylik_gelir,
          NULL::date AS dogum_tarihi,
          approval.durum AS approval_status,
          approval.id AS approval_request_id,
          NULL::boolean AS otomatikrediptal,
          t.alisverismiktari::text AS alisveris_miktari,
          NULL::text AS yardim_kisi_tc,
          NULL::text AS yardim_kisi_sayisi
        FROM yrd_ddgidadosyali t
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
        LEFT JOIN LATERAL (
          -- "Dönem Dışı Gıda" periyodik degildir (donem kavrami yok), bu
          -- yuzden onay TALEBIN KENDISINE (kayit_id) baglidir, donem=NULL
          -- eslesir - kayit yeniden acilirsa (durumu tekrar 0'a donerse) yeni
          -- bir onay talebi gerekir, eskisi otomatik "gecersiz" sayilmaz ama
          -- son karar zaten en guncel talebi yansitir (ORDER BY id DESC).
          SELECT id, durum FROM yardim_onay_talepleri
          WHERE kayit_turu = 'yrd_ddgidadosyali' AND kayit_id = t.id AND donem IS NULL
          ORDER BY id DESC LIMIT 1
        ) approval ON TRUE
        WHERE t.dosyaid = ${file.file_id}

        UNION ALL

        SELECT
          'Giyim'::text AS source_type,
          'yrd_giyim'::text AS source_table,
          t.id::bigint AS record_id,
          t.durumu,
          t.muracaateden,
          b.tckimlikno,
          b.ceptel,
          t.muracaattarihi,
          t.muracaattarihi AS bastarih,
          NULL::date AS bittarih,
          t.miktar::text AS miktar,
          t.miktar::text AS raw_miktar,
          NULL::text AS kahvaltimiktari,
          COALESCE(t.durumuaciklama, 'Müracaat')::text AS asama,
          t.donem::text AS donem,
          t.etiket::text AS etiket,
          NULLIF(t.muracaataciklama, '')::text AS muracaat_aciklama,
          COALESCE(t.aciklama, t.durumuaciklama)::text AS aciklama,
          NULL::text AS odemegunu,
          NULL::date AS odeme_baslangic,
          NULL::date AS odeme_bitis,
          NULL::text AS odeme_aciklama,
          NULL::int AS donem_odendi_mi,
          NULL::text AS kartno,
          NULL::date AS karttarih,
          NULL::text AS kartaciklama,
          NULL::text AS mulkiyet_bilgisi,
          NULL::text AS arac_bilgisi,
          NULL::text AS iban,
          NULL::text AS aylik_gelir,
          NULL::date AS dogum_tarihi,
          NULL::smallint AS approval_status,
          NULL::bigint AS approval_request_id,
          NULL::boolean AS otomatikrediptal,
          t.alisverismiktari::text AS alisveris_miktari,
          NULL::text AS yardim_kisi_tc,
          NULL::text AS yardim_kisi_sayisi
        FROM yrd_giyim t
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
        WHERE t.dosyaid = ${file.file_id}

        UNION ALL

        SELECT
          'Ayni/Nakdi'::text AS source_type,
          'yrd_ayninakti'::text AS source_table,
          t.id::bigint AS record_id,
          t.durumu,
          t.muracaateden,
          COALESCE(t.tckimlikno, b.tckimlikno) AS tckimlikno,
          COALESCE(t.ceptel, b.ceptel) AS ceptel,
          t.muracaattarihi,
          NULL::date AS bastarih,
          NULL::date AS bittarih,
          t.miktar::text AS miktar,
          t.miktar::text AS raw_miktar,
          NULL::text AS kahvaltimiktari,
          t.asama::text AS asama,
          t.donem::text AS donem,
          t.etiket::text AS etiket,
          NULLIF(t.muracaatnotu, '')::text AS muracaat_aciklama,
          -- "aciklama" (asagida description'a doner - bkz. Muracaat Duzenle
          -- penceresi Yardim Bilgisi/Aciklama kutusu) SADECE muracaatnotu'dan
          -- okunur - o kutu KAYDEDERKEN muracaatnotu'na yaziyor (bkz.
          -- app/api/documents/applications/route.ts PATCH). ONCEKI duzeltmede
          -- muracaatnotu bosken asamanotu/durumuaciklama'ya (tamamen ILGISIZ,
          -- ic durum notlari) dusuluyordu - kullanici bunun kafa karistirici
          -- oldugunu bildirdi ("Rapor ekranından silindi" gibi kendi
          -- yazmadigi bir metin surekli goruntuleniyordu). Artik ALAN GERCEKTEN
          -- BOSSA aciklama da bos gorunur, ILGISIZ baska bir alana DUSULMEZ.
          NULLIF(t.muracaatnotu, '')::text AS aciklama,
          NULL::text AS odemegunu,
          NULL::date AS odeme_baslangic,
          NULL::date AS odeme_bitis,
          NULL::text AS odeme_aciklama,
          NULL::int AS donem_odendi_mi,
          NULL::text AS kartno,
          NULL::date AS karttarih,
          NULL::text AS kartaciklama,
          t.mulkiyetbilgisi::text AS mulkiyet_bilgisi,
          t.aracbilgisi::text AS arac_bilgisi,
          t.iban::text AS iban,
          t.aylikgelir::text AS aylik_gelir,
          t.dogumtarihi::date AS dogum_tarihi,
          NULL::smallint AS approval_status,
          NULL::bigint AS approval_request_id,
          t.otomatikrediptal,
          NULL::text AS alisveris_miktari,
          t.yardimkisitc::text AS yardim_kisi_tc,
          t.yardimkisisayisi::text AS yardim_kisi_sayisi
        FROM yrd_ayninakti t
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
        WHERE t.dosyaid = ${file.file_id}

        UNION ALL

        SELECT
          'Hazır Yemek'::text AS source_type,
          'yrd_haziryemek'::text AS source_table,
          t.id::bigint AS record_id,
          t.durumu,
          t.muracaateden,
          b.tckimlikno,
          b.ceptel,
          t.muracaattarihi,
          t.bastarih,
          t.bittarih,
          CASE
            WHEN COALESCE(t.kahvaltimiktari, 0) > 0 AND COALESCE(t.miktar, t.kisisayisi, t.ekmekmiktari, 0) > 0
              THEN CONCAT('Yemek: ', COALESCE(t.miktar, t.kisisayisi, t.ekmekmiktari), ' / Kahvaltı: ', t.kahvaltimiktari)
            WHEN COALESCE(t.kahvaltimiktari, 0) > 0
              THEN CONCAT('Kahvaltı: ', t.kahvaltimiktari)
            ELSE COALESCE(t.miktar, t.kisisayisi, t.ekmekmiktari)::text
          END AS miktar,
          COALESCE(t.miktar, t.kisisayisi, t.ekmekmiktari)::text AS raw_miktar,
          t.kahvaltimiktari::text AS kahvaltimiktari,
          NULL::text AS asama,
          COALESCE(NULLIF(t.donemadi, ''), NULLIF(t.donem, ''))::text AS donem,
          t.etiket::text AS etiket,
          NULLIF(t.muracaataciklama, '')::text AS muracaat_aciklama,
          COALESCE(t.aciklama, t.durumuaciklama)::text AS aciklama,
          NULL::text AS odemegunu,
          NULL::date AS odeme_baslangic,
          NULL::date AS odeme_bitis,
          NULL::text AS odeme_aciklama,
          NULL::int AS donem_odendi_mi,
          NULL::text AS kartno,
          NULL::date AS karttarih,
          NULL::text AS kartaciklama,
          NULL::text AS mulkiyet_bilgisi,
          NULL::text AS arac_bilgisi,
          NULL::text AS iban,
          NULL::text AS aylik_gelir,
          NULL::date AS dogum_tarihi,
          NULL::smallint AS approval_status,
          NULL::bigint AS approval_request_id,
          NULL::boolean AS otomatikrediptal,
          NULL::text AS alisveris_miktari,
          NULL::text AS yardim_kisi_tc,
          NULL::text AS yardim_kisi_sayisi
        FROM yrd_haziryemek t
        LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.muracaateden
        WHERE t.dosyaid = ${file.file_id}
      ) movements
      ORDER BY muracaattarihi DESC NULLS LAST, record_id DESC
    `

    const externalAidsRowsPromise = prisma.$queryRaw<ExternalAidRow[]>`
      SELECT
        'Diğer Kurum'::text AS source_type,
        t.id::bigint AS record_id,
        t.adisoyadi AS muracaateden,
        COALESCE(t.tckimlikno, b.tckimlikno) AS tckimlikno,
        b.ceptel,
        t.tarih AS muracaattarihi,
        t.miktar::text AS miktar,
        t.yardimalkrmadi::text AS kurumadi,
        t.yardimturu::text AS yardimturu,
        t.aciklama::text AS aciklama
      FROM yrd_digerkrmalyrdm t
      LEFT JOIN bireyler b ON b.dosyaid = t.dosyaid AND b.adisoyadi = t.adisoyadi
      WHERE t.dosyaid = ${file.file_id}
      ORDER BY t.tarih DESC NULLS LAST
    `

    const noteRowsPromise = prisma.$queryRaw<DocumentNoteRow[]>`
      SELECT
        id,
        evrak_adi AS title,
        notlar AS note,
        COALESCE(istenme_tarihi, created_at) AS tarih,
        isteyen_kullanici AS requested_by,
        durum AS status,
        tckimlikno AS identity_number,
        adisoyadi AS person_name
      FROM beklenen_evraklar
      WHERE (
          dosyaid::text = ${file.file_id.toString()}
          OR (${file.dosyano}::text IS NOT NULL AND NULLIF(BTRIM(dosyano), '') = ${file.dosyano})
        )
        AND COALESCE(NULLIF(BTRIM(durum), ''), 'bekliyor') NOT IN ('tamamlandi', 'goruldu')
      ORDER BY COALESCE(istenme_tarihi, created_at) DESC NULLS LAST, id DESC
    `

    const clearSeenNotificationsPromise = (async () => {
      try {
        const currentUser = await userService.getCurrent()
        const requesterName = currentUser?.name || ''
        const requesterUsername = currentUser?.username || ''
        if (requesterName || requesterUsername) {
          await prisma.$executeRaw`
            UPDATE beklenen_evraklar
            SET durum = 'goruldu',
                updated_at = NOW()
            WHERE dosyaid::text = ${file.file_id.toString()}
              AND durum = 'tamamlandi'
              AND (
                (${requesterName} <> '' AND isteyen_kullanici = ${requesterName})
                OR (${requesterUsername} <> '' AND isteyen_kullanici = ${requesterUsername})
              )
          `
        }
      } catch {
        // Bildirim temizleme hatasi dosya acilmasini engellememeli.
      }
    })()

    const [serviceRows, cashLabelResolver, externalAidsRows, noteRows] = await Promise.all([
      serviceRowsPromise,
      cashLabelResolverPromise,
      externalAidsRowsPromise,
      noteRowsPromise,
    ])
    await clearSeenNotificationsPromise

    const displayServiceRows = serviceRows.map((row) => {
      if (row.source_table !== 'yrd_ayninakti') return row

      const cashLabels = cashLabelResolver(row.donem, row.etiket)

      return {
        ...row,
        donem: cashLabels.period,
        etiket: cashLabels.label,
      }
    })
    const applications = displayServiceRows.filter((row) => row.durumu === 0).map(mapApplicationRow)
    const assistances = displayServiceRows
      .filter((row) => row.durumu !== 0 && !(row.source_type === 'Ayni/Nakdi' && row.durumu === 6))
      .map(mapAssistanceRow)

    const externalAids = externalAidsRows.map((row, index) => ({
      no: String(index + 1),
      date: formatDate(row.muracaattarihi),
      identityNumber: row.tckimlikno || '-',
      fullName: row.muracaateden || '-',
      institution: row.kurumadi || '-',
      aidType: row.yardimturu || '-',
      description: row.aciklama || '-',
      amount: row.miktar || '-',
    }))

    const notes = noteRows.map((row) => ({
      id: row.id.toString(),
      title: row.title || '',
      note: row.note || '',
      date: formatDate(row.tarih),
      requestedBy: row.requested_by || '-',
      status: row.status || 'bekliyor',
      identityNumber: row.identity_number || '',
      personName: row.person_name || '',
    }))

    const photoUrl = await photoUrlPromise

    return NextResponse.json({
      success: true,
      data: {
        file: {
          id: file.file_id.toString(),
          fileNo: file.dosyano || fileNo,
          status: file.dosya_durumu,
          familyType: file.dosya_aile_niteligi,
          description: file.dosya_aciklama,
          address: file.dosya_adres,
          phone: file.dosya_telefon,
          neighborhood: file.dosya_mahalleadi,
          avenue: file.dosya_cadde,
          street: file.dosya_sokak,
          buildingNo: file.dosya_binano,
          apartmentNo: file.dosya_daireno,
          addressNo: file.dosya_adresno,
          cardNo: file.dosya_kartno,
          evaluationScore: file.dosya_inceleme_puani,
          createdAt: formatDate(file.dosya_created_at),
          updatedAt: formatDate(file.dosya_updated_at),
        },
        person: {
          personId: primaryBeneficiary.birey_id.toString(),
          relation: formatRelation(primaryBeneficiary.yakinligi),
          cardNo: file.dosyano || file.file_id.toString(),
          fileApplicationDate: formatDate(file.dosya_muracaat_tarihi),
          fileCardNo: file.dosya_kartno || '',
          evaluationScore: file.dosya_inceleme_puani,
          nationality: primaryBeneficiary.uyrugu || 'TC',
          identityNumber: primaryBeneficiary.tckimlikno || '-',
          firstName,
          lastName,
          fatherName: firstTextOrDash(primaryBeneficiary.babaadi),
          motherName: firstTextOrDash(primaryBeneficiary.anaadi),
          birthPlace: firstTextOrDash(primaryBeneficiary.dogumyeri),
          birthDate: formatDate(primaryBeneficiary.dogumtarihi),
          deathDate: formatDate(primaryBeneficiary.olumtarihi),
          gender: formatGender(primaryBeneficiary.cinsiyeti),
          maritalStatus: formatMaritalStatus(primaryBeneficiary.medenihali),
          mobilePhone: firstTextOrDash(primaryBeneficiary.ceptel, file.dosya_telefon),
          familyType: formatCode(file.dosya_aile_niteligi),
          neighborhood: firstTextOrDash(
            primaryBeneficiary.nfmahkoy,
            file.dosya_mahalleadi,
            primaryBeneficiary.nfilce,
            extractNeighborhood(primaryBeneficiary.adres || file.dosya_adres)
          ),
          avenue: file.dosya_cadde || '',
          street: file.dosya_sokak || '',
          buildingNo: file.dosya_binano || '',
          apartmentNo: file.dosya_daireno || '',
          addressNo: primaryBeneficiary.adresno || file.dosya_adresno || '',
          address: firstTextOrDash(primaryBeneficiary.adres, file.dosya_adres),
          photoInitials: initials(`${firstName} ${lastName}`).toLocaleUpperCase('tr-TR'),
          photoUrl,
        },
        household: rows.map((beneficiary, index) => {
          const nameParts = beneficiaryNameParts(beneficiary)
          const isPrimaryBeneficiary = beneficiary.birey_id === primaryBeneficiary.birey_id

          return {
            beneficiaryId: beneficiary.birey_id.toString(),
            no: String(index + 1),
            relation: formatRelation(beneficiary.yakinligi),
            identityNumber: beneficiary.tckimlikno || '-',
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            birthDate: formatDate(beneficiary.dogumtarihi),
            birthPlace: firstTextOrDash(beneficiary.dogumyeri),
            gender: beneficiary.cinsiyeti || '-',
            nationality: beneficiary.uyrugu || 'TC',
            fatherName: firstTextOrDash(beneficiary.babaadi),
            motherName: firstTextOrDash(beneficiary.anaadi),
            maritalStatus: formatMaritalStatus(beneficiary.medenihali),
            health: formatCode(beneficiary.saglikdurumu),
            mobilePhone: firstTextOrDash(beneficiary.ceptel, isPrimaryBeneficiary ? file.dosya_telefon : null),
            district: firstTextOrDash(beneficiary.nfilce),
            neighborhood: firstTextOrDash(
              beneficiary.nfmahkoy,
              isPrimaryBeneficiary ? file.dosya_mahalleadi : null,
              extractNeighborhood(beneficiary.adres || (isPrimaryBeneficiary ? file.dosya_adres : null))
            ),
            addressNo: firstTextOrDash(beneficiary.adresno, isPrimaryBeneficiary ? file.dosya_adresno : null),
            address: firstTextOrDash(beneficiary.adres, isPrimaryBeneficiary ? file.dosya_adres : null),
            deathDate: formatDate(beneficiary.olumtarihi),
            status: beneficiary.tipi,
          }
        }),
        applications,
        assistances,
        externalAids,
        notes,
      },
      addressRefresh,
    })
  } catch (error) {
    console.error('GET Document Fetch Error:', error)
    return NextResponse.json({ success: false, error: 'Dosya bilgileri alınırken hata oluştu.' }, { status: 500 })
  }
}
