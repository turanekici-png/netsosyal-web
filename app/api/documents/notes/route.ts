import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { requireDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'
import { cookies } from 'next/headers'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type CreateDocumentNotePayload = {
  fileId?: string
  title?: string
  note?: string
  date?: string
  personIdentityNumber?: string
  personName?: string
}

type FileInfoRow = {
  dosyano: string | null
  tckimlikno: string | null
  adisoyadi: string | null
}

type DocumentNoteRow = {
  id: bigint
  title: string | null
  note: string | null
  tarih: Date | null
  requested_by: string | null
  status: string | null
  identity_number: string | null
  person_name: string | null
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanBigInt(value: unknown) {
  const text = cleanText(value)
  return text && /^\d+$/.test(text) ? BigInt(text) : null
}

function cleanDate(value: unknown) {
  const text = cleanText(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

async function getCurrentUserName() {
  try {
    const cookieStore = await cookies()
    const userId = parseSessionValue(readSessionCookie(cookieStore))
    const user = userId ? await userService.getById(userId) : null
    return user?.name || user?.username || 'Kullanici'
  } catch {
    return 'Kullanici'
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = (await request.json()) as CreateDocumentNotePayload
    const fileId = cleanBigInt(payload.fileId)
    const title = cleanText(payload.title)
    const note = cleanText(payload.note)
    const personIdentityNumber = cleanText(payload.personIdentityNumber)
    const personName = cleanText(payload.personName)
    const requestedDate = cleanDate(payload.date) ?? new Date()

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'Dosya ID zorunludur.' }, { status: 400 })
    }

    if (!title) {
      return NextResponse.json({ success: false, error: 'Istenen evrak alani bos olamaz.' }, { status: 400 })
    }

    const fileRows = await prisma.$queryRaw<FileInfoRow[]>`
      SELECT
        d.dosyano,
        b.tckimlikno,
        COALESCE(NULLIF(b.adisoyadi, ''), NULLIF(TRIM(CONCAT_WS(' ', b.adi, b.soyadi)), '')) AS adisoyadi
      FROM dosyalar d
      LEFT JOIN LATERAL (
        SELECT tckimlikno, adisoyadi, adi, soyadi
        FROM bireyler
        WHERE dosyaid = d.id
        ORDER BY CASE WHEN yakinligi = 0 THEN 0 ELSE 1 END, id ASC
        LIMIT 1
      ) b ON TRUE
      WHERE d.id = ${fileId}
      LIMIT 1
    `
    const fileInfo = fileRows[0]

    if (!fileInfo) {
      return NextResponse.json({ success: false, error: 'Dosya bulunamadi.' }, { status: 404 })
    }

    let selectedPerson: FileInfoRow = {
      ...fileInfo,
      tckimlikno: personIdentityNumber || fileInfo.tckimlikno,
      adisoyadi: personName || fileInfo.adisoyadi,
    }

    if (personIdentityNumber) {
      const selectedRows = await prisma.$queryRaw<FileInfoRow[]>`
        SELECT
          ${fileInfo.dosyano}::text AS dosyano,
          NULLIF(BTRIM(tckimlikno::text), '') AS tckimlikno,
          COALESCE(NULLIF(adisoyadi, ''), NULLIF(TRIM(CONCAT_WS(' ', adi, soyadi)), '')) AS adisoyadi
        FROM bireyler
        WHERE dosyaid = ${fileId}
          AND BTRIM(tckimlikno::text) = ${personIdentityNumber}
        LIMIT 1
      `
      if (selectedRows[0]) selectedPerson = selectedRows[0]
    } else if (personName) {
      const selectedRows = await prisma.$queryRaw<FileInfoRow[]>`
        SELECT
          ${fileInfo.dosyano}::text AS dosyano,
          NULLIF(BTRIM(tckimlikno::text), '') AS tckimlikno,
          COALESCE(NULLIF(adisoyadi, ''), NULLIF(TRIM(CONCAT_WS(' ', adi, soyadi)), '')) AS adisoyadi
        FROM bireyler
        WHERE dosyaid = ${fileId}
          AND COALESCE(NULLIF(adisoyadi, ''), NULLIF(TRIM(CONCAT_WS(' ', adi, soyadi)), '')) = ${personName}
        LIMIT 1
      `
      if (selectedRows[0]) selectedPerson = selectedRows[0]
    }

    if ((personIdentityNumber || personName) && !selectedPerson.tckimlikno && !selectedPerson.adisoyadi) {
      return NextResponse.json({ success: false, error: 'Secilen kisi bu dosyada bulunamadi.' }, { status: 400 })
    }

    const requestId = Number(fileId)

    if (!Number.isSafeInteger(requestId)) {
      return NextResponse.json({ success: false, error: 'Dosya ID gecersiz.' }, { status: 400 })
    }

    const requestedBy = await getCurrentUserName()
    const createdNote = await prisma.document.create({
      data: {
        requestId,
        dosyano: fileInfo.dosyano,
        tc: selectedPerson.tckimlikno,
        name: selectedPerson.adisoyadi,
        title,
        status: 'bekliyor',
        requestedDate,
        notes: note,
        isteyen_kullanici: requestedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      data: createdNote
        ? {
            id: createdNote.id.toString(),
            title: createdNote.title || '',
            note: createdNote.notes || '',
            date: createdNote.requestedDate?.toLocaleDateString('tr-TR') || '-',
            requestedBy: createdNote.isteyen_kullanici || '-',
            status: createdNote.status || 'bekliyor',
            identityNumber: createdNote.tc || '',
            personName: createdNote.name || '',
          }
        : null,
    })
  } catch (error) {
    console.error('POST Document Note Error:', error)
    const errorMessage = process.env.NODE_ENV === 'development' && error instanceof Error
      ? error.message
      : 'Evrak istegi kaydedilirken hata olustu.'
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/documents' })
    if (accessDenied) return accessDenied
    const destructiveDenied = await requireDestructiveAuthorization(request)
    if (destructiveDenied) return destructiveDenied

    const id = cleanBigInt(request.nextUrl.searchParams.get('id'))

    if (!id) {
      return NextResponse.json({ success: false, error: 'Silinecek evrak kaydi secilmedi.' }, { status: 400 })
    }

    const rows = await prisma.$queryRaw<{ id: bigint }[]>`
      DELETE FROM beklenen_evraklar
      WHERE id = ${id}
      RETURNING id
    `

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek evrak kaydi bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { id: rows[0].id.toString() } })
  } catch (error) {
    console.error('DELETE Document Note Error:', error)
    return NextResponse.json({ success: false, error: 'Evrak kaydi silinirken hata olustu.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = (await request.json()) as CreateDocumentNotePayload & { id?: string; mode?: string }
    const id = cleanBigInt(payload.id)

    if (!id) {
      return NextResponse.json({ success: false, error: 'Guncellenecek evrak kaydi secilmedi.' }, { status: 400 })
    }

    if (payload.mode === 'edit') {
      const title = cleanText(payload.title)
      const note = cleanText(payload.note) || title
      const requestedDate = cleanDate(payload.date) ?? new Date()
      if (!title) {
        return NextResponse.json({ success: false, error: 'Istenen evrak alani bos olamaz.' }, { status: 400 })
      }
      const updatedNote = await prisma.document.update({
        where: { id: Number(id) },
        data: {
          title,
          notes: note,
          requestedDate,
          tc: cleanText(payload.personIdentityNumber),
          name: cleanText(payload.personName),
          updatedAt: new Date(),
        },
      })
      return NextResponse.json({
        success: true,
        data: {
          id: updatedNote.id.toString(),
          title: updatedNote.title || '',
          note: updatedNote.notes || '',
          date: updatedNote.requestedDate?.toLocaleDateString('tr-TR') || '-',
          requestedBy: updatedNote.isteyen_kullanici || '-',
          status: updatedNote.status || 'bekliyor',
          identityNumber: updatedNote.tc || '',
          personName: updatedNote.name || '',
        },
      })
    }

    const rows = await prisma.$queryRaw<DocumentNoteRow[]>`
      UPDATE beklenen_evraklar
      SET durum = 'tamamlandi',
          tamamlanma_tarihi = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id,
                evrak_adi AS title,
                notlar AS note,
                COALESCE(istenme_tarihi, created_at) AS tarih,
                isteyen_kullanici AS requested_by,
                durum AS status,
                tckimlikno AS identity_number,
                adisoyadi AS person_name
    `

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Evrak kaydi bulunamadi.' }, { status: 404 })
    }

    const updated = rows[0]
    return NextResponse.json({
      success: true,
      data: {
        id: updated.id.toString(),
        title: updated.title || '',
        note: updated.note || '',
        date: updated.tarih?.toLocaleDateString('tr-TR') || '-',
        requestedBy: updated.requested_by || '-',
        status: updated.status || 'tamamlandi',
        identityNumber: updated.identity_number || '',
        personName: updated.person_name || '',
      },
    })
  } catch (error) {
    console.error('PATCH Document Note Error:', error)
    return NextResponse.json({ success: false, error: 'Evrak kaydi guncellenirken hata olustu.' }, { status: 500 })
  }
}
