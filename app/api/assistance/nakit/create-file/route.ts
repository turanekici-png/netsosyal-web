import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { internalOrigin } from '@/lib/internalOrigin'

export const dynamic = 'force-dynamic'

type NakitRecordRow = {
  id: bigint
  dosyaid: bigint | null
  tckimlikno: string | null
  muracaateden: string | null
  dogumtarihi: Date | null
  ceptel: string | null
}

// "Ad Soyad" tek bir metin alaninda (muracaateden) tutulur - son kelime
// soyad, gerisi ad kabul edilir. AYNI mantik uygulamanin baska yerlerinde
// de kullanilir (bkz. app/api/documents/fetch/route.ts -> splitName).
function splitFullName(fullName: string | null | undefined) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) || '' }
}

// POST - Nakit Müracaatları listesinde, kurumda henüz dosyası OLMAYAN bir
// müracaat sahibi için sağ-tık menüsünden "Yeni Dosya Oluştur"
// tıklandığında çalışır (bkz. components/shared/ManagedReportTablePage.tsx
// -> createFileForSelectedRow). Gerçek dosya oluşturma işlemi İÇİN, zaten
// var olan ve tam test edilmiş /api/documents/create uç noktası DOĞRUDAN
// çağrılır (kendi içinde: sıradaki dosya numarasını hesaplar, aynı TC'ye
// ait BAŞKA bir kayıt varsa onu yeniden kullanır, tek transaction içinde
// yazar, ve dosya sahibini otomatik olarak "tipi=1 (dosya sahibi) /
// yakınlığı=0 (kendisi)" yapar) - bu mantık burada TEKRAR YAZILMAZ. Bu uç
// nokta sadece: (1) müracaatın GERÇEKTEN dosyasız olduğunu doğrular,
// (2) ad-soyadı "muracaateden" alanından ayrıştırır, (3) oluşturulan
// dosyayı bu müracaat kaydına geri bağlar (dosyaid).
export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.create', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = await request.json().catch(() => null)
    const recordId = typeof body?.id === 'string' || typeof body?.id === 'number' ? String(body.id) : null
    if (!recordId) {
      return NextResponse.json({ success: false, error: 'Kayıt id bilgisi eksik.' }, { status: 400 })
    }

    let recordBigId: bigint
    try {
      recordBigId = BigInt(recordId)
    } catch {
      return NextResponse.json({ success: false, error: 'Geçersiz kayıt id.' }, { status: 400 })
    }

    const rows = await prisma.$queryRaw<NakitRecordRow[]>`
      SELECT id, dosyaid, tckimlikno, muracaateden, dogumtarihi, ceptel
      FROM yrd_ayninakti
      WHERE id = ${recordBigId}
    `
    const record = rows[0]
    if (!record) {
      return NextResponse.json({ success: false, error: 'Müracaat bulunamadı.' }, { status: 404 })
    }
    if (record.dosyaid) {
      return NextResponse.json({ success: false, error: 'Bu müracaatın zaten bağlı bir dosyası var.' }, { status: 400 })
    }

    const { firstName, lastName } = splitFullName(record.muracaateden)
    if (!firstName || !lastName) {
      return NextResponse.json({ success: false, error: 'Müracaat eden adı eksik/geçersiz - dosya oluşturmak için en az ad ve soyad gereklidir.' }, { status: 400 })
    }

    // Kullanici istegi: telefon numarasi bulunamasa bile dosya acilabilsin -
    // /api/documents/create'in genel telefon zorunlulugu burada bilinçli
    // olarak "requirePhone: false" ile devre disi birakilir (bkz. AYNI
    // esneklik app/api/documents/create-file-for-household-member/
    // route.ts'te de uygulaniyor).
    const phone = (record.ceptel || '').trim()

    const birthDate = record.dogumtarihi ? new Date(record.dogumtarihi).toISOString().slice(0, 10) : undefined

    // /api/documents/create, dosya sahibi icin relation/tipi degerlerini
    // KENDISI 0/1 (kendisi/dosya sahibi) olarak sabitler - burada ayrica
    // gonderilmesine gerek yoktur.
    const createResponse = await fetch(`${internalOrigin()}/api/documents/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({
        phone: phone || undefined,
        applicant: {
          tc: record.tckimlikno || undefined,
          firstName,
          lastName,
          phone: phone || undefined,
          birthDate,
        },
        requirePhone: false,
      }),
    })
    const createPayload = await createResponse.json()

    if (!createResponse.ok || !createPayload.success) {
      return NextResponse.json({ success: false, error: createPayload.error || 'Dosya oluşturulamadı.' }, { status: 502 })
    }

    const fileId = createPayload.data?.fileId as string | undefined
    const fileNo = createPayload.data?.fileNo as string | undefined

    // ONEMLI: muracaat kaydinda SADECE dosyaid guncellenir - ceptel, iban,
    // durumu, donem vb. HICBIR baska alana dokunulmaz (kullanici istegi:
    // "muracaattaki telefon numarasini silmeden ... herhangi bir degisiklik
    // yapmadan tasisin").
    if (fileId) {
      await prisma.$executeRaw`UPDATE yrd_ayninakti SET dosyaid = ${BigInt(fileId)} WHERE id = ${recordBigId}`
    }

    return NextResponse.json({ success: true, data: { fileId, fileNo } })
  } catch (error) {
    console.error('Nakit create-file error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message || 'Dosya oluşturulamadı.' }, { status: 500 })
  }
}
