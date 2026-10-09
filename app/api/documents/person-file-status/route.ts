import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

type PersonLookupInput = {
  identityNumber?: string
}

type PersonFileStatusRow = {
  beneficiary_id: bigint
  file_id: bigint | null
  file_no: string | null
  identity_number: string | null
  relation: number | null
  address_no: string | null
  address: string | null
  death_date: string | null
  first_name: string | null
  last_name: string | null
  father_name: string | null
  mother_name: string | null
  birth_place: string | null
  birth_date: Date | string | null
  gender: string | null
  marital_status: number | null
  phone: string | null
}

function clean(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  return text === '-' ? '' : text
}

function cleanIdentityNumber(value: unknown) {
  return clean(value).replace(/\D/g, '')
}

function cleanBigInt(value: unknown) {
  const text = clean(value)
  if (!text) return null

  try {
    return BigInt(text)
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.status', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const people = Array.isArray(payload.people) ? payload.people as PersonLookupInput[] : []
    const currentFileId = cleanBigInt(payload.currentFileId)
    const identityNumbers = Array.from(new Set(
      people
        .map((person) => cleanIdentityNumber(person.identityNumber))
        .filter((identityNumber) => /^\d{11}$/.test(identityNumber))
    ))

    if (identityNumbers.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    const rows: PersonFileStatusRow[] = []

    for (const identityNumber of identityNumbers) {
      const matchedRows = await prisma.$queryRaw<PersonFileStatusRow[]>`
        SELECT
          b.id AS beneficiary_id,
          b.dosyaid AS file_id,
          d.dosyano AS file_no,
          b.tckimlikno AS identity_number,
          b.yakinligi AS relation,
          b.adresno AS address_no,
          b.adres AS address,
          b.olumtarihi AS death_date,
          b.adi AS first_name,
          b.soyadi AS last_name,
          b.babaadi AS father_name,
          b.anaadi AS mother_name,
          b.dogumyeri AS birth_place,
          b.dogumtarihi AS birth_date,
          b.cinsiyeti AS gender,
          b.medenihali AS marital_status,
          b.ceptel AS phone
        FROM bireyler b
        LEFT JOIN dosyalar d ON d.id = b.dosyaid
        WHERE b.tckimlikno = ${identityNumber}
           OR regexp_replace(COALESCE(b.tckimlikno, ''), '[^0-9]', '', 'g') = ${identityNumber}
        ORDER BY
          CASE
            WHEN b.dosyaid IS NOT NULL AND (${currentFileId}::bigint IS NULL OR b.dosyaid <> ${currentFileId}) THEN 0
            WHEN ${currentFileId}::bigint IS NOT NULL AND b.dosyaid = ${currentFileId} THEN 1
            WHEN b.dosyaid IS NOT NULL THEN 2
            ELSE 3
          END,
          b.id DESC
        LIMIT 1;
      `
      rows.push(...matchedRows)
    }

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        beneficiaryId: row.beneficiary_id.toString(),
        fileId: row.file_id?.toString() ?? '',
        fileNo: row.file_no ?? '',
        identityNumber: cleanIdentityNumber(row.identity_number),
        relation: row.relation === null || row.relation === undefined ? '' : String(row.relation),
        addressNo: row.address_no ?? '',
        address: row.address ?? '',
        deathDate: row.death_date ?? '',
        firstName: row.first_name ?? '',
        lastName: row.last_name ?? '',
        fatherName: row.father_name ?? '',
        motherName: row.mother_name ?? '',
        birthPlace: row.birth_place ?? '',
        birthDate: row.birth_date instanceof Date
          ? row.birth_date.toISOString().slice(0, 10)
          : String(row.birth_date ?? '').slice(0, 10),
        gender: row.gender ?? '',
        maritalStatus: row.marital_status === null || row.marital_status === undefined ? '' : String(row.marital_status),
        phone: row.phone ?? '',
        isInCurrentFile: Boolean(currentFileId && row.file_id && row.file_id === currentFileId),
      })),
    })
  } catch (error) {
    console.error('Person file status error:', error)
    return NextResponse.json({ success: false, error: 'Kişilerin dosya bilgisi alınamadı.' }, { status: 500 })
  }
}
