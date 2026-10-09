import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

// GET all users
export async function GET(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'users.manage', page: '/users' })
    if (accessDenied) return accessDenied

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const users = await userService.getAll(skip, limit)

    return NextResponse.json({
      success: true,
      data: users,
      pagination: { page, limit },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// CREATE user
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'users.manage', page: '/users' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const user = await withAuditedWrite(
      (tx) => userService.create(body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json(
      { success: true, data: user },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
