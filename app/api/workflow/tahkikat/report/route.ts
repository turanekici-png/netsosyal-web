import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function cleanBigInt(value: unknown) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null

  try {
    return BigInt(text)
  } catch {
    return null
  }
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null

  return Number.isInteger(numericUserId) ? numericUserId : null
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow/tahkikat' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const fileId = cleanBigInt(payload.fileId ?? payload.requestId)
    const date = cleanDate(payload.date)
    const title = cleanText(payload.title, 200)
    const content = cleanText(payload.content, 10000)

    if (!fileId || !date || !title || !content) {
      return NextResponse.json(
        { success: false, error: 'Dosya, tarih, konu ve rapor alanlari zorunludur.' },
        { status: 400 },
      )
    }

    const currentUserId = getCurrentUserId(request)
    const result = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const reports = await tx.$queryRaw<Array<{ id: bigint | number | string }>>`
        INSERT INTO evziyareti (
          dosyaid, tarih, konu, rapor, kullaniciid, ilkislemtarihi, islemtarihi
        )
        VALUES (
          ${fileId}, ${date}::date, ${title}, ${content}, ${currentUserId}, NOW(), NOW()
        )
        RETURNING id;
      `

      const updatedCount = await tx.$executeRaw`
        UPDATE dosyalar
        SET
          durumu = 2,
          durumutarih = ${date}::date,
          durumuaciklama = ${'Ev ziyareti raporu eklendi'},
          kullaniciid = ${currentUserId},
          islemtarihi = NOW()
        WHERE id = ${fileId};
      `

      if (Number(updatedCount) === 0) {
        throw new Error('Guncellenecek dosya bulunamadi.')
      }

      return reports[0]
    })

    return NextResponse.json({
      success: true,
      data: {
        reportId: result?.id ? String(result.id) : null,
        fileId: fileId.toString(),
        nextStatus: 2,
      },
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Rapor kaydedilemedi.' },
      { status: 500 },
    )
  }
}
