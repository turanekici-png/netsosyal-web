import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { userService } from '@/lib/services'

export const dynamic = 'force-dynamic'

type DocumentNotificationRow = {
  id: bigint
  file_id: bigint | null
  file_no: string | null
  owner_name: string | null
  document_title: string | null
  completed_date: Date | null
}

function formatDate(value: Date | null) {
  if (!value) return '-'
  return value.toLocaleDateString('tr-TR')
}

export async function GET() {
  try {
    const currentUser = await userService.getCurrent()
    const requesterName = currentUser?.name || ''
    const requesterUsername = currentUser?.username || ''

    if (!requesterName && !requesterUsername) {
      return NextResponse.json({ success: true, data: [] })
    }

    const rows = await prisma.$queryRaw<DocumentNotificationRow[]>`
      SELECT
        e.id::bigint AS id,
        COALESCE(e.dosyaid, d.id)::bigint AS file_id,
        COALESCE(e.dosyano, d.dosyano) AS file_no,
        e.adisoyadi AS owner_name,
        e.evrak_adi AS document_title,
        COALESCE(e.tamamlanma_tarihi, e.updated_at, e.created_at) AS completed_date
      FROM beklenen_evraklar e
      LEFT JOIN dosyalar d ON d.id = e.dosyaid
      WHERE e.durum = 'tamamlandi'
        AND (
          (${requesterName} <> '' AND e.isteyen_kullanici = ${requesterName})
          OR (${requesterUsername} <> '' AND e.isteyen_kullanici = ${requesterUsername})
        )
      ORDER BY COALESCE(e.tamamlanma_tarihi, e.updated_at, e.created_at) DESC NULLS LAST, e.id DESC
      LIMIT 20
    `

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id.toString(),
        fileId: row.file_id === null ? null : row.file_id.toString(),
        fileNo: row.file_no || '-',
        ownerName: row.owner_name || '-',
        documentTitle: row.document_title || '-',
        completedDate: formatDate(row.completed_date),
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Bildirimler alinamadi.' },
      { status: 500 },
    )
  }
}
