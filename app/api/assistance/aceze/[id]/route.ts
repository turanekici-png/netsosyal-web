import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { normalizeAmount } from '@/lib/utils/money'

type RouteParams = { params: Promise<{ id: string }> }

function validId(value: string) {
  return /^\d+$/.test(value)
}

function validate(body: Record<string, unknown>) {
  const fullName = String(body.fullName || '').trim()
  const reason = String(body.reason || '').trim()
  const identityNumber = String(body.identityNumber || '').trim()
  const applicationDate = String(body.date || '').trim()

  if (!fullName || fullName.length > 100) return 'Ad soyad alanı zorunludur.'
  if (!reason || reason.length > 500) return 'Başvuru nedeni zorunludur.'
  if (identityNumber && !/^\d{11}$/.test(identityNumber)) return 'T.C. kimlik numarası 11 haneli olmalıdır.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(applicationDate)) return 'Başvuru tarihi geçersizdir.'
  return ''
}

export async function PATCH(request: Request, context: RouteParams) {
  const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/assistance/aceze' })
  if (accessDenied) return accessDenied

  const { id } = await context.params
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Geçersiz kayıt numarası.' }, { status: 400 })

  try {
    const body = await request.json() as Record<string, unknown>
    const validationError = validate(body)
    if (validationError) return NextResponse.json({ success: false, error: validationError }, { status: 400 })

    const cookieStore = await cookies()
    const userId = parseSessionValue(readSessionCookie(cookieStore))
    const result = await withAuditedPoolWrite(getSqlMonitorPool(), (client) => client.query(
      `UPDATE yrd_aceze SET
        kullaniciid = COALESCE($1, kullaniciid), islemtarihi = NOW(),
        uyrugu = $2, tckimlikno = NULLIF($3, ''), adisoyadi = $4,
        babaadi = NULLIF($5, ''), anaadi = NULLIF($6, ''), dogumyeri = NULLIF($7, ''),
        dogumtarihi = NULLIF($8, '')::date, medenihali = NULLIF($9, '')::smallint,
        cinsiyeti = NULLIF($10, '')::char(1), saglikdurumu = NULLIF($11, '')::integer,
        hastalikadi = NULLIF($12, ''), ceptel = NULLIF($13, ''),
        gidecegiyer = NULLIF($14, ''), nufuskytili = NULLIF($15, ''),
        tarih = $16::date, kisisayisi = $17, nedeni = $18, tutar = NULLIF($20, '')::numeric
      WHERE id = $19
      RETURNING id`,
      [
        userId ? Number(userId) : null,
        String(body.nationality || '').slice(0, 20), String(body.identityNumber || '').trim(), String(body.fullName || '').trim(),
        String(body.fatherName || '').slice(0, 50), String(body.motherName || '').slice(0, 50), String(body.birthPlace || '').slice(0, 50),
        String(body.birthDate || ''), String(body.maritalStatus || ''), String(body.gender || ''), String(body.healthStatus || ''),
        String(body.illnessName || '').slice(0, 100), String(body.phone || '').slice(0, 20), String(body.destination || '').slice(0, 150),
        String(body.registryCity || '').slice(0, 50), String(body.date || ''), Math.max(1, Math.min(99, Number(body.personCount) || 1)),
        String(body.reason || '').trim(), id, normalizeAmount(body.amount),
      ],
    ), getAuditMetaFromRequest(request))

    if (!result.rowCount) return NextResponse.json({ success: false, error: 'Aceze kaydı bulunamadı.' }, { status: 404 })
    return NextResponse.json({ success: true, data: { id } })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Aceze kaydı güncellenemedi.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: RouteParams) {
  const accessDenied = await requireApiAccess({ action: 'assistance.delete', page: '/assistance/aceze' })
  if (accessDenied) return accessDenied

  const { id } = await context.params
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Geçersiz kayıt numarası.' }, { status: 400 })

  try {
    const result = await withAuditedPoolWrite(
      getSqlMonitorPool(),
      (client) => client.query('DELETE FROM yrd_aceze WHERE id = $1 RETURNING id', [id]),
      getAuditMetaFromRequest(request),
    )
    if (!result.rowCount) return NextResponse.json({ success: false, error: 'Aceze kaydı bulunamadı.' }, { status: 404 })
    return NextResponse.json({ success: true, data: { id } })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Aceze kaydı silinemedi.' }, { status: 500 })
  }
}
