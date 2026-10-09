import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAdminAccess } from '@/lib/apiAuth'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { withAuditedWrite, getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { ensureTahkikatAtamalariTable } from '../_lib/assignments'

export const dynamic = 'force-dynamic'

function cleanBigInt(value: unknown) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null

  try {
    return BigInt(text)
  } catch {
    return null
  }
}

function cleanUserId(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (!/^\d+$/.test(text)) return undefined
  return Number(text)
}

function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null
  return Number.isInteger(numericUserId) ? numericUserId : null
}

// POST - "Tahkikat Dosyaları" listesindeki bir dosyayi ozel olarak belirli
// bir tahkikat gorevlisine atar (userId bos/null gonderilirse atama
// kaldirilir). Kullanici istegi (2026-10-08): "yönetici özel olarak bir
// dosyayı istediği tahkikat görevlisine direk atayabilsin" - SADECE tam
// yetkili (admin) kullanicilar bu islemi yapabilir.
export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireAdminAccess()
    if (accessDenied) return accessDenied

    await ensureTahkikatAtamalariTable()

    const payload = await request.json()
    const fileId = cleanBigInt(payload.fileId)
    if (!fileId) {
      return NextResponse.json({ success: false, error: 'Gecersiz dosya.' }, { status: 400 })
    }

    const userId = cleanUserId(payload.userId)
    if (userId === undefined) {
      return NextResponse.json({ success: false, error: 'Gecersiz kullanici.' }, { status: 400 })
    }

    const currentUserId = getCurrentUserId(request)

    await withAuditedWrite(async (tx) => {
      if (userId === null) {
        await tx.$executeRaw`DELETE FROM tahkikat_atamalari WHERE dosyaid = ${fileId};`
        return
      }

      const existing = await tx.$queryRaw<Array<{ id: bigint | number | string }>>`
        SELECT id FROM tahkikat_atamalari WHERE dosyaid = ${fileId} LIMIT 1;
      `

      if (existing.length > 0) {
        await tx.$executeRaw`
          UPDATE tahkikat_atamalari
          SET atanankullaniciid = ${userId}, atayankullaniciid = ${currentUserId}, atamatarihi = NOW(), gorundu = false
          WHERE dosyaid = ${fileId};
        `
      } else {
        await tx.$executeRaw`
          INSERT INTO tahkikat_atamalari (dosyaid, atanankullaniciid, atayankullaniciid, atamatarihi, gorundu)
          VALUES (${fileId}, ${userId}, ${currentUserId}, NOW(), false);
        `
      }
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Atama kaydedilemedi.' },
      { status: 500 },
    )
  }
}
