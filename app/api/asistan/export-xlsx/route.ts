import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { requireApiAccess } from '@/lib/apiAuth'
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/security/requestBody'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Kullanici istegi (2026-09-16): Sosyal Asistan'in dondurdugu bir liste
// icin "xlsx dosyasi olarak ver" istegi - asistan sohbetinde zaten
// GORUNTULENEN (istemcinin elinde olan) tam sonuc tablosunu tekrar
// sorgulamadan, dogrudan bir Excel dosyasina cevirir. Veri zaten
// /api/asistan/chat uzerinden bu KULLANICIYA (kendi yetkisiyle calisan
// run_sql_query sorgusuyla) teslim edilmis oldugundan, burada ayrica
// tablo bazli yetki kontrolu GEREKMEZ - sadece gecerli bir oturum yeterli
// (bkz. requireApiAccess({}), /api/sms/templates ile ayni desen).
const EXPORT_BODY_LIMIT_BYTES = 20 * 1024 * 1024

type ExportPayload = {
  columns?: string[]
  rows?: Record<string, unknown>[]
  question?: string
}

function formatCellValue(value: unknown): string | number | Date {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır'
  if (typeof value === 'string') {
    const isoMatch = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    if (isoMatch) {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) return date
    }
    return value
  }
  return JSON.stringify(value)
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({})
    if (accessDenied) return accessDenied

    const payload = await readLimitedJson<ExportPayload>(request, EXPORT_BODY_LIMIT_BYTES)
    const columns = Array.isArray(payload.columns) ? payload.columns : []
    const rows = Array.isArray(payload.rows) ? payload.rows : []

    if (columns.length === 0) {
      return NextResponse.json({ success: false, error: 'Aktarılacak veri bulunamadı.' }, { status: 400 })
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Sosyal Asistan'
    workbook.created = new Date()

    const sheet = workbook.addWorksheet('Sonuçlar')
    sheet.columns = columns.map((column) => ({ header: column, key: column, width: Math.min(Math.max(column.length + 4, 14), 40) }))
    sheet.getRow(1).font = { bold: true }

    for (const row of rows) {
      sheet.addRow(columns.map((column) => formatCellValue(row[column])))
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const fileName = `sosyal-asistan-raporu-${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 413 })
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Excel dosyası oluşturulamadı.' },
      { status: 500 },
    )
  }
}
