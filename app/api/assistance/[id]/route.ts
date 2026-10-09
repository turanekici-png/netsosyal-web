import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { assistanceService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = "force-dynamic"

type Params = {
  id: string
}

// GET assistance by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/assistance' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const assistance = await assistanceService.getById(id)

    if (!assistance) {
      return NextResponse.json(
        { success: false, error: 'Yardım bulunamadı' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: assistance })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// UPDATE assistance
export async function PUT(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.delete', page: '/assistance' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const body = await request.json()
    const assistance = await withAuditedWrite(
      (tx) => assistanceService.update(id, body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true, data: assistance })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// DELETE assistance
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    // Guvenlik duzeltmesi (15 Eylul 2026, 42. tur): bu uc noktada HICBIR
    // yetki kontrolu YOKTU - oturumu olan HERHANGI bir kullanici, yetkisi
    // ne olursa olsun, dogrudan bu uc noktaya istek atarak bir yardim/
    // muracaat (yrd_ayninakti) kaydini KALICI olarak silebiliyordu. Sosyal
    // Asistan'a "sil" araci eklenirken fark edildi - kardes PUT (guncelleme)
    // uc noktasiyla AYNI ('assistance.delete') yetki burada da uygulanir.
    const accessDenied = await requireApiAccess({ action: 'assistance.delete', page: '/assistance' })
    if (accessDenied) return accessDenied

    const { id } = await params
    await withAuditedWrite(
      (tx) => assistanceService.delete(id, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      message: 'Yardım silindi',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
