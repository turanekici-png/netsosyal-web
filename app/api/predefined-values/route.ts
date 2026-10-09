import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'

export const dynamic = "force-dynamic"
export const runtime = 'nodejs'

export async function GET() {
  try {
    const data = await predefinedValuesService.getAll()

    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const values = body.values
    const titles = body.titles

    if (!values || !titles || typeof values !== 'object' || typeof titles !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Hazır değerler ve başlıklar zorunludur.' },
        { status: 400 }
      )
    }

    const data = await predefinedValuesService.save(values, titles)

    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
