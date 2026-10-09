import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'
import { moveActiveNakitApplicationWithPerson } from '@/lib/db/nakitApplicationTransfer'

export const dynamic = 'force-dynamic'

type TransferPersonRow = {
  beneficiary_id: bigint
  old_file_id: bigint | null
  old_file_no: string | null
  relation: number | null
  identity_number: string | null
  first_name: string | null
  last_name: string | null
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
    const beneficiaryId = cleanBigInt(payload.beneficiaryId)
    const targetFileId = cleanBigInt(payload.targetFileId)
    const relation = cleanNumber(payload.relation)

    if (!beneficiaryId || !targetFileId) {
      return NextResponse.json({ success: false, error: 'Birey ve hedef dosya bilgisi zorunludur.' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const targetFiles = await tx.$queryRaw<{ id: bigint; dosyano: string | null }[]>`
        SELECT id, dosyano
        FROM dosyalar
        WHERE id = ${targetFileId}
        LIMIT 1;
      `
      const targetFile = targetFiles[0]

      if (!targetFile) {
        return { error: 'Hedef dosya bulunamadı.', status: 404 as const }
      }

      const people = await tx.$queryRaw<TransferPersonRow[]>`
        SELECT
          b.id AS beneficiary_id,
          b.dosyaid AS old_file_id,
          d.dosyano AS old_file_no,
          b.yakinligi AS relation,
          b.tckimlikno AS identity_number,
          b.adi AS first_name,
          b.soyadi AS last_name
        FROM bireyler b
        LEFT JOIN dosyalar d ON d.id = b.dosyaid
        WHERE b.id = ${beneficiaryId}
        LIMIT 1;
      `
      const person = people[0]

      if (!person) {
        return { error: 'Taşınacak birey bulunamadı.', status: 404 as const }
      }

      if (person.old_file_id === targetFileId) {
        if (relation !== null) {
          await tx.$executeRaw`
            UPDATE bireyler
            SET yakinligi = ${relation},
                tipi = ${relation},
                islemtarihi = NOW()
            WHERE id = ${beneficiaryId};
          `
        }

        return {
          data: {
            beneficiaryId: person.beneficiary_id.toString(),
            oldFileId: person.old_file_id?.toString() ?? '',
            oldFileNo: person.old_file_no ?? '',
            newFileId: targetFile.id.toString(),
            newFileNo: targetFile.dosyano ?? '',
            relation: relation === null ? (person.relation === null || person.relation === undefined ? '' : String(person.relation)) : String(relation),
            identityNumber: person.identity_number ?? '',
            firstName: person.first_name ?? '',
            lastName: person.last_name ?? '',
            alreadyInTarget: true,
          },
        }
      }

      await tx.$executeRaw`
        UPDATE bireyler
        SET dosyaid = ${targetFileId},
            yakinligi = COALESCE(${relation}, yakinligi),
            tipi = COALESCE(${relation}, tipi),
            islemtarihi = NOW()
        WHERE id = ${beneficiaryId};
      `

      // Kullanici istegi (kesin akis): bir birey baska bir dosyaya
      // tasindiginda, o bireyin TC'sine ait DURUMU=0 ("Yeni Müracaat") bir
      // Nakit Yardımı müracaatı VARSA, o da bireyle BİRLİKTE yeni dosyaya
      // tasinir - bkz. lib/db/nakitApplicationTransfer.ts (AYNI paylasilan
      // mantik app/api/documents/update/route.ts -> upsertPerson()'daki
      // "sessiz tasima" yollarinda da kullanilir).
      const movedNakitRecordId = await moveActiveNakitApplicationWithPerson(tx, person.identity_number, targetFileId)

      return {
        data: {
          beneficiaryId: person.beneficiary_id.toString(),
          oldFileId: person.old_file_id?.toString() ?? '',
          oldFileNo: person.old_file_no ?? '',
          newFileId: targetFile.id.toString(),
          newFileNo: targetFile.dosyano ?? '',
          relation: relation === null ? (person.relation === null || person.relation === undefined ? '' : String(person.relation)) : String(relation),
          identityNumber: person.identity_number ?? '',
          firstName: person.first_name ?? '',
          lastName: person.last_name ?? '',
          alreadyInTarget: false,
          movedNakitRecordId,
        },
      }
    })

    if ('error' in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, data: result.data })
  } catch (error) {
    console.error('Transfer person error:', error)
    return NextResponse.json({ success: false, error: 'Birey dosyaya taşınamadı.' }, { status: 500 })
  }
}
