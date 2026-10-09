import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { upsertSetting } from '@/lib/db/upsertSetting'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tableId = searchParams.get('tableId')

  if (!tableId) {
    return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
  }

  try {
    const setting = await prisma.setting.findUnique({
      where: { key: `table_layout_${tableId}` }
    })

    return NextResponse.json(setting?.value || null)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { tableId, layout } = await request.json()

    if (!tableId || !layout) {
      return NextResponse.json({ error: 'tableId and layout are required' }, { status: 400 })
    }

    await upsertSetting(`table_layout_${tableId}`, layout)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
