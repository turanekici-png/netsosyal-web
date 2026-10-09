import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { evaluateCriterion, sanitizeCriteria, type NakitCandidateRow } from '@/lib/nakitCriteria'

export const dynamic = 'force-dynamic'

// Bu degerler, "İptal Et" (app/api/requests/nakit/cancel) akisiyla tutarli
// tutuluyor: durumu=1, durumutarih=bugun, islemtarihi=simdi.
const REJECTION_STAGE = 'UYGUN DEĞİL'
const REJECTION_NOTE = 'Başvuru Kriterlerine uymadığı için uygun görülmemiştir'

type CandidateRow = NakitCandidateRow & {
  id: bigint
  muracaateden: string | null
  tckimlikno: string | null
  donem: string | null
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/assistance/nakit' })
    if (accessDenied) return accessDenied

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const mode = body.mode === 'apply' ? 'apply' : 'preview'

    if (mode === 'apply') {
      const rawIds = Array.isArray(body.ids) ? body.ids : []
      const ids = Array.from(new Set(
        rawIds.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id)),
      )).map((id) => BigInt(id))

      if (ids.length === 0) {
        return NextResponse.json({ success: false, error: 'Uygulanacak kayıt bulunamadı.' }, { status: 400 })
      }

      // Guvenlik: sadece durumu=0 (bekleyen) kayitlar guncellenir - preview ile
      // apply arasinda gecen surede baskasi tarafindan islenmis bir kaydin
      // uzerine yazilmaz.
      const updatedCount = await withAuditedWrite((tx) => tx.$executeRaw`
        UPDATE yrd_ayninakti
        SET durumu = 1,
            durumutarih = CURRENT_DATE,
            durumuaciklama = ${REJECTION_NOTE},
            asama = ${REJECTION_STAGE},
            islemtarihi = CURRENT_TIMESTAMP
        WHERE id IN (${Prisma.join(ids)})
          AND durumu = 0
      `, getAuditMetaFromRequest(request))

      return NextResponse.json({ success: true, data: { updatedCount } })
    }

    // preview - deger bos birakilmis veya bilinmeyen kriterler burada
    // sessizce elenir (hata verilmez), bkz. sanitizeCriteria.
    const criteria = sanitizeCriteria(body.criteria)
    if (criteria.length === 0) {
      return NextResponse.json({ success: false, error: 'En az bir kriter giriniz.' }, { status: 400 })
    }

    const rows = await prisma.$queryRaw<CandidateRow[]>`
      SELECT id, muracaateden, tckimlikno, donem, aylikgelir, miktar, aracbilgisi, dogumtarihi, topbirey
      FROM yrd_ayninakti
      WHERE durumu = 0
    `

    const matches = rows
      .map((row) => ({
        row,
        reasons: criteria
          .map((criterion) => evaluateCriterion(row, criterion))
          .filter((reason): reason is string => reason !== null),
      }))
      .filter((entry) => entry.reasons.length > 0)
      .map((entry) => ({
        id: entry.row.id.toString(),
        muracaateden: entry.row.muracaateden,
        tckimlikno: entry.row.tckimlikno,
        donem: entry.row.donem,
        reasons: entry.reasons,
      }))

    return NextResponse.json({
      success: true,
      data: {
        checkedCount: rows.length,
        matches,
      },
    })
  } catch (error) {
    console.error('[Nakit Kriterleri Uygula] Hata:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kriterler uygulanamadı.' },
      { status: 500 },
    )
  }
}
