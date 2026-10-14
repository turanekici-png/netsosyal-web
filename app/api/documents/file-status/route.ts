import { NextRequest, NextResponse } from 'next/server'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { activeAssistanceExistsSql } from '@/lib/services/fileStatusAutoSync.service'

export const dynamic = 'force-dynamic'

function clean(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' || text === '-' ? null : text
}

function cleanBigInt(value: unknown) {
  const cleaned = clean(value)
  if (cleaned === null) return null

  try {
    return BigInt(cleaned)
  } catch {
    return null
  }
}

function cleanNumber(value: unknown) {
  const cleaned = clean(value)
  if (cleaned === null) return null
  const numberValue = Number(cleaned)
  return Number.isFinite(numberValue) ? numberValue : null
}

function isInputDate(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null

  return Number.isInteger(numericUserId) ? numericUserId : null
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.status', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const fileId = cleanBigInt(payload.fileId)
    // Kullanici istegi (2026-10-14): Sonuc Bekleyen > Kaydet'te durum
    // istemcideki listeye gore degil, VERITABANINDAKI aktif yardima gore
    // belirlenir - aktif (durumu=2) Gida/Donem Disi Gida/Destek Paketi/Ekmek/
    // Hazir Yemek varsa 3 (Yardim Yapilabilir), yoksa 4 (Yardim Yapilamaz).
    const autoByActiveAssistance = payload.autoByActiveAssistance === true
    let status = autoByActiveAssistance ? 0 : cleanNumber(payload.status)
    const date = clean(payload.date)
    const description = clean(payload.description)

    // Kullanici istegi (13 Eylul 2026): "aciklama alani zorunlu olmasin,
    // istenirse bos olarak kaydedilebilsin" - description artik opsiyonel
    // (durumuaciklama kolonu zaten nullable, bkz. prisma/schema.prisma).
    if (!fileId || status === null || !isInputDate(date)) {
      return NextResponse.json(
        { success: false, error: 'Dosya, tarih ve durum bilgisi zorunludur.' },
        { status: 400 },
      )
    }

    const currentUserId = getCurrentUserId(request)
    const updatedCount = await withAuditedWrite(async (tx) => {
      if (autoByActiveAssistance) {
        const rows = await tx.$queryRawUnsafe<Array<{ aktif: boolean }>>(
          `SELECT ${activeAssistanceExistsSql('$1::bigint')} AS aktif`,
          fileId.toString(),
        )
        status = rows[0]?.aktif ? 3 : 4
      }
      return tx.$executeRaw`
        UPDATE dosyalar
        SET
          kullaniciid = ${currentUserId},
          durumu = ${status},
          durumutarih = ${date}::date,
          durumuaciklama = ${description},
          islemtarihi = NOW()
        WHERE id = ${fileId};
      `
    }, getAuditMetaFromRequest(request))

    if (Number(updatedCount) === 0) {
      return NextResponse.json({ success: false, error: 'Guncellenecek dosya bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        fileId: fileId.toString(),
        status,
        date,
        description,
      },
    })
  } catch (error) {
    console.error('Update file status error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Dosya durumu guncellenemedi.' },
      { status: 500 },
    )
  }
}
