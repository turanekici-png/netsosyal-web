import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type AssignPersonnelPayload = {
  ids?: Array<string | number>
  personnel?: string
}

function normalizeIds(ids: AssignPersonnelPayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

export async function PATCH(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/assistance/nakit' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as AssignPersonnelPayload
  const ids = normalizeIds(payload.ids)
  const personnel = String(payload.personnel || '').trim()

  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Personel atanacak kayit secilmedi.' }, { status: 400 })
  }

  if (!personnel) {
    return NextResponse.json({ success: false, error: 'Personel secimi zorunludur.' }, { status: 400 })
  }

  if (personnel.length > 100) {
    return NextResponse.json({ success: false, error: 'Personel adi 100 karakterden uzun olamaz.' }, { status: 400 })
  }

  try {
    const result = await withAuditedWrite((tx) => tx.assistance.updateMany({
      where: {
        id: {
          in: ids.map((id) => BigInt(id)),
        },
      },
      data: {
        tahkikatpers: personnel,
      },
    }), getAuditMetaFromRequest(request))

    return NextResponse.json({
      success: true,
      data: {
        requested: ids.length,
        updated: result.count,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Personel atanamadi.' },
      { status: 500 },
    )
  }
}
