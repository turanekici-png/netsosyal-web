import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { ensureIncelemeDegerlendirmeSchema } from '../../_lib/schema'
import { normalizeBigInt, normalizeBoolean, normalizeInteger, normalizeText } from '../../_lib/normalize'

export const dynamic = 'force-dynamic'

type Params = { id: string }

type SoruGuncellePayload = {
  soruMetni?: string
  zorunlu?: boolean
  sira?: number
  secimTuru?: 'tek' | 'coklu'
}

const DEGISTIRILEBILIR_SECIM_TURLERI = ['tek', 'coklu']

// Kullanici istegi (13 Eylul 2026): sistem sorulari (sistem_sorusu=true)
// hala kullanici tarafindan SILINEMEZ ve soru metni degistirilemez, ama
// artik tek/coklu secim turu (ve elbette secenekleri, bkz. secenekler
// route'lari) sistem sorulari icin de duzenlenebilir - belediye personeli
// kriterleri/degerlendirmeyi zaman icinde ayarlayabilsin diye.
export async function PATCH(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const soruId = normalizeBigInt(id)
    if (!soruId) {
      return NextResponse.json({ success: false, error: 'Gecersiz soru id.' }, { status: 400 })
    }

    const payload = await request.json() as SoruGuncellePayload
    await ensureIncelemeDegerlendirmeSchema()
    const pool = getSqlMonitorPool()

    const guncellenen = await withAuditedPoolWrite(pool, async (client) => {
      const mevcut = await client.query<{ sistem_sorusu: boolean; secim_turu: string }>(
        `SELECT sistem_sorusu, secim_turu FROM public.inceleme_form_soru WHERE id = $1::bigint;`,
        [soruId],
      )
      if (mevcut.rows.length === 0) return { kind: 'notFound' as const }

      const sistemSorusu = mevcut.rows[0].sistem_sorusu
      const yeniSira = normalizeInteger(payload.sira)
      // Sadece tek<->coklu gecisine izin ver - metin/sayi turune (veya
      // ondan baska bir tura) degistirmek mevcut cevaplarin/secenkelerin
      // anlamini bozar, bu yuzden desteklenmiyor.
      const yeniSecimTuru = payload.secimTuru && DEGISTIRILEBILIR_SECIM_TURLERI.includes(payload.secimTuru)
        && DEGISTIRILEBILIR_SECIM_TURLERI.includes(mevcut.rows[0].secim_turu)
        ? payload.secimTuru
        : null

      if (sistemSorusu) {
        // Sistem sorusu: metin/zorunluluk sabit, ama sira ve tek/coklu
        // secim turu degistirilebilir.
        if (yeniSira === null && yeniSecimTuru === null) {
          return { kind: 'noop' as const }
        }
        const result = await client.query(
          `
            UPDATE public.inceleme_form_soru
            SET sira = COALESCE($2, sira),
                secim_turu = COALESCE($3, secim_turu)
            WHERE id = $1::bigint
            RETURNING id::text AS id, sira, secim_turu;
          `,
          [soruId, yeniSira, yeniSecimTuru],
        )
        return { kind: 'ok' as const, row: result.rows[0] }
      }

      const soruMetni = normalizeText(payload.soruMetni)
      const result = await client.query(
        `
          UPDATE public.inceleme_form_soru
          SET soru_metni = COALESCE($2, soru_metni),
              zorunlu = COALESCE($3, zorunlu),
              sira = COALESCE($4, sira),
              secim_turu = COALESCE($5, secim_turu)
          WHERE id = $1::bigint
          RETURNING id::text AS id, soru_metni, zorunlu, sira, secim_turu;
        `,
        [soruId, soruMetni, payload.zorunlu === undefined ? null : normalizeBoolean(payload.zorunlu), yeniSira, yeniSecimTuru],
      )
      return { kind: 'ok' as const, row: result.rows[0] }
    }, getAuditMetaFromRequest(request))

    if (guncellenen.kind === 'notFound') {
      return NextResponse.json({ success: false, error: 'Soru bulunamadi.' }, { status: 404 })
    }
    if (guncellenen.kind === 'noop') {
      return NextResponse.json({ success: false, error: 'Sistem sorusunun sadece sirasi degistirilebilir.' }, { status: 403 })
    }

    return NextResponse.json({ success: true, data: guncellenen.row })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Soru guncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const soruId = normalizeBigInt(id)
    if (!soruId) {
      return NextResponse.json({ success: false, error: 'Gecersiz soru id.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const pool = getSqlMonitorPool()

    const sonuc = await withAuditedPoolWrite(pool, async (client) => {
      const mevcut = await client.query<{ sistem_sorusu: boolean }>(
        `SELECT sistem_sorusu FROM public.inceleme_form_soru WHERE id = $1::bigint;`,
        [soruId],
      )
      if (mevcut.rows.length === 0) return { kind: 'notFound' as const }
      if (mevcut.rows[0].sistem_sorusu) return { kind: 'forbidden' as const }

      await client.query(`DELETE FROM public.inceleme_form_soru WHERE id = $1::bigint;`, [soruId])
      return { kind: 'ok' as const }
    }, getAuditMetaFromRequest(request))

    if (sonuc.kind === 'notFound') {
      return NextResponse.json({ success: false, error: 'Soru bulunamadi.' }, { status: 404 })
    }
    if (sonuc.kind === 'forbidden') {
      return NextResponse.json({ success: false, error: 'Sistem sorulari silinemez.' }, { status: 403 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Soru silinemedi.' },
      { status: 500 },
    )
  }
}
