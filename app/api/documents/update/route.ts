import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'
import { moveActiveNakitApplicationWithPerson } from '@/lib/db/nakitApplicationTransfer'
import { normalizeTrPhoneOrNull } from '@/lib/phone'
import { regeocodeFileLocationInBackground } from '@/lib/services/fileLocation.service'

export const dynamic = 'force-dynamic'

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
  maritalStatus?: string
  nationality?: string
  relation?: string
  phone?: string
  neighborhood?: string
  district?: string
  avenue?: string
  street?: string
  buildingNo?: string
  apartmentNo?: string
  addressNo?: string
  address?: string
}

type UpdateDocumentPayload = {
  fileId?: string
  fileNo?: string
  status?: number | string
  familyType?: number | string
  address?: string
  phone?: string
  description?: string
  applicant: PersonInput
  household?: PersonInput[]
}

type ExistingPersonRow = {
  id: bigint
}

type RawSqlClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number | bigint>
  $queryRaw: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>
}

function clean(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' || text === '-' ? null : text
}

// Kullanici istegi (Eylul 2026): telefonlar HER ZAMAN tek "0" ile baslar,
// aralarinda bosluk/ozel karakter olmaz (bkz. lib/phone.ts).
function cleanPhone(value: unknown) {
  return normalizeTrPhoneOrNull(clean(value))
}

function cleanNumber(value: unknown) {
  const cleaned = clean(value)
  if (cleaned === null) return null
  const numberValue = Number(cleaned)
  return Number.isFinite(numberValue) ? numberValue : null
}

function cleanRelation(value: unknown) {
  const numericValue = cleanNumber(value)
  if (numericValue !== null) return numericValue

  const normalized = clean(value)?.toLocaleLowerCase('tr-TR')
  if (normalized === 'kendisi') return 0
  if (normalized === 'eşi' || normalized === 'esi') return 1
  if (normalized === 'oğlu' || normalized === 'oglu') return 2
  if (normalized === 'kızı' || normalized === 'kizi') return 3
  if (normalized === 'annesi') return 4
  if (normalized === 'babası' || normalized === 'babasi') return 5
  return null
}

function cleanMaritalStatus(value: unknown) {
  const numericValue = cleanNumber(value)
  if (numericValue !== null) return numericValue

  const normalized = clean(value)
    ?.toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ü', 'u')
    .replaceAll('ğ', 'g')
    .replaceAll('ç', 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (!normalized) return null
  if (normalized.includes('bekar') || normalized.includes('single')) return 1
  if (normalized.includes('evli') || normalized.includes('married')) return 2
  if (normalized.includes('dul')) return 3
  if (normalized.includes('bosan') || normalized.includes('boşan') || normalized.includes('divorc')) return 4

  return null
}

function cleanDate(value: unknown) {
  const cleaned = clean(value)
  if (cleaned === null) return null
  return cleaned
}

function cleanBigInt(value: unknown) {
  const cleaned = clean(value)
  if (cleaned === null) return null

  try {
    return BigInt(cleaned)
  } catch {
    return null
  }
}

function fullName(person: PersonInput) {
  return [clean(person.firstName), clean(person.lastName)].filter(Boolean).join(' ') || clean(person.tc) || null
}

async function upsertPerson(tx: RawSqlClient, fileId: bigint, person: PersonInput) {
  const personId = cleanBigInt(person.id)
  const relation = cleanRelation(person.relation)
  const personType = relation === 0 ? 1 : 0

  if (personId) {
    const updatedCount = await tx.$executeRaw`
      UPDATE bireyler
      SET
        tckimlikno = ${clean(person.tc)},
        adi = ${clean(person.firstName)},
        soyadi = ${clean(person.lastName)},
        babaadi = ${clean(person.fatherName)},
        anaadi = ${clean(person.motherName)},
        dogumyeri = ${clean(person.birthPlace)},
        dogumtarihi = ${cleanDate(person.birthDate)}::date,
        olumtarihi = ${cleanDate(person.deathDate)}::date,
        medenihali = ${cleanMaritalStatus(person.maritalStatus)},
        cinsiyeti = ${clean(person.gender)},
        uyrugu = ${clean(person.nationality) ?? 'TC'},
        yakinligi = ${relation},
        nfilce = ${clean(person.district)},
        nfmahkoy = ${clean(person.neighborhood)},
        ceptel = ${cleanPhone(person.phone)},
        adisoyadi = ${fullName(person)},
        adres = ${clean(person.address)},
        adresno = ${clean(person.addressNo)},
        tipi = ${personType},
        islemtarihi = NOW()
      WHERE id = ${personId}
        AND dosyaid = ${fileId};
    `

    if (Number(updatedCount) > 0) {
      return personId
    }

    const movedCount = await tx.$executeRaw`
      UPDATE bireyler
      SET
        dosyaid = ${fileId},
        tckimlikno = ${clean(person.tc)},
        adi = ${clean(person.firstName)},
        soyadi = ${clean(person.lastName)},
        babaadi = ${clean(person.fatherName)},
        anaadi = ${clean(person.motherName)},
        dogumyeri = ${clean(person.birthPlace)},
        dogumtarihi = ${cleanDate(person.birthDate)}::date,
        olumtarihi = ${cleanDate(person.deathDate)}::date,
        medenihali = ${cleanMaritalStatus(person.maritalStatus)},
        cinsiyeti = ${clean(person.gender)},
        uyrugu = ${clean(person.nationality) ?? 'TC'},
        yakinligi = ${relation},
        nfilce = ${clean(person.district)},
        nfmahkoy = ${clean(person.neighborhood)},
        ceptel = ${cleanPhone(person.phone)},
        adisoyadi = ${fullName(person)},
        adres = ${clean(person.address)},
        adresno = ${clean(person.addressNo)},
        tipi = ${personType},
        islemtarihi = NOW()
      WHERE id = ${personId};
    `

    if (Number(movedCount) > 0) {
      // Kullanici istegi: bu birey (id eslesmesiyle) baska bir dosyadan
      // BURAYA tasindi - o bireyin TC'sine ait durumu=0 nakit muracaati
      // varsa, o da BİRLİKTE tasinsin (bkz. lib/db/nakitApplicationTransfer.ts
      // - AYNI kural app/api/documents/transfer-person/route.ts'te de
      // kullaniliyor).
      await moveActiveNakitApplicationWithPerson(tx, clean(person.tc), fileId)
      return personId
    }
  }

  const identityNumber = clean(person.tc)
  if (identityNumber) {
    const movedRows = await tx.$queryRaw<ExistingPersonRow[]>`
      UPDATE bireyler
      SET
        dosyaid = ${fileId},
        tckimlikno = ${identityNumber},
        adi = ${clean(person.firstName)},
        soyadi = ${clean(person.lastName)},
        babaadi = ${clean(person.fatherName)},
        anaadi = ${clean(person.motherName)},
        dogumyeri = ${clean(person.birthPlace)},
        dogumtarihi = ${cleanDate(person.birthDate)}::date,
        olumtarihi = ${cleanDate(person.deathDate)}::date,
        medenihali = ${cleanMaritalStatus(person.maritalStatus)},
        cinsiyeti = ${clean(person.gender)},
        uyrugu = ${clean(person.nationality) ?? 'TC'},
        yakinligi = ${relation},
        nfilce = ${clean(person.district)},
        nfmahkoy = ${clean(person.neighborhood)},
        ceptel = ${cleanPhone(person.phone)},
        adisoyadi = ${fullName(person)},
        adres = ${clean(person.address)},
        adresno = ${clean(person.addressNo)},
        tipi = ${personType},
        islemtarihi = NOW()
      WHERE tckimlikno = ${identityNumber}
         OR regexp_replace(COALESCE(tckimlikno, ''), '[^0-9]', '', 'g') = ${identityNumber}
      RETURNING id;
    `

    if (movedRows[0]?.id) {
      // Kullanici istegi: bu birey (TC eslesmesiyle) baska bir dosyadan
      // BURAYA tasindi - o bireyin TC'sine ait durumu=0 nakit muracaati
      // varsa, o da BİRLİKTE tasinsin.
      await moveActiveNakitApplicationWithPerson(tx, identityNumber, fileId)
      return movedRows[0].id
    }
  }

  const insertedRows = await tx.$queryRaw<ExistingPersonRow[]>`
    INSERT INTO bireyler (
      dosyaid, tckimlikno, adi, soyadi, babaadi, anaadi, dogumyeri, dogumtarihi, olumtarihi,
      medenihali, cinsiyeti, uyrugu, yakinligi, nfilce, nfmahkoy, ceptel,
      adisoyadi, adres, adresno, tipi, ilkislemtarihi, islemtarihi
    )
    VALUES (
      ${fileId},
      ${clean(person.tc)},
      ${clean(person.firstName)},
      ${clean(person.lastName)},
      ${clean(person.fatherName)},
      ${clean(person.motherName)},
      ${clean(person.birthPlace)},
      ${cleanDate(person.birthDate)}::date,
      ${cleanDate(person.deathDate)}::date,
      ${cleanMaritalStatus(person.maritalStatus)},
      ${clean(person.gender)},
      ${clean(person.nationality) ?? 'TC'},
      ${relation},
      ${clean(person.district)},
      ${clean(person.neighborhood)},
      ${cleanPhone(person.phone)},
      ${fullName(person)},
      ${clean(person.address)},
      ${clean(person.addressNo)},
      ${personType},
      NOW(),
      NOW()
    )
    RETURNING id;
  `

  return insertedRows[0]?.id ?? null
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = (await request.json()) as UpdateDocumentPayload
    const fileId = cleanBigInt(payload.fileId)
    const applicant = payload.applicant ?? {}

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'Güncellenecek dosya bulunamadı.' }, { status: 400 })
    }

    if (!clean(applicant.firstName) || !clean(applicant.lastName)) {
      return NextResponse.json({ success: false, error: 'Ad ve soyad zorunludur.' }, { status: 400 })
    }

    if (!clean(applicant.phone)) {
      return NextResponse.json(
        { success: false, error: 'Dosya sahibinin cep telefonu numarası zorunludur.' },
        { status: 400 }
      )
    }

    const requestAddress = clean(payload.address) ?? clean(applicant.address)
    const requestPhone = cleanPhone(payload.phone) ?? cleanPhone(applicant.phone)
    const familyType = clean(applicant.tc)?.startsWith('9') ? 4 : (cleanNumber(payload.familyType) ?? 1)
    const people = [applicant, ...(payload.household ?? [])].filter((person) => (
      clean(person.firstName) || clean(person.lastName) || clean(person.tc) || clean(person.id)
    ))

    await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      await tx.$executeRaw`
        UPDATE dosyalar
        SET
          dosyano = ${clean(payload.fileNo)},
          durumu = ${cleanNumber(payload.status) ?? 0},
          aileniteligi = ${familyType},
          adres = ${requestAddress},
          telefon = ${requestPhone},
          mahalleadi = ${clean(applicant.neighborhood)},
          cadde = ${clean(applicant.avenue)},
          sokak = ${clean(applicant.street)},
          binano = ${clean(applicant.buildingNo)},
          daireno = ${clean(applicant.apartmentNo)},
          adresno = ${clean(applicant.addressNo)},
          aciklama = ${clean(payload.description)},
          islemtarihi = NOW(),
          -- Kullanici istegi: adres burada degistigi icin ESKI konum ARTIK
          -- GUVENILIR DEGIL - "ok" damgasi kaldirilir ki (aşağıda islem
          -- basarili olduktan sonra tetiklenen regeocodeFileLocationInBackground
          -- her nedense basarisiz olsa/gecikse bile) harita eski/yanlis
          -- adresin konumunu göstermeye devam ETMESIN.
          konum_durumu = NULL,
          konum_enlem = NULL,
          konum_boylam = NULL,
          konum_kaynagi = NULL,
          konum_guven = NULL,
          konum_hata = NULL,
          konum_adres_hash = NULL
        WHERE id = ${fileId};
      `

      const keptIds: bigint[] = []
      for (const person of people) {
        const savedId = await upsertPerson(tx, fileId, person === applicant ? { ...person, relation: '0' } : person)
        if (savedId) {
          keptIds.push(savedId)
        }
      }

      const existingRows = await tx.$queryRaw<ExistingPersonRow[]>`
        SELECT id
        FROM bireyler
        WHERE dosyaid = ${fileId};
      `
      const keptIdSet = new Set(keptIds.map((id) => id.toString()))

      for (const row of existingRows) {
        if (!keptIdSet.has(row.id.toString())) {
          await tx.$executeRaw`
            DELETE FROM bireyler
            WHERE id = ${row.id}
              AND dosyaid = ${fileId};
          `
        }
      }

      await tx.$executeRaw`
        UPDATE bireyler
        SET tipi = CASE WHEN yakinligi = 0 THEN 1 ELSE 0 END,
            islemtarihi = NOW()
        WHERE dosyaid = ${fileId}
          AND tipi IS DISTINCT FROM CASE WHEN yakinligi = 0 THEN 1 ELSE 0 END;
      `
    })

    // Adres az once degisti (yukarida konum alanlari NULL'landi) - yeni
    // konum, yaniti BEKLETMEDEN arka planda hesaplanip kaydedilir (once Kent
    // Rehberi, o basarisiz olursa Google/Nominatim - bkz. fileLocation.service.ts).
    regeocodeFileLocationInBackground(fileId, getAuditMetaFromRequest(request))

    return NextResponse.json({
      success: true,
      data: {
        fileId: fileId.toString(),
      },
    })
  } catch (error) {
    console.error('Update document error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Dosya güncellenemedi.' },
      { status: 500 }
    )
  }
}
