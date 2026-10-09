import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess, getSessionUser } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type HomeVisitRow = {
  id: string
  requestId: string | null
  date: Date | null
  title: string | null
  content: string | null
  userName?: string | null
}

export async function GET(request: Request) {
  try {
    // Kullanici istegi (14 Eylul 2026, 21. tur): "ev ziyareti raporunu
    // sadece yetki verdigimiz kullanicilar gorebilsin". Onceden bu GET'in
    // HICBIR yetki kontrolu yoktu - herhangi bir oturumu olan (proxy.ts
    // sadece oturum var mi diye bakar) kullanici, dosya/rapor yetkisi ne
    // olursa olsun, herhangi bir dosyanin ev ziyareti raporunu okuyabilirdi.
    const accessDenied = await requireApiAccess({ action: 'documents.homeVisits.view' })
    if (accessDenied) return accessDenied

    const { searchParams } = new URL(request.url)
    const requestId = searchParams.get('requestId')

    if (!requestId) {
      return NextResponse.json(
        { success: false, error: 'requestId zorunludur.' },
        { status: 400 }
      )
    }

    // "Hangi kullanıcı GİRMİŞ" bilgisi icin evziyareti.ilkkullaniciid (bu
    // formu ILK GİREN kullanici - kullaniciid en son GÜNCELLEYENi tutar),
    // kullanicilar tablosuna JOIN edilerek isim/kullanici adi cozuluyor.
    const rows = await prisma.$queryRaw<HomeVisitRow[]>`
      SELECT
        e.id::text AS "id",
        e.dosyaid::text AS "requestId",
        e.tarih AS "date",
        e.konu AS "title",
        e.rapor AS "content",
        COALESCE(NULLIF(BTRIM(k.kullanicitamadi), ''), k.kullaniciadi) AS "userName"
      FROM evziyareti e
      LEFT JOIN kullanicilar k ON k.id = e.ilkkullaniciid
      WHERE e.dosyaid = ${BigInt(requestId)}
      ORDER BY e.tarih DESC NULLS LAST, e.id DESC
    `

    return NextResponse.json({ success: true, data: rows })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow/guncelleme' })
    if (accessDenied) return accessDenied

    const body = await request.json()

    if (!body.requestId) {
      return NextResponse.json(
        { success: false, error: 'requestId zorunludur.' },
        { status: 400 }
      )
    }

    // ONEMLI: kullaniciid/ilkkullaniciid ONCEDEN HIC yazilmiyordu - yeni
    // girilen ev ziyareti formlarinda "kim girdi" bilgisi hep bos kaliyordu.
    const sessionUser = await getSessionUser()
    const currentUserId = sessionUser?.id ? Number(sessionUser.id) : null
    const currentUserIdParam = Number.isInteger(currentUserId) ? currentUserId : null

    const rows = await withAuditedWrite((tx) => tx.$queryRaw<HomeVisitRow[]>`
      INSERT INTO evziyareti (dosyaid, tarih, konu, rapor, kullaniciid, ilkkullaniciid, ilkislemtarihi, islemtarihi)
      VALUES (${BigInt(body.requestId)}, ${body.date ? new Date(body.date) : new Date()}, ${body.title || ''}, ${body.content || ''}, ${currentUserIdParam}, ${currentUserIdParam}, NOW(), NOW())
      RETURNING id::text AS "id", dosyaid::text AS "requestId", tarih AS "date", konu AS "title", rapor AS "content"
    `, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow/guncelleme' })
    if (accessDenied) return accessDenied

    const body = await request.json()

    if (!body.id) {
      return NextResponse.json(
        { success: false, error: 'id zorunludur.' },
        { status: 400 }
      )
    }

    const sessionUser = await getSessionUser()
    const currentUserId = sessionUser?.id ? Number(sessionUser.id) : null
    const currentUserIdParam = Number.isInteger(currentUserId) ? currentUserId : null

    const rows = await withAuditedWrite((tx) => tx.$queryRaw<HomeVisitRow[]>`
      UPDATE evziyareti
      SET
        dosyaid = ${body.requestId ? BigInt(body.requestId) : null},
        tarih = ${body.date ? new Date(body.date) : null},
        konu = ${body.title || ''},
        rapor = ${body.content || ''},
        kullaniciid = COALESCE(${currentUserIdParam}, kullaniciid),
        islemtarihi = NOW()
      WHERE id = ${BigInt(body.id)}
      RETURNING id::text AS "id", dosyaid::text AS "requestId", tarih AS "date", konu AS "title", rapor AS "content"
    `, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: rows[0] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.delete', page: '/workflow/guncelleme' })
    if (accessDenied) return accessDenied

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id zorunludur.' },
        { status: 400 }
      )
    }

    await withAuditedWrite((tx) => tx.$executeRaw`
      DELETE FROM evziyareti
      WHERE id = ${BigInt(id)}
    `, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
