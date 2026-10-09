import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { ensureIncelemeDegerlendirmeSchema } from '../../../_lib/schema'
import { normalizeBigInt, normalizeBoolean, normalizeInteger, normalizeText } from '../../../_lib/normalize'

export const dynamic = 'force-dynamic'

type Params = { id: string }

type SecenekEklePayload = {
  secenekMetni?: string
  puan?: number
  redTetikler?: boolean
  yoneticiOnayi?: boolean
}

export async function POST(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const soruId = normalizeBigInt(id)
    if (!soruId) {
      return NextResponse.json({ success: false, error: 'Gecersiz soru id.' }, { status: 400 })
    }

    const payload = await request.json() as SecenekEklePayload
    const secenekMetni = normalizeText(payload.secenekMetni)
    if (!secenekMetni) {
      return NextResponse.json({ success: false, error: 'Secenek metni zorunludur.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const pool = getSqlMonitorPool()

    const sonuc = await withAuditedPoolWrite(pool, async (client) => {
      const soruVarMi = await client.query(`SELECT id FROM public.inceleme_form_soru WHERE id = $1::bigint;`, [soruId])
      if (soruVarMi.rows.length === 0) return { kind: 'notFound' as const }

      const siraResult = await client.query<{ next_sira: number }>(
        `SELECT COALESCE(MAX(sira), 0) + 1 AS next_sira FROM public.inceleme_form_secenekler WHERE soru_id = $1::bigint;`,
        [soruId],
      )
      const sira = siraResult.rows[0]?.next_sira ?? 1

      const result = await client.query(
        `
          INSERT INTO public.inceleme_form_secenekler (
            soru_id, sira, secenek_metni, puan, red_tetikler, yonetici_onayi
          )
          VALUES ($1::bigint, $2, $3, $4, $5, $6)
          RETURNING id::text AS id, sira, secenek_metni, puan, red_tetikler, yonetici_onayi;
        `,
        [
          soruId,
          sira,
          secenekMetni,
          normalizeInteger(payload.puan) ?? 0,
          normalizeBoolean(payload.redTetikler),
          normalizeBoolean(payload.yoneticiOnayi),
        ],
      )
      return { kind: 'ok' as const, row: result.rows[0] }
    }, getAuditMetaFromRequest(request))

    if (sonuc.kind === 'notFound') {
      return NextResponse.json({ success: false, error: 'Soru bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: sonuc.row })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Secenek eklenemedi.' },
      { status: 500 },
    )
  }
}
