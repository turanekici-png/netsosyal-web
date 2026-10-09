import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { beneficiaryService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

type Params = {
  id: string
}

// GET beneficiary by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/beneficiary' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const beneficiary = await beneficiaryService.getById(id)

    if (!beneficiary) {
      return NextResponse.json(
        { success: false, error: 'Birey bulunamadı' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: beneficiary })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// UPDATE beneficiary
export async function PUT(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.delete', page: '/beneficiary' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const body = await request.json()
    const beneficiary = await withAuditedWrite(
      (tx) => beneficiaryService.update(id, body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true, data: beneficiary })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// DELETE beneficiary
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const { id } = await params
    await withAuditedWrite(
      (tx) => beneficiaryService.delete(id, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      message: 'Birey silindi',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
