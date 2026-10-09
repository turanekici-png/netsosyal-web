import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { documentService } from '@/lib/services'

export const dynamic = "force-dynamic"

type Params = {
  id: string
}

// GET document by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/documents' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const document = await documentService.getById(id)

    if (!document) {
      return NextResponse.json(
        { success: false, error: 'Döküman bulunamadı' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: document })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// UPDATE document
export async function PUT(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.delete', page: '/documents' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const body = await request.json()
    const document = await documentService.update(id, body)

    return NextResponse.json({ success: true, data: document })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// DELETE document
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const { id } = await params
    await documentService.delete(id)

    return NextResponse.json({
      success: true,
      message: 'Döküman silindi',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
