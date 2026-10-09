import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { ensureIncelemeDegerlendirmeSchema } from '../_lib/schema'
import { fetchAllSorularWithSecenekler } from '../_lib/queries'
import { normalizeBoolean, normalizeText } from '../_lib/normalize'
import type { SecimTuru, SoruBolum } from '../_lib/types'

export const dynamic = 'force-dynamic'

const GECERLI_BOLUMLER: SoruBolum[] = ['bilgi', 'kriter', 'degerlendirme', 'gozlem']
const GECERLI_SECIM_TURLERI: SecimTuru[] = ['tek', 'coklu', 'metin', 'sayi']

type SoruEklePayload = {
  bolum?: string
  soruMetni?: string
  secimTuru?: string
  zorunlu?: boolean
  redKriteri?: boolean
}

// Soru bankasini bolumlere gore gruplu dondurur - hem form doldurma
// ekraninin (IncelemeDegerlendirmeFormModal) hem soru bankasi yonetim
// sayfasinin (settings/evaluation-form-designer) tek veri kaynagi.
export async function GET() {
  try {
    const sorular = await fetchAllSorularWithSecenekler(true)
    return NextResponse.json({ success: true, data: sorular })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Sorular alinamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as SoruEklePayload
    const bolum = normalizeText(payload.bolum) as SoruBolum | null
    const soruMetni = normalizeText(payload.soruMetni)
    const secimTuru = normalizeText(payload.secimTuru) as SecimTuru | null

    if (!bolum || !GECERLI_BOLUMLER.includes(bolum)) {
      return NextResponse.json({ success: false, error: 'Gecersiz bolum.' }, { status: 400 })
    }
    if (!soruMetni) {
      return NextResponse.json({ success: false, error: 'Soru metni zorunludur.' }, { status: 400 })
    }
    if (!secimTuru || !GECERLI_SECIM_TURLERI.includes(secimTuru)) {
      return NextResponse.json({ success: false, error: 'Gecersiz secim turu.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const pool = getSqlMonitorPool()

    const yeniSoru = await withAuditedPoolWrite(pool, async (client) => {
      const siraResult = await client.query<{ next_sira: number }>(
        `SELECT COALESCE(MAX(sira), 0) + 1 AS next_sira FROM public.inceleme_form_soru WHERE bolum = $1;`,
        [bolum],
      )
      const sira = siraResult.rows[0]?.next_sira ?? 1

      const result = await client.query(
        `
          INSERT INTO public.inceleme_form_soru (
            bolum, sira, soru_metni, secim_turu, zorunlu, red_kriteri, sistem_sorusu
          )
          VALUES ($1, $2, $3, $4, $5, $6, false)
          RETURNING id::text AS id, bolum, sira, soru_metni, secim_turu, zorunlu, red_kriteri, sistem_sorusu;
        `,
        [bolum, sira, soruMetni, secimTuru, normalizeBoolean(payload.zorunlu), normalizeBoolean(payload.redKriteri)],
      )
      return result.rows[0]
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: yeniSoru })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Soru eklenemedi.' },
      { status: 500 },
    )
  }
}
