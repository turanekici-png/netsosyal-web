import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'

export const dynamic = "force-dynamic"
export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'sql.manage', page: '/sql-monitor' })
    if (accessDenied) return accessDenied

    const url = new URL(request.url)
    const tableName = url.searchParams.get('table')
    const limit = Number(url.searchParams.get('limit') ?? 100)
    const search = url.searchParams.get('search') ?? ''
    const sort = url.searchParams.get('sort') ?? ''
    const dir = url.searchParams.get('dir') ?? 'asc'
    let filters: Record<string, string> = {}
    try {
      const raw = url.searchParams.get('filters')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          filters = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
          )
        }
      }
    } catch {
      filters = {}
    }

    if (tableName) {
      const [columns, rows] = await Promise.all([
        sqlMonitorService.getTableColumns(tableName),
        sqlMonitorService.getTableRows(tableName, { limit, search, sort, dir, filters }),
      ])

      return NextResponse.json({
        success: true,
        data: {
          tableName,
          search,
          sort,
          dir,
          filters,
          columns,
          rows,
        },
      })
    }

    const [databaseInfo, tables] = await Promise.all([
      sqlMonitorService.getDatabaseInfo(),
      sqlMonitorService.getTables(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        databaseInfo,
        tables,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'sql.manage', page: '/sql-monitor' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const query = String(body.query ?? '').trim()

    if (!query) {
      return NextResponse.json(
        { success: false, error: 'SQL komutu boş olamaz.' },
        { status: 400 }
      )
    }

    const result = await sqlMonitorService.executeQuery(query)

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'sql.manage', page: '/sql-monitor' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const tableName = String(body.tableName ?? '')
    // Kullanici istegi: tek satir duzenlemenin yaninda TOPLU (coklu secili
    // satir) alan guncelleme de desteklensin - "rowIds" (dizi) esas alinir,
    // eski istemcilerle/cagrilarla uyum icin tekil "rowId" de kabul edilir.
    const rowIds: string[] = Array.isArray(body.rowIds)
      ? body.rowIds.map((id: unknown) => String(id)).filter(Boolean)
      : body.rowId
        ? [String(body.rowId)]
        : []
    const values = body.values as Record<string, unknown>

    if (!tableName || rowIds.length === 0 || !values || typeof values !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Tablo, kayıt ve alan bilgileri zorunludur.' },
        { status: 400 }
      )
    }

    const rows = await sqlMonitorService.updateTableRows(tableName, rowIds, values)

    return NextResponse.json({
      success: true,
      data: rows,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'sql.manage', page: '/sql-monitor' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const tableName = String(body.tableName ?? '')
    const rowIds: string[] = Array.isArray(body.rowIds)
      ? body.rowIds.map((id: unknown) => String(id)).filter(Boolean)
      : []

    if (!tableName || rowIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Tablo ve silinecek kayıt bilgileri zorunludur.' },
        { status: 400 }
      )
    }

    const result = await sqlMonitorService.deleteTableRows(tableName, rowIds)

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
