import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { reportService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

type Params = {
  id: string
}

// GET report by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'reports.view', page: '/reports' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const report = await reportService.getById(id)

    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Rapor bulunamadı' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: report })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// UPDATE report
export async function PUT(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'reports.view', page: '/reports' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const body = await request.json()
    const report = await withAuditedWrite(
      (tx) => reportService.update(id, body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true, data: report })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// DELETE report
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const { id } = await params
    await withAuditedWrite(
      (tx) => reportService.delete(id, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      message: 'Rapor silindi',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
