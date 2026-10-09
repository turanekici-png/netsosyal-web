import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { ensureIncelemeDegerlendirmeSchema } from '../_lib/schema'
import { fetchCevapDetaylari } from '../_lib/queries'
import { mapFormRow } from '../_lib/mapRow'
import { normalizeBigInt, normalizeText } from '../_lib/normalize'
import type { OnayDurumu } from '../_lib/types'

export const dynamic = 'force-dynamic'

type Params = { id: string }

const GECERLI_ONAY_DURUMLARI: OnayDurumu[] = ['beklemede', 'onaylandi', 'reddedildi', 'onay_gerekmiyor']

export async function GET(_request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const { id } = await params
    const formId = normalizeBigInt(id)
    if (!formId) {
      return NextResponse.json({ success: false, error: 'Gecersiz form id.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const result = await getSqlMonitorPool().query(
      `SELECT * FROM public.inceleme_degerlendirme_formu WHERE id = $1::bigint;`,
      [formId],
    )
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Form bulunamadi.' }, { status: 404 })
    }

    const cevaplar = await fetchCevapDetaylari(formId)
    return NextResponse.json({ success: true, data: { ...mapFormRow(result.rows[0]), cevaplar } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Form detayi alinamadi.' },
      { status: 500 },
    )
  }
}

type OnayPayload = { onayDurumu?: string; onayNotu?: string }

export async function PATCH(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluationApprove', page: '/documents' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const formId = normalizeBigInt(id)
    if (!formId) {
      return NextResponse.json({ success: false, error: 'Gecersiz form id.' }, { status: 400 })
    }

    const payload = await request.json() as OnayPayload
    const onayDurumu = normalizeText(payload.onayDurumu) as OnayDurumu | null
    if (!onayDurumu || !GECERLI_ONAY_DURUMLARI.includes(onayDurumu)) {
      return NextResponse.json({ success: false, error: 'Gecersiz onay durumu.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const result = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      return client.query(
        `
          UPDATE public.inceleme_degerlendirme_formu
          SET onay_durumu = $2,
              onay_notu = $3,
              guncelleme_tarihi = NOW()
          WHERE id = $1::bigint
          RETURNING *;
        `,
        [formId, onayDurumu, normalizeText(payload.onayNotu)],
      )
    }, getAuditMetaFromRequest(request))

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Form bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: mapFormRow(result.rows[0]) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Onay durumu guncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluation', page: '/documents' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const formId = normalizeBigInt(id)
    if (!formId) {
      return NextResponse.json({ success: false, error: 'Gecersiz form id.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const deletedCount = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const result = await client.query(`DELETE FROM public.inceleme_degerlendirme_formu WHERE id = $1::bigint;`, [formId])
      return result.rowCount ?? 0
    }, getAuditMetaFromRequest(request))

    if (deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Form bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Form silinemedi.' },
      { status: 500 },
    )
  }
}
