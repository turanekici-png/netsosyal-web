import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { normalizeAmount } from '@/lib/utils/money'

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'assistance.create', page: '/assistance/aceze' })
  if (accessDenied) return accessDenied

  try {
    const body = await request.json()
    const fullName = String(body.fullName || '').trim()
    const reason = String(body.reason || '').trim()
    const identityNumber = String(body.identityNumber || '').trim()
    const applicationDate = String(body.date || '').trim()
    const personCount = Math.max(1, Math.min(99, Number(body.personCount) || 1))
    // Tutar: bos birakilabilir (sonradan girilebilir). Virgul -> nokta, sadece
    // rakam + tek ondalik ayirici kalir; gecersizse bos.
    const amount = normalizeAmount(body.amount)

    if (!fullName || fullName.length > 100) {
      return NextResponse.json({ success: false, error: 'Ad soyad alanı zorunludur.' }, { status: 400 })
    }
    if (!reason || reason.length > 500) {
      return NextResponse.json({ success: false, error: 'Başvuru nedeni zorunludur.' }, { status: 400 })
    }
    if (identityNumber && !/^\d{11}$/.test(identityNumber)) {
      return NextResponse.json({ success: false, error: 'T.C. kimlik numarası 11 haneli olmalıdır.' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(applicationDate)) {
      return NextResponse.json({ success: false, error: 'Başvuru tarihi geçersizdir.' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const userId = parseSessionValue(readSessionCookie(cookieStore))
    const pool = getSqlMonitorPool()
    const result = await withAuditedPoolWrite(pool, (client) => client.query(
      `INSERT INTO yrd_aceze (
        kullaniciid, ilkkullaniciid, islemtarihi, ilkislemtarihi,
        uyrugu, tckimlikno, adisoyadi, babaadi, anaadi, dogumyeri,
        dogumtarihi, medenihali, cinsiyeti, saglikdurumu, hastalikadi,
        ceptel, gidecegiyer, nufuskytili, tarih, kisisayisi, nedeni, tutar
      ) VALUES (
        $1, $1, NOW(), NOW(),
        $2, NULLIF($3, ''), $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''),
        NULLIF($8, '')::date, NULLIF($9, '')::smallint, NULLIF($10, '')::char(1), NULLIF($11, '')::integer, NULLIF($12, ''),
        NULLIF($13, ''), NULLIF($14, ''), NULLIF($15, ''), $16::date, $17, $18, NULLIF($19, '')::numeric
      ) RETURNING id`,
      [
        userId ? Number(userId) : null,
        String(body.nationality || '').slice(0, 20), identityNumber, fullName,
        String(body.fatherName || '').slice(0, 50), String(body.motherName || '').slice(0, 50), String(body.birthPlace || '').slice(0, 50),
        String(body.birthDate || ''), String(body.maritalStatus || ''), String(body.gender || ''), String(body.healthStatus || ''), String(body.illnessName || '').slice(0, 100),
        String(body.phone || '').slice(0, 20), String(body.destination || '').slice(0, 150), String(body.registryCity || '').slice(0, 50),
        applicationDate, personCount, reason, amount,
      ],
    ), getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: { id: String(result.rows[0]?.id || '') } }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Aceze başvurusu kaydedilemedi.' },
      { status: 500 },
    )
  }
}
