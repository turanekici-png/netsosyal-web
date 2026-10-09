import { NextResponse } from 'next/server'
import { requireApiAccess, getSessionUser } from '@/lib/apiAuth'
import { reportService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

// GET all reports (with optional filtering)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const requestId = searchParams.get('requestId')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    let reports
    if (requestId) {
      reports = await reportService.getByRequest(requestId)
    } else {
      reports = await reportService.getAll(skip, limit)
    }

    return NextResponse.json({
      success: true,
      data: reports,
      pagination: { page, limit },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// CREATE report
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'reports.view', page: '/reports' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    
    if (!body.requestId) {
      return NextResponse.json(
        { success: false, error: 'requestId zorunludur.' },
        { status: 400 }
      )
    }

    const sessionUser = await getSessionUser()
    const currentUserId = sessionUser?.id ? Number(sessionUser.id) : null

    const newReport = await withAuditedWrite((tx) => reportService.create({
      requestId: body.requestId,
      title: body.title,
      content: body.content,
      date: body.date ? new Date(body.date) : new Date(),
      kullaniciid: Number.isInteger(currentUserId) ? currentUserId : null,
    }, tx), getAuditMetaFromRequest(request))

    return NextResponse.json(
      { success: true, data: newReport },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// UPDATE report
export async function PATCH(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'reports.view', page: '/reports' })
    if (accessDenied) return accessDenied

    const body = await request.json()

    if (!body.id) {
      return NextResponse.json(
        { success: false, error: 'id zorunludur.' },
        { status: 400 }
      )
    }

    const sessionUser = await getSessionUser()
    const currentUserId = sessionUser?.id ? Number(sessionUser.id) : null

    const updatedReport = await withAuditedWrite((tx) => reportService.update(body.id, {
      requestId: body.requestId,
      title: body.title,
      content: body.content,
      date: body.date ? new Date(body.date) : undefined,
      kullaniciid: Number.isInteger(currentUserId) ? currentUserId : undefined,
    }, tx), getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: updatedReport })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// DELETE report
export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'reports.view', page: '/reports' })
    if (accessDenied) return accessDenied

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id zorunludur.' },
        { status: 400 }
      )
    }

    await withAuditedWrite(
      (tx) => reportService.delete(id, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
