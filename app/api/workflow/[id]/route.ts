import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { workflowService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

type Params = {
  id: string
}

// GET workflow step by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const step = await workflowService.getById(id)

    if (!step) {
      return NextResponse.json(
        { success: false, error: 'İş akışı adımı bulunamadı' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: step })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// UPDATE workflow step
export async function PUT(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.delete', page: '/workflow' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const body = await request.json()
    const step = await withAuditedWrite(
      (tx) => workflowService.update(id, body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true, data: step })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// DELETE workflow step
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const { id } = await params
    await withAuditedWrite(
      (tx) => workflowService.delete(id, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      message: 'İş akışı adımı silindi',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
