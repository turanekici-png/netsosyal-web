import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { internalOrigin } from '@/lib/internalOrigin'

export const dynamic = 'force-dynamic'

type CreateFileRequestBody = {
  applicant?: { tc?: string; phone?: string; [key: string]: unknown }
  phone?: string
  [key: string]: unknown
}

// POST - Dosya Yönetimi'nde bir hane bireyi için sağ-tık "Yeni Dosya
// Oluştur" akışı (bkz. app/(modules)/documents/page.tsx ->
// handleCreateFileForSelectedHousehold). Asıl dosya oluşturma işlemi İÇİN,
// zaten var olan ve tam test edilmiş /api/documents/create uç noktası
// DOĞRUDAN çağrılır (mantık burada TEKRAR YAZILMAZ) - AYNI desen
// app/api/assistance/nakit/create-file/route.ts'te de kullanılıyor.
//
// Kullanıcı isteği (kesin akış): bireye yeni dosya oluşturulurken, o
// bireyin TC'sine ait DURUMU=0 ("Yeni Müracaat") bir Nakit Yardımı
// müracaatı VARSA:
//   (1) o müracaattaki telefon numarası, yeni açılan dosyanın telefonu
//       olarak kaydedilir - bireyin kendi (bireyler.ceptel) telefonundan
//       ÖNCELİKLİDİR (müracaattaki bilgi daha güncel kabul edilir);
//   (2) o müracaat, ESKİ dosyasından (dosyaid'i ne olursa olsun - NULL veya
//       başka bir dosyaya bağlı) YENİ dosyaya dosyaid güncellenerek
//       TAŞINIR - bu, telefonun kullanılıp kullanılmadığından BAĞIMSIZ
//       gerçekleşir.
// Böyle bir müracaat YOKSA (veya telefonu da boşsa): bireyin kendi telefonu
// kullanılır; o da yoksa dosya TELEFON OLMADAN açılır (bu akışa özel -
// /api/documents/create'in genel telefon zorunluluğu burada bilinçli
// olarak "requirePhone: false" ile devre dışı bırakılır).
export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.create', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = await request.json().catch(() => null) as CreateFileRequestBody | null
    if (!body || typeof body !== 'object' || !body.applicant) {
      return NextResponse.json({ success: false, error: 'Geçersiz istek.' }, { status: 400 })
    }

    const applicant = { ...body.applicant }
    const applicantTc = typeof applicant.tc === 'string' ? applicant.tc.trim() : ''
    const householdMemberPhone = typeof applicant.phone === 'string' ? applicant.phone.trim() : ''
    let resolvedPhone = householdMemberPhone
    let matchedNakitRecordId: bigint | null = null

    if (applicantTc) {
      const rows = await prisma.$queryRaw<{ id: bigint; ceptel: string | null }[]>`
        SELECT id, ceptel
        FROM yrd_ayninakti
        WHERE tckimlikno = ${applicantTc}
          AND durumu = 0
        ORDER BY id DESC
        LIMIT 1
      `
      const match = rows[0]
      if (match) {
        matchedNakitRecordId = match.id
        const matchedPhone = (match.ceptel || '').trim()
        // Müracaattaki telefon, bireyin kendi telefonundan ÖNCELİKLİDİR.
        if (matchedPhone) resolvedPhone = matchedPhone
      }
    }

    const createResponse = await fetch(`${internalOrigin()}/api/documents/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({
        ...body,
        phone: resolvedPhone || undefined,
        applicant: { ...applicant, phone: resolvedPhone || undefined },
        requirePhone: false,
      }),
    })
    const createPayload = await createResponse.json()

    if (!createResponse.ok || !createPayload.success) {
      return NextResponse.json(
        { success: false, error: createPayload.error || 'Dosya oluşturulamadı.' },
        { status: createResponse.status || 502 },
      )
    }

    const fileId = createPayload.data?.fileId as string | undefined

    // Musteri istegi: durumu=0 muracaat bulunduysa, telefon kullanilmis
    // olsun ya da olmasin, ESKI dosyasindan YENI dosyaya TASINIR.
    if (fileId && matchedNakitRecordId) {
      await prisma.$executeRaw`UPDATE yrd_ayninakti SET dosyaid = ${BigInt(fileId)} WHERE id = ${matchedNakitRecordId}`
    }

    return NextResponse.json({
      success: true,
      data: {
        ...createPayload.data,
        phoneSource: matchedNakitRecordId ? 'nakit-muracaati' : (resolvedPhone ? 'birey' : 'yok'),
        movedNakitRecordId: matchedNakitRecordId ? matchedNakitRecordId.toString() : null,
      },
    })
  } catch (error) {
    console.error('create-file-for-household-member error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Dosya oluşturulamadı.' },
      { status: 500 },
    )
  }
}
