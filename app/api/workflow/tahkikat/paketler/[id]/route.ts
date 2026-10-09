import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAccess } from '@/lib/apiAuth'
import { withAuditedWrite, getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { ensureTahkikatPaketleriTable, stripMahallelerFromOtherPaketler, type TahkikatPaket } from '../../_lib/rotation'
import { ensureSorumluColumn } from '../../_lib/autoRotate'

export const dynamic = 'force-dynamic'

type Params = { id: string }

type PaketRow = {
  id: bigint | number | string
  ad: string
  sira: number
  mahalleler: unknown
  sorumlukullaniciid: bigint | number | string | null
  sorumlu_ad: string | null
}

function toPaket(row: PaketRow): TahkikatPaket & { ownerUserId: string | null; ownerName: string | null } {
  return {
    id: String(row.id),
    ad: row.ad,
    sira: row.sira,
    mahalleler: Array.isArray(row.mahalleler) ? row.mahalleler.filter((m): m is string => typeof m === 'string') : [],
    ownerUserId: row.sorumlukullaniciid ? String(row.sorumlukullaniciid) : null,
    ownerName: row.sorumlu_ad,
  }
}

function cleanBigInt(value: unknown) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  try {
    return BigInt(text)
  } catch {
    return null
  }
}

function cleanAd(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 150) : ''
}

function cleanMahalleler(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) seen.add(item.trim())
  }
  return [...seen]
}

function cleanSorumluKullaniciId(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? Number(text) : undefined
}

// PATCH - paket adi/sirasi/mahalle listesi guncelle (admin only). Sadece
// body'de GONDERILEN alanlar degisir.
export async function PATCH(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireAdminAccess()
    if (accessDenied) return accessDenied

    await ensureTahkikatPaketleriTable()
    await ensureSorumluColumn()

    const { id } = await params
    const paketId = cleanBigInt(id)
    if (!paketId) {
      return NextResponse.json({ success: false, error: 'Geçersiz grup.' }, { status: 400 })
    }

    const payload = await request.json()

    const adProvided = Object.prototype.hasOwnProperty.call(payload, 'ad')
    const ad = adProvided ? cleanAd(payload.ad) : ''
    if (adProvided && !ad) {
      return NextResponse.json({ success: false, error: 'Grup adı boş bırakılamaz.' }, { status: 400 })
    }

    const siraProvided = Object.prototype.hasOwnProperty.call(payload, 'sira')
    const sira = siraProvided ? Math.trunc(Number(payload.sira) || 0) : 0

    const mahallelerProvided = Object.prototype.hasOwnProperty.call(payload, 'mahalleler')
    const mahalleler = mahallelerProvided ? cleanMahalleler(payload.mahalleler) : []

    const sorumluProvided = Object.prototype.hasOwnProperty.call(payload, 'sorumluKullaniciId')
    const sorumluKullaniciId = sorumluProvided ? cleanSorumluKullaniciId(payload.sorumluKullaniciId) : null
    if (sorumluProvided && sorumluKullaniciId === undefined) {
      return NextResponse.json({ success: false, error: 'Geçersiz sorumlu kullanıcı.' }, { status: 400 })
    }

    if (!adProvided && !siraProvided && !mahallelerProvided && !sorumluProvided) {
      return NextResponse.json({ success: false, error: 'Güncellenecek alan bulunamadı.' }, { status: 400 })
    }

    const rows = await withAuditedWrite(async (tx) => {
      const setClauses: string[] = ['guncellemetarihi = NOW()']
      const values: unknown[] = []

      if (adProvided) {
        values.push(ad)
        setClauses.push(`ad = $${values.length}`)
      }
      if (siraProvided) {
        values.push(sira)
        setClauses.push(`sira = $${values.length}`)
      }
      if (mahallelerProvided) {
        values.push(JSON.stringify(mahalleler))
        setClauses.push(`mahalleler = $${values.length}::jsonb`)
      }
      if (sorumluProvided) {
        values.push(sorumluKullaniciId)
        setClauses.push(`sorumlukullaniciid = $${values.length}`)
      }

      values.push(paketId.toString())
      const idParamIndex = values.length

      const updated = await tx.$queryRawUnsafe<Array<{ id: bigint | number | string }>>(
        `UPDATE tahkikat_paketleri SET ${setClauses.join(', ')} WHERE id = $${idParamIndex}::bigint
         RETURNING id;`,
        ...values,
      )

      if (mahallelerProvided && updated.length > 0) {
        await stripMahallelerFromOtherPaketler(tx, paketId, mahalleler)
      }

      if (updated.length === 0) return []

      return tx.$queryRaw<PaketRow[]>`
        SELECT p.id, p.ad, p.sira, p.mahalleler, p.sorumlukullaniciid,
          COALESCE(NULLIF(u.kullanicitamadi, ''), NULLIF(u.kullaniciadi, '')) AS sorumlu_ad
        FROM tahkikat_paketleri p
        LEFT JOIN kullanicilar u ON u.id::text = p.sorumlukullaniciid::text
        WHERE p.id = ${paketId};
      `
    }, getAuditMetaFromRequest(request))

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Grup bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: toPaket(rows[0]) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Grup güncellenemedi.' },
      { status: 500 },
    )
  }
}

// DELETE - paket sil (admin only).
export async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireAdminAccess()
    if (accessDenied) return accessDenied

    await ensureTahkikatPaketleriTable()

    const { id } = await params
    const paketId = cleanBigInt(id)
    if (!paketId) {
      return NextResponse.json({ success: false, error: 'Geçersiz grup.' }, { status: 400 })
    }

    const deletedCount = await withAuditedWrite(
      (tx) => tx.$executeRaw`DELETE FROM tahkikat_paketleri WHERE id = ${paketId};`,
      getAuditMetaFromRequest(request),
    )

    if (Number(deletedCount) === 0) {
      return NextResponse.json({ success: false, error: 'Grup bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Grup silinemedi.' },
      { status: 500 },
    )
  }
}
