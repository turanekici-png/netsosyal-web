import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

async function access() {
  // Bu panel Ana Sayfa'da (dashboard) yasadigi icin, dashboard'a erisimi
  // olan herkes bu veriyi de gorup girebilir - ayri bir izin tanimlamaya
  // gerek yok.
  return requireApiAccess({ page: '/dashboard' })
}

function serializeRow(row: {
  id: bigint
  yil: number
  ay: number
  yemekMiktari: number
  tutar: unknown
  aciklama: string | null
}) {
  return {
    id: row.id.toString(),
    yil: row.yil,
    ay: row.ay,
    yemekMiktari: row.yemekMiktari,
    tutar: Number(row.tutar),
    aciklama: row.aciklama,
  }
}

export async function GET() {
  try {
    const denied = await access()
    if (denied) return denied

    const rows = await prisma.cenazeYemekleri.findMany({
      orderBy: [{ yil: 'desc' }, { ay: 'desc' }],
    })

    return NextResponse.json({ success: true, data: rows.map(serializeRow) })
  } catch (error) {
    console.error('[Cenaze Yemekleri] Listeleme hatası:', error)
    return NextResponse.json(
      { success: false, error: 'Cenaze yemekleri kayıtları alınamadı.' },
      { status: 500 },
    )
  }
}

// Bir (yil, ay) icin TEK ozet satir tutuluyor (bkz. schema.prisma'daki
// unique kisit) - ayni ay icin tekrar veri girilirse (ör. duzeltme
// amaciyla) YENI satir eklenmez, mevcut satir GUNCELLENIR.
export async function POST(request: Request) {
  try {
    const denied = await access()
    if (denied) return denied

    const body = await request.json().catch(() => ({})) as {
      yil?: number
      ay?: number
      yemekMiktari?: number
      tutar?: number
      aciklama?: string
    }

    const yil = Number(body.yil)
    const ay = Number(body.ay)
    const yemekMiktari = Number(body.yemekMiktari)
    const tutar = Number(body.tutar)
    const aciklama = body.aciklama ? String(body.aciklama).trim() : null

    if (!Number.isInteger(yil) || yil < 2000 || yil > 2200) {
      return NextResponse.json({ success: false, error: 'Geçerli bir yıl giriniz.' }, { status: 400 })
    }
    if (!Number.isInteger(ay) || ay < 1 || ay > 12) {
      return NextResponse.json({ success: false, error: 'Geçerli bir ay (1-12) giriniz.' }, { status: 400 })
    }
    if (!Number.isFinite(yemekMiktari) || yemekMiktari < 0) {
      return NextResponse.json({ success: false, error: 'Yemek miktarı 0 veya daha büyük olmalıdır.' }, { status: 400 })
    }
    if (!Number.isFinite(tutar) || tutar < 0) {
      return NextResponse.json({ success: false, error: 'Tutar 0 veya daha büyük olmalıdır.' }, { status: 400 })
    }

    // NOT: bu sunucudaki PostgreSQL surumu (9.4) "INSERT ... ON CONFLICT"
    // sozdizimini desteklemiyor (9.5+ gerektirir), bu yuzden Prisma'nin
    // upsert() metodu burada kullanilamiyor - manuel bul/guncelle-veya-olustur
    // deseni kullaniliyor.
    const row = await withAuditedWrite(
      async (tx) => {
        const existing = await tx.cenazeYemekleri.findUnique({ where: { yil_ay: { yil, ay } } })
        if (existing) {
          return tx.cenazeYemekleri.update({
            where: { id: existing.id },
            data: { yemekMiktari, tutar, aciklama },
          })
        }
        return tx.cenazeYemekleri.create({
          data: { yil, ay, yemekMiktari, tutar, aciklama },
        })
      },
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true, data: serializeRow(row) })
  } catch (error) {
    console.error('[Cenaze Yemekleri] Kayıt hatası:', error)
    return NextResponse.json(
      { success: false, error: 'Cenaze yemekleri kaydı yapılamadı.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const denied = await access()
    if (denied) return denied

    const id = new URL(request.url).searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Kayıt kimliği zorunludur.' }, { status: 400 })
    }

    await withAuditedWrite(
      (tx) => tx.cenazeYemekleri.delete({ where: { id: BigInt(id) } }),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Cenaze Yemekleri] Silme hatası:', error)
    return NextResponse.json(
      { success: false, error: 'Kayıt silinemedi.' },
      { status: 500 },
    )
  }
}
