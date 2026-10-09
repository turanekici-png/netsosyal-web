import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { requestService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

type Params = {
  id: string
}

// GET request by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'requests.update', page: '/requests' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const req = await requestService.getById(id)

    if (!req) {
      return NextResponse.json(
        { success: false, error: 'Müracaat bulunamadı' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: req })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// UPDATE request
export async function PUT(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'requests.delete', page: '/requests' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const body = await request.json()
    const req = await withAuditedWrite(
      (tx) => requestService.update(id, body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true, data: req })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// DELETE request
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    // Guvenlik duzeltmesi (15 Eylul 2026, 42. tur): bu uc noktada HICBIR
    // yetki kontrolu YOKTU - "requests" modeli aslinda "dosyalar" tablosuna
    // eslenir (bkz. prisma/schema.prisma - Request @@map("dosyalar")), yani
    // bu uc nokta bir MURACAAT degil, DOGRUDAN BIR DOSYAYI (vaka kaydini)
    // KALICI olarak siliyordu - oturumu olan HERHANGI bir kullanici, yetkisi
    // ne olursa olsun. Sosyal Asistan yazma araclari eklenirken fark edildi
    // (bilincli olarak asistan BU uc noktaya BAGLANMADI - cok riskli).
    // Kardes PUT (guncelleme) uc noktasiyla AYNI ('requests.delete') yetki
    // burada da uygulanir.
    const accessDenied = await requireApiAccess({ action: 'requests.delete', page: '/requests' })
    if (accessDenied) return accessDenied

    const { id } = await params
    await withAuditedWrite(
      (tx) => requestService.delete(id, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      message: 'Müracaat silindi',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
