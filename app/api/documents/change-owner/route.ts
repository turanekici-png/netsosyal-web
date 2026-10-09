import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type PersonOwnerRow = {
  id: bigint
  relation: number | null
  identity_number: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  neighborhood: string | null
  address_no: string | null
  address: string | null
}

function clean(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  return text === '-' ? '' : text
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

function cleanNumber(value: unknown) {
  const text = clean(value)
  if (!text) return null

  const numberValue = Number(text)
  return Number.isFinite(numberValue) ? numberValue : null
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const fileId = cleanBigInt(payload.fileId)
    const beneficiaryId = cleanBigInt(payload.beneficiaryId)
    const previousOwnerRelation = cleanNumber(payload.previousOwnerRelation)

    if (!fileId || !beneficiaryId) {
      return NextResponse.json({ success: false, error: 'Dosya ve birey bilgisi zorunludur.' }, { status: 400 })
    }

    if (previousOwnerRelation === null || previousOwnerRelation === 0) {
      return NextResponse.json({ success: false, error: 'Eski dosya sahibi için yeni yakınlık derecesi seçiniz.' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const selectedRows = await tx.$queryRaw<PersonOwnerRow[]>`
        SELECT
          id,
          yakinligi AS relation,
          tckimlikno AS identity_number,
          adi AS first_name,
          soyadi AS last_name,
          ceptel AS phone,
          nfmahkoy AS neighborhood,
          adresno AS address_no,
          adres AS address
        FROM bireyler
        WHERE id = ${beneficiaryId}
          AND dosyaid = ${fileId}
        LIMIT 1;
      `
      const selected = selectedRows[0]

      if (!selected) {
        return { error: 'Dosya sahibi yapılacak birey bulunamadı.', status: 404 as const }
      }

      if (selected.relation === 0) {
        return {
          data: {
            fileId: fileId.toString(),
            beneficiaryId: beneficiaryId.toString(),
            alreadyOwner: true,
          },
        }
      }

      const oldOwnerRows = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id
        FROM bireyler
        WHERE dosyaid = ${fileId}
          AND COALESCE(yakinligi, -1) = 0
          AND id <> ${beneficiaryId}
        ORDER BY id
        LIMIT 1;
      `
      const oldOwner = oldOwnerRows[0]

      if (oldOwner) {
        await tx.$executeRaw`
          UPDATE bireyler
          SET yakinligi = ${previousOwnerRelation},
              tipi = 0,
              islemtarihi = NOW()
          WHERE id = ${oldOwner.id}
            AND dosyaid = ${fileId};
        `
      }

      await tx.$executeRaw`
        UPDATE bireyler
        SET yakinligi = 0,
            tipi = 1,
            islemtarihi = NOW()
        WHERE id = ${beneficiaryId}
          AND dosyaid = ${fileId};
      `

      await tx.$executeRaw`
        UPDATE dosyalar
        SET telefon = ${selected.phone},
            mahalleadi = ${selected.neighborhood},
            adresno = ${selected.address_no},
            adres = ${selected.address},
            islemtarihi = NOW()
        WHERE id = ${fileId};
      `

      return {
        data: {
          fileId: fileId.toString(),
          beneficiaryId: beneficiaryId.toString(),
          oldOwnerId: oldOwner?.id.toString() ?? '',
          alreadyOwner: false,
        },
      }
    })

    if ('error' in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, data: result.data })
  } catch (error) {
    console.error('Change owner error:', error)
    return NextResponse.json({ success: false, error: 'Dosya sahibi değiştirilemedi.' }, { status: 500 })
  }
}
