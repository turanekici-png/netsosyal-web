import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { updateExpiredAssistanceStatuses } from '@/lib/services/assistanceExpiry.service'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = "force-dynamic"

type AidCategory = 'ekmek' | 'gida' | 'haziryemek' | 'destekpaketi'

type RawAidRow = {
  id: bigint
  dosyaid: bigint | null
  applicant: string | null
}

type AidRow = RawAidRow & {
  category: AidCategory
  label: string
}

type RequestMapRow = {
  id: bigint
  dosyano: string | null
  adres: string | null
  mahalleadi: string | null
  durumu: number | null
  konum_enlem: number | null
  konum_boylam: number | null
  konum_kaynagi: string | null
  konum_durumu: string | null
  konum_guven: number | null
  konum_tarihi: Date | null
}

export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ page: '/assistance' })
    if (accessDenied) return accessDenied

    await updateExpiredAssistanceStatuses()

    // Ham SQL ile verileri çekiyoruz (Prisma model isimleri sorununu kökten çözer)
    const [ekmek, gida, hazirYemek, destekPaketi] = await Promise.all([
      prisma.$queryRaw`SELECT id, dosyaid, muracaateden as applicant FROM yrd_ekmek WHERE durumu = 2 LIMIT 2500`,
      prisma.$queryRaw`SELECT id, dosyaid, muracaateden as applicant FROM yrd_gidabankasi WHERE durumu = 2 LIMIT 2500`,
      prisma.$queryRaw`SELECT id, dosyaid, muracaateden as applicant FROM yrd_haziryemek WHERE durumu = 2 LIMIT 2500`,
      prisma.$queryRaw`SELECT id, dosyaid, muracaateden as applicant FROM yrd_destekpaketi WHERE durumu = 2 LIMIT 2500`,
    ]) as [RawAidRow[], RawAidRow[], RawAidRow[], RawAidRow[]]

    const rawAids: AidRow[] = [
      ...ekmek.map((i) => ({ ...i, category: 'ekmek' as const, label: 'Ekmek Yardımı' })),
      ...gida.map((i) => ({ ...i, category: 'gida' as const, label: 'Gıda Yardımı' })),
      ...hazirYemek.map((i) => ({ ...i, category: 'haziryemek' as const, label: 'Hazır Yemek' })),
      ...destekPaketi.map((i) => ({ ...i, category: 'destekpaketi' as const, label: 'Destek Paketi' })),
    ]

    // Benzersiz dosyaid listesini topla (BigInt string dönüşümü ile)
    const dosyaIds = Array.from(
      new Set(rawAids.map(i => i.dosyaid?.toString()).filter((id): id is string => Boolean(id)))
    )

    const requests = dosyaIds.length > 0
      ? await prisma.$queryRawUnsafe<RequestMapRow[]>(
          `SELECT id, dosyano, adres, mahalleadi, durumu, konum_enlem, konum_boylam, konum_kaynagi, konum_durumu, konum_guven, konum_tarihi
           FROM dosyalar
           WHERE id = ANY($1::bigint[])`,
          dosyaIds
        )
      : []

    const requestMap = new Map()
    requests.forEach(request => {
      requestMap.set(request.id.toString(), request)
    })

    const formattedData = rawAids.map((item) => {
      const dId = item.dosyaid?.toString()
      const requestInfo = dId ? requestMap.get(dId) : null
      
      return {
        id: item.id.toString(),
        applicant: item.applicant || 'İsimsiz',
        category: item.category,
        label: item.label,
        mapData: {
          requestId: dId || '',
          fileNo: requestInfo?.dosyano || '',
          requestStatus: requestInfo?.durumu ?? null,
          address: requestInfo?.adres || '',
          mahalle: requestInfo?.mahalleadi || '',
          lat: requestInfo?.konum_enlem ?? null,
          lon: requestInfo?.konum_boylam ?? null,
          source: requestInfo?.konum_kaynagi || '',
          status: requestInfo?.konum_durumu || '',
          score: requestInfo?.konum_guven ?? null,
          geocodedAt: requestInfo?.konum_tarihi?.toISOString?.() || null
        }
      }
    })

    return NextResponse.json({
      success: true,
      data: formattedData
    })
  } catch (error) {
    console.error('API Raw SQL Error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
