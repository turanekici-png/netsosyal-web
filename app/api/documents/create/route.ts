import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'
import { moveActiveNakitApplicationWithPerson } from '@/lib/db/nakitApplicationTransfer'
import { normalizeTrPhoneOrNull } from '@/lib/phone'

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

type CreateDocumentPayload = {
  fileNo?: string
  status?: number | string
  familyType?: number | string
  address?: string
  phone?: string
  description?: string
  applicant: PersonInput
  household?: PersonInput[]
  // Kullanici istegi: "Seçili Bireye Yeni Dosya Oluştur" akışında (bkz.
  // app/(modules)/documents/page.tsx -> handleCreateFileForSelectedHousehold),
  // bireyin kendi telefonu VE aktif bir nakit yardımı müracaatının telefonu
  // da yoksa, telefon numarası OLMADAN dosya acilabilsin isteniyor - bu
  // yuzden telefon zorunlulugu artik OPT-IN bir bayrakla devre disi
  // birakilabiliyor. Varsayilan (gonderilmezse) DAVRANIS DEGISMEZ - telefon
  // hala zorunludur (mevcut tum diger cagiranlar icin).
  requirePhone?: boolean
}

type CreatedFileRow = {
  id: bigint
  dosyano: string
}

type ExistingPersonRow = {
  id: bigint
}

function clean(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

// Kullanici istegi (Eylul 2026): dosya/birey/muracaat telefonlari HER ZAMAN
// tek "0" ile baslar, aralarinda bosluk/ozel karakter olmaz (bkz. lib/phone.ts).
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

async function getNextFileNo() {
  const rows = await prisma.$queryRaw<Array<{ next_no: string }>>`
    SELECT LPAD((COALESCE(MAX(NULLIF(regexp_replace(dosyano, '[^0-9]', '', 'g'), '')::int), 0) + 1)::text, 5, '0') AS next_no
    FROM dosyalar;
  `

  return rows[0]?.next_no ?? '00001'
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.create', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = (await request.json()) as CreateDocumentPayload
    const applicant = payload.applicant ?? {}

    if (!clean(applicant.firstName) || !clean(applicant.lastName)) {
      return NextResponse.json(
        { success: false, error: 'Ad ve soyad zorunludur.' },
        { status: 400 }
      )
    }

    if (payload.requirePhone !== false && !clean(applicant.phone)) {
      return NextResponse.json(
        { success: false, error: 'Dosya sahibinin cep telefonu numarası zorunludur.' },
        { status: 400 }
      )
    }

    const fileNo = clean(payload.fileNo) ?? await getNextFileNo()
    const requestAddress = clean(payload.address) ?? clean(applicant.address)
    const requestPhone = cleanPhone(payload.phone) ?? cleanPhone(applicant.phone)
    const familyType = clean(applicant.tc)?.startsWith('9') ? 4 : (cleanNumber(payload.familyType) ?? 1)
    const allPeople = [applicant, ...(payload.household ?? [])].filter((person) => {
      return clean(person.firstName) || clean(person.lastName) || clean(person.tc)
    })

    const createdFile = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const fileRows = await tx.$queryRaw<CreatedFileRow[]>`
        INSERT INTO dosyalar (dosyano, durumu, aileniteligi, muracaattarihi, adres, telefon, mahalleadi, cadde, sokak, binano, daireno, adresno, aciklama, ilkislemtarihi, islemtarihi)
        VALUES (
          ${fileNo},
          0,
          ${familyType},
          CURRENT_DATE,
          ${requestAddress},
          ${requestPhone},
          ${clean(applicant.neighborhood)},
          ${clean(applicant.avenue)},
          ${clean(applicant.street)},
          ${clean(applicant.buildingNo)},
          ${clean(applicant.apartmentNo)},
          ${clean(applicant.addressNo)},
          ${clean(payload.description)},
          NOW(),
          NOW()
        )
        RETURNING id, dosyano;
      `

      const file = fileRows[0]

      for (const person of allPeople) {
        const relation = person === applicant ? 0 : cleanRelation(person.relation)
        const personType = relation === 0 ? 1 : 0
        const personId = cleanBigInt(person.id)
        if (personId) {
          const movedCount = await tx.$executeRaw`
            UPDATE bireyler
            SET
              dosyaid = ${file.id},
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
              adres = ${clean(person.address) ?? requestAddress},
              adresno = ${clean(person.addressNo)},
              tipi = ${personType},
              islemtarihi = NOW()
            WHERE id = ${personId};
          `

          if (Number(movedCount) > 0) {
            // Kullanici istegi: bu birey (id eslesmesiyle) baska bir
            // dosyadan BURAYA (yeni acilan dosyaya) tasindi - o bireyin
            // TC'sine ait durumu=0 nakit muracaati varsa, o da BİRLİKTE
            // tasinsin (bkz. lib/db/nakitApplicationTransfer.ts).
            await moveActiveNakitApplicationWithPerson(tx, clean(person.tc), file.id)
            continue
          }
        }

        const identityNumber = clean(person.tc)
        if (identityNumber) {
          const movedRows = await tx.$queryRaw<ExistingPersonRow[]>`
            UPDATE bireyler
            SET
              dosyaid = ${file.id},
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
              adres = ${clean(person.address) ?? requestAddress},
              adresno = ${clean(person.addressNo)},
              tipi = ${personType},
              islemtarihi = NOW()
            WHERE tckimlikno = ${identityNumber}
               OR regexp_replace(COALESCE(tckimlikno, ''), '[^0-9]', '', 'g') = ${identityNumber}
            RETURNING id;
          `

          if (movedRows[0]?.id) {
            // Kullanici istegi: bu birey (TC eslesmesiyle) baska bir
            // dosyadan BURAYA tasindi - o bireyin TC'sine ait durumu=0
            // nakit muracaati varsa, o da BİRLİKTE tasinsin.
            await moveActiveNakitApplicationWithPerson(tx, identityNumber, file.id)
            continue
          }
        }

        await tx.$executeRaw`
          INSERT INTO bireyler (
            dosyaid, tckimlikno, adi, soyadi, babaadi, anaadi, dogumyeri, dogumtarihi, olumtarihi,
            medenihali, cinsiyeti, uyrugu, yakinligi, nfilce, nfmahkoy, ceptel,
            adisoyadi, adres, adresno, tipi, ilkislemtarihi, islemtarihi
          )
          VALUES (
            ${file.id},
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
            ${clean(person.address) ?? requestAddress},
            ${clean(person.addressNo)},
            ${personType},
            NOW(),
            NOW()
          );
        `
      }

      return file
    })

    return NextResponse.json({
      success: true,
      data: {
        fileId: createdFile.id.toString(),
        fileNo: createdFile.dosyano,
      },
    })
  } catch (error) {
    console.error('Create document error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Dosya olusturulamadi.' },
      { status: 500 }
    )
  }
}
