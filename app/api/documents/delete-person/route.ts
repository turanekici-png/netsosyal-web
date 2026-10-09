import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { requireDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type DeletedPersonRow = {
  id: bigint
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

function cleanIdentityNumber(value: unknown) {
  return clean(value).replace(/\D/g, '')
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.delete', page: '/documents' })
    if (accessDenied) return accessDenied

    const destructiveDenied = await requireDestructiveAuthorization(request)
    if (destructiveDenied) return destructiveDenied

    const payload = await request.json()
    const fileId = cleanBigInt(payload.fileId)
    const beneficiaryId = cleanBigInt(payload.beneficiaryId)
    const identityNumber = cleanIdentityNumber(payload.identityNumber)

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'Dosya bilgisi zorunludur.' }, { status: 400 })
    }

    if (!beneficiaryId && !/^\d{11}$/.test(identityNumber)) {
      return NextResponse.json({ success: false, error: 'Silinecek birey bilgisi zorunludur.' }, { status: 400 })
    }

    const deletedRows = await withAuditedWrite((tx) => (
      beneficiaryId
        ? tx.$queryRaw<DeletedPersonRow[]>`
            DELETE FROM bireyler
            WHERE id = ${beneficiaryId}
              AND dosyaid = ${fileId}
              AND COALESCE(yakinligi, -1) <> 0
            RETURNING id;
          `
        : tx.$queryRaw<DeletedPersonRow[]>`
            DELETE FROM bireyler
            WHERE dosyaid = ${fileId}
              AND COALESCE(yakinligi, -1) <> 0
              AND (
                tckimlikno = ${identityNumber}
                OR regexp_replace(COALESCE(tckimlikno, ''), '[^0-9]', '', 'g') = ${identityNumber}
              )
            RETURNING id;
          `
    ), getAuditMetaFromRequest(request))

    if (deletedRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek hane bireyi bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        deletedIds: deletedRows.map((row) => row.id.toString()),
      },
    })
  } catch (error) {
    console.error('Delete person error:', error)
    return NextResponse.json({ success: false, error: 'Birey silinemedi.' }, { status: 500 })
  }
}
