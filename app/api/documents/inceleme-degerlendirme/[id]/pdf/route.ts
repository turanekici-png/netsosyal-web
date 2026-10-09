import { NextRequest, NextResponse } from 'next/server'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { ensureIncelemeDegerlendirmeSchema } from '../../_lib/schema'
import { fetchCevapDetaylari } from '../../_lib/queries'
import { mapFormRow } from '../../_lib/mapRow'
import { buildIncelemeFormPdf } from '../../_lib/pdf.service'
import { normalizeBigInt } from '../../_lib/normalize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { id: string }

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
    const detay = { ...mapFormRow(result.rows[0]), cevaplar }
    const pdfBytes = await buildIncelemeFormPdf(detay)

    return new NextResponse(new Uint8Array(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="tahkikat-formu-${formId}.pdf"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'PDF olusturulamadi.' },
      { status: 500 },
    )
  }
}
