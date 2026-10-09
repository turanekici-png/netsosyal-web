import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type DeletePayload = {
  ids?: Array<string | number>
}

function normalizeIds(ids: DeletePayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

export async function DELETE(request: NextRequest) {
  const accessDenied = await requireApiAccess({ action: 'assistance.delete', page: '/assistance/ekmek' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as DeletePayload
  const ids = normalizeIds(payload.ids)

  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Silinecek ekmek yardımı seçilmedi.' }, { status: 400 })
  }

  const pool = getSqlMonitorPool()

  try {
    const aidResult = await withAuditedPoolWrite(
      pool,
      (client) => client.query(
        `
          UPDATE yrd_ekmek
          SET durumu = 0,
              durumutarih = CURRENT_DATE,
              durumuaciklama = 'Rapor ekranindan silindi',
              islemtarihi = NOW()
          WHERE id = ANY($1::bigint[])
        `,
        [ids],
      ),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      data: {
        requested: ids.length,
        deleted: aidResult.rowCount || 0,
        mode: 'soft-delete',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Ekmek yardımı silinemedi.' },
      { status: 500 },
    )
  }
}
