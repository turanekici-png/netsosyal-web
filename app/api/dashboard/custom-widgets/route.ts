import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { CUSTOM_REPORT_SOURCES } from '@/lib/constants/customReportSources'
import {
  MAX_CUSTOM_WIDGETS,
  computeWidget,
  getSource,
  getSourceColumns,
  loadUserWidgets,
  sanitizeWidget,
  saveUserWidgets,
  type CustomSummaryWidget,
} from '@/lib/dashboard/customSummaryWidgets'

export const dynamic = 'force-dynamic'

// 2026-10-15: Ana sayfa "kullanıcının eklediği özet raporlar" (bkz.
// lib/dashboard/customSummaryWidgets.ts). Kutudaki satirlar Özel Rapor'a
// actigi icin erisim de Özel Rapor sayfa yetkisine baglidir.
const ACCESS_RULE = { page: '/reports/ozel' }

async function currentUserId() {
  const user = await getSessionUser()
  return user ? String(user.id) : null
}

export async function GET(request: Request) {
  const denied = await requireApiAccess(ACCESS_RULE)
  if (denied) return denied
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    if (searchParams.get('meta') === 'sources') {
      return NextResponse.json({ success: true, data: CUSTOM_REPORT_SOURCES.map((source) => ({ id: source.id, label: source.label })) })
    }
    const columnsFor = searchParams.get('columns')
    if (columnsFor) {
      const source = getSource(columnsFor)
      if (!source) return NextResponse.json({ success: false, error: 'Kaynak bulunamadı.' }, { status: 400 })
      return NextResponse.json({ success: true, data: await getSourceColumns(source) })
    }

    const widgets = await loadUserWidgets(userId)
    const data = await Promise.all(widgets.map(async (widget) => {
      try {
        return { widget, result: await computeWidget(widget), error: null }
      } catch (error) {
        return { widget, result: null, error: error instanceof Error ? error.message : 'Rapor hesaplanamadı.' }
      }
    }))
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Özet raporlar alınamadı.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const denied = await requireApiAccess(ACCESS_RULE)
  if (denied) return denied
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })

  try {
    const body = (await request.json().catch(() => null)) as { action?: string; widget?: Partial<CustomSummaryWidget>; id?: string } | null
    const action = body?.action

    if (action === 'delete') {
      const widgets = await loadUserWidgets(userId)
      await saveUserWidgets(userId, widgets.filter((widget) => widget.id !== body?.id))
      return NextResponse.json({ success: true })
    }

    if (action !== 'preview' && action !== 'save') {
      return NextResponse.json({ success: false, error: 'Geçersiz işlem.' }, { status: 400 })
    }

    const { widget, error } = await sanitizeWidget(body?.widget ?? {})
    if (!widget) return NextResponse.json({ success: false, error }, { status: 400 })

    const result = await computeWidget(widget)
    if (action === 'preview') return NextResponse.json({ success: true, data: { widget, result } })

    const widgets = await loadUserWidgets(userId)
    const exists = widgets.some((item) => item.id === widget.id)
    if (!exists && widgets.length >= MAX_CUSTOM_WIDGETS) {
      return NextResponse.json({ success: false, error: `En fazla ${MAX_CUSTOM_WIDGETS} özet rapor eklenebilir.` }, { status: 400 })
    }
    const next = exists ? widgets.map((item) => (item.id === widget.id ? widget : item)) : [...widgets, widget]
    await saveUserWidgets(userId, next)
    return NextResponse.json({ success: true, data: { widget, result } })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Özet rapor kaydedilemedi.' }, { status: 500 })
  }
}
