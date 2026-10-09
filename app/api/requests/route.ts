import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { requestService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

// GET all requests
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const requests = await requestService.getAll(skip, limit)

    return NextResponse.json({
      success: true,
      data: requests,
      pagination: { page, limit },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// CREATE request
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'requests.create', page: '/requests' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const newRequest = await withAuditedWrite(
      (tx) => requestService.create(body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json(
      { success: true, data: newRequest },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
