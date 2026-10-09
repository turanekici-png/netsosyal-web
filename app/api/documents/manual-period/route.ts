import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { createAssistancePeriod } from '@/lib/services/assistancePeriod.service'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

const MANUAL_PERIOD_TABLES = new Set(['yrd_gidabankasi', 'yrd_destekpaketi'])

type ManualPeriodPayload = {
  sourceTable?: string
  recordId?: string
  fileId?: string
  periodDate?: string
}

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return new Date()
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? new Date() : date
}

async function getCurrentUserId() {
  const user = await userService.getCurrent()
  const userId = user?.id ? Number(user.id) : null

  return Number.isInteger(userId) ? userId : null
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.create', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = (await request.json()) as ManualPeriodPayload
    const sourceTable = typeof body.sourceTable === 'string' ? body.sourceTable.trim() : ''
    const recordId = cleanBigInt(body.recordId)
    const fileId = cleanBigInt(body.fileId)

    if (!MANUAL_PERIOD_TABLES.has(sourceTable) || !recordId || !fileId) {
      return NextResponse.json(
        { success: false, error: 'Manuel donem sadece Gida Bankasi ve Destek Paketi yardimlari icin kullanilabilir.' },
        { status: 400 },
      )
    }

    const currentUserId = await getCurrentUserId()
    const insertedCount = await withAuditedWrite((tx) => createAssistancePeriod({
      db: tx,
      sourceTable: sourceTable as 'yrd_gidabankasi' | 'yrd_destekpaketi',
      recordId,
      fileId,
      currentUserId,
      periodDate: cleanDate(body.periodDate),
    }), getAuditMetaFromRequest(request))

    if (insertedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Bu yardim icin ilgili donem zaten olusturulmus veya kayit bulunamadi.' },
        { status: 409 },
      )
    }

    return NextResponse.json({ success: true, insertedCount })
  } catch (error) {
    console.error('Manual period create error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Manuel donem olusturulamadi.' },
      { status: 500 },
    )
  }
}
