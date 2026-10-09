import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'

export const dynamic = "force-dynamic"

type Params = {
  key: string
}

// GET setting by key
export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const { key } = await params
    const setting = await settingService.getByKey(key)

    if (!setting) {
      return NextResponse.json(
        { success: false, error: 'Ayar bulunamadı' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: setting })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// DELETE setting
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const { key } = await params
    await settingService.delete(key)

    return NextResponse.json({
      success: true,
      message: 'Ayar silindi',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
