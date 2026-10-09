import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

function clean(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  return text === '-' ? '' : text
}

function cleanBigInt(value: unknown) {
  const text = clean(value)
  if (!text) return null

  try {
    return BigInt(text)
  } catch {
    return null
  }
}

function cleanDate(value: unknown) {
  const text = clean(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

type CardConflictRow = {
  id: bigint
  dosyano: string | null
  dosyaSahibi: string | null
  ekmekDurumu: number | null
}

// Bu kart no BASKA bir dosyada (aktif/pasif farketmeksizin) zaten kayitli
// mi? "dosyalar.kartno" her yardim turunun kart atama akisi tarafindan
// senkron tutulan TEK/kanonik alan oldugu icin (asagidaki kayit adimina
// bakin), buradan kontrol etmek "herhangi bir dosyada/yardimda kayitli mi"
// sorusuna guvenilir bir cevap verir.
async function findCardNoConflict(cardNo: string, excludeFileId: bigint): Promise<CardConflictRow | null> {
  const rows = await prisma.$queryRaw<CardConflictRow[]>`
    SELECT
      d.id,
      d.dosyano,
      owner.adisoyadi AS "dosyaSahibi",
      ek.durumu AS "ekmekDurumu"
    FROM dosyalar d
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          NULLIF(BTRIM(b.adisoyadi), ''),
          NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(b.adi), ''), NULLIF(BTRIM(b.soyadi), ''))), '')
        ) AS adisoyadi
      FROM bireyler b
      WHERE b.dosyaid = d.id
      ORDER BY
        CASE
          WHEN b.tipi = 1 THEN 0
          WHEN b.yakinligi = 0 THEN 1
          ELSE 2
        END,
        b.id
      LIMIT 1
    ) owner ON TRUE
    LEFT JOIN LATERAL (
      SELECT durumu FROM yrd_ekmek WHERE dosyaid = d.id AND kartno = ${cardNo} ORDER BY id DESC LIMIT 1
    ) ek ON TRUE
    WHERE d.kartno = ${cardNo}
      AND d.id != ${excludeFileId}
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const fileId = cleanBigInt(payload.fileId)
    const recordId = cleanBigInt(payload.recordId)
    const mode = clean(payload.mode) || 'save'

    if (!fileId || !recordId) {
      return NextResponse.json({ success: false, error: 'Dosya ve ekmek kaydı bilgisi zorunludur.' }, { status: 400 })
    }

    if (mode === 'delete') {
      const updatedCount = await prisma.$transaction(async (tx) => {
        await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

        const count = await tx.$executeRaw`
          UPDATE yrd_ekmek
          SET kartno = NULL,
              karttarih = NULL,
              kartaciklama = NULL,
              islemtarihi = NOW()
          WHERE id = ${recordId}
            AND dosyaid = ${fileId};
        `

        await tx.$executeRaw`
          UPDATE dosyalar
          SET kartno = NULL,
              islemtarihi = NOW()
          WHERE id = ${fileId};
        `

        return count
      })

      if (Number(updatedCount) === 0) {
        return NextResponse.json({ success: false, error: 'Ekmek yardımı kaydı bulunamadı.' }, { status: 404 })
      }

      return NextResponse.json({ success: true })
    }

    const cardNo = clean(payload.cardNo)
    const cardDate = cleanDate(payload.cardDate)
    const description = clean(payload.description)
    // Kullanici "evet, yeni dosyaya aktar" dedikten sonra frontend AYNI
    // istegi force:true ile tekrar gonderir - bu durumda eski dosyadaki
    // kart no once temizlenip yeni dosyaya kaydedilir.
    const force = payload.force === true

    // Yardim iptal edildiginde kart numarasinin de temizlenebilmesi icin
    // "kart no" alani BOS birakilarak da kaydedilebilir - bu durumda tarih
    // zorunlulugu aranmaz ve kayit, asagidaki "Sil" akisiyla ayni sekilde
    // kart bilgisini temizler. Kart no GIRILMISSE tarih hala zorunludur.
    if (cardNo && !cardDate) {
      return NextResponse.json({ success: false, error: 'Tarih ve kart no zorunludur.' }, { status: 400 })
    }

    if (cardNo && !force) {
      const conflict = await findCardNoConflict(cardNo, fileId)
      if (conflict) {
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            existingFile: {
              fileId: conflict.id.toString(),
              dosyaNo: conflict.dosyano,
              dosyaSahibi: conflict.dosyaSahibi,
              durumu: conflict.ekmekDurumu,
            },
          },
          { status: 409 },
        )
      }
    }

    const updatedCount = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      if (cardNo && force) {
        // Eski dosya(lar)daki ayni kart no kaydini temizle - boylece ayni
        // fiziksel kart, senkronizasyonu bozmadan yeni dosyaya tasinmis olur.
        await tx.$executeRaw`
          UPDATE yrd_ekmek
          SET kartno = NULL,
              karttarih = NULL,
              kartaciklama = NULL,
              islemtarihi = NOW()
          WHERE kartno = ${cardNo}
            AND dosyaid != ${fileId};
        `

        await tx.$executeRaw`
          UPDATE dosyalar
          SET kartno = NULL,
              islemtarihi = NOW()
          WHERE kartno = ${cardNo}
            AND id != ${fileId};
        `
      }

      const count = cardNo
        ? await tx.$executeRaw`
          UPDATE yrd_ekmek
          SET kartno = ${cardNo},
              karttarih = ${cardDate}::date,
              kartaciklama = ${description || null},
              islemtarihi = NOW()
          WHERE id = ${recordId}
            AND dosyaid = ${fileId};
        `
        : await tx.$executeRaw`
          UPDATE yrd_ekmek
          SET kartno = NULL,
              karttarih = NULL,
              kartaciklama = NULL,
              islemtarihi = NOW()
          WHERE id = ${recordId}
            AND dosyaid = ${fileId};
        `

      await tx.$executeRaw`
        UPDATE dosyalar
        SET kartno = ${cardNo || null},
            islemtarihi = NOW()
        WHERE id = ${fileId};
      `

      return count
    })

    if (Number(updatedCount) === 0) {
      return NextResponse.json({ success: false, error: 'Ekmek yardımı kaydı bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Bread card save error:', error)
    return NextResponse.json({ success: false, error: 'Kart no kaydedilemedi.' }, { status: 500 })
  }
}
