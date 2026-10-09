import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { ensureIncelemeDegerlendirmeSchema } from '../../_lib/schema'
import { normalizeBigInt, normalizeBoolean, normalizeInteger, normalizeText } from '../../_lib/normalize'

export const dynamic = 'force-dynamic'

type Params = { id: string }

type SecenekGuncellePayload = {
  secenekMetni?: string
  puan?: number
  redTetikler?: boolean
  yoneticiOnayi?: boolean
  sira?: number
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const secenekId = normalizeBigInt(id)
    if (!secenekId) {
      return NextResponse.json({ success: false, error: 'Gecersiz secenek id.' }, { status: 400 })
    }

    const payload = await request.json() as SecenekGuncellePayload
    await ensureIncelemeDegerlendirmeSchema()
    const pool = getSqlMonitorPool()

    const result = await withAuditedPoolWrite(pool, async (client) => {
      return client.query(
        `
          UPDATE public.inceleme_form_secenekler
          SET secenek_metni = COALESCE($2, secenek_metni),
              puan = COALESCE($3, puan),
              red_tetikler = COALESCE($4, red_tetikler),
              yonetici_onayi = COALESCE($5, yonetici_onayi),
              sira = COALESCE($6, sira)
          WHERE id = $1::bigint
          RETURNING id::text AS id, secenek_metni, puan, red_tetikler, yonetici_onayi, sira;
        `,
        [
          secenekId,
          normalizeText(payload.secenekMetni),
          normalizeInteger(payload.puan),
          payload.redTetikler === undefined ? null : normalizeBoolean(payload.redTetikler),
          payload.yoneticiOnayi === undefined ? null : normalizeBoolean(payload.yoneticiOnayi),
          normalizeInteger(payload.sira),
        ],
      )
    }, getAuditMetaFromRequest(request))

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Secenek bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: result.rows[0] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Secenek guncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const secenekId = normalizeBigInt(id)
    if (!secenekId) {
      return NextResponse.json({ success: false, error: 'Gecersiz secenek id.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const pool = getSqlMonitorPool()

    const deletedCount = await withAuditedPoolWrite(pool, async (client) => {
      const result = await client.query(`DELETE FROM public.inceleme_form_secenekler WHERE id = $1::bigint;`, [secenekId])
      return result.rowCount ?? 0
    }, getAuditMetaFromRequest(request))

    if (deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Secenek bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Secenek silinemedi.' },
      { status: 500 },
    )
  }
}
