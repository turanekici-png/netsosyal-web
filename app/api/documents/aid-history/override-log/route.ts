import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { withAuditedWrite, getAuditMetaFromRequest } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

// "Yardım Hareketleri" penceresindeki Gıda Bankası/Destek Paketi "İşlem
// Geçmişi" (bkz. app/api/documents/aid-history/route.ts) kendi hareket (hrk)
// tablolarindan okunuyor - print-log/sistem_hareket_log BURAYA HIC
// dusmuyor. Bu yuzden, odeme suresi gecmis bir yardimin ISTISNAI olarak
// yazdirilmasi durumunda, gerekcenin bu listede de gorunebilmesi icin ayni
// hareket tablosuna OZEL bir satir ekliyoruz (islemadi='IstisnaiYazdirma') -
// istemci tarafi bu islemadi degerini gorup satiri renkli/isaretli gosterir.
const OVERRIDE_TABLES = new Set(['yrd_gidabankasi', 'yrd_destekpaketi'])

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function getCurrentUserId() {
  const user = await userService.getCurrent()
  const userId = user?.id ? Number(user.id) : null
  return Number.isInteger(userId) ? userId : null
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.print.override', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const sourceTable = typeof body.sourceTable === 'string' ? body.sourceTable.trim() : ''
    const fileId = cleanBigInt(body.fileId)
    const recordId = cleanBigInt(body.recordId)
    const reason = cleanText(body.reason)

    if (!OVERRIDE_TABLES.has(sourceTable) || !fileId || !recordId || !reason) {
      return NextResponse.json(
        { success: false, error: 'Eksik veya geçersiz bilgi.' },
        { status: 400 },
      )
    }

    const currentUserId = await getCurrentUserId()

    const insertedCount = await withAuditedWrite(async (tx) => {
      if (sourceTable === 'yrd_gidabankasi') {
        return tx.$executeRaw`
          INSERT INTO yrd_gidabankasihrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar)
          SELECT ${currentUserId}, NOW(), ${fileId}, ${recordId}, 'IstisnaiYazdirma', ${reason}, t.miktar
          FROM yrd_gidabankasi t
          WHERE t.id = ${recordId} AND t.dosyaid = ${fileId}
        `
      }

      return tx.$executeRaw`
        INSERT INTO yrd_destekpaketihrk (kullaniciid, islemtarihi, dosyaid, yardimid, islemadi, aciklama, miktar)
        SELECT ${currentUserId}, NOW(), ${fileId}, ${recordId}, 'IstisnaiYazdirma', ${reason}, t.miktar
        FROM yrd_destekpaketi t
        WHERE t.id = ${recordId} AND t.dosyaid = ${fileId}
      `
    }, getAuditMetaFromRequest(request))

    if (insertedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'İlgili yardım kaydı bulunamadı.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'İstisnai yazdırma kaydı oluşturulamadı.' },
      { status: 500 },
    )
  }
}
