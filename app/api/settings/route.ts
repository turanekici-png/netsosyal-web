import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'

export const dynamic = "force-dynamic"

// GET all settings
export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const settings = await settingService.getAll()

    return NextResponse.json({
      success: true,
      data: settings,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// CREATE/UPDATE setting
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const { key, value, type } = body

    const setting = await settingService.set(key, value, type)

    return NextResponse.json(
      { success: true, data: setting },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
