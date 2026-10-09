import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { workflowService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

// GET all workflow steps
export async function GET(request: Request) {
  try {
    const steps = await workflowService.getAll()

    return NextResponse.json({
      success: true,
      data: steps,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// CREATE workflow step
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const step = await withAuditedWrite(
      (tx) => workflowService.create(body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json(
      { success: true, data: step },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
