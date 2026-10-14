import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'

export const dynamic = "force-dynamic"
export const runtime = 'nodejs'

export async function GET() {
  try {
    const data = await predefinedValuesService.getAll()

    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const values = body.values
    const titles = body.titles

    if (!values || !titles || typeof values !== 'object' || typeof titles !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Hazır değerler ve başlıklar zorunludur.' },
        { status: 400 }
      )
    }

    // 2026-10-14: kodsuz satir engeli - adi yazilmis ama kodu (id) bos satir
    // sessizce ise yaramiyordu (orn. "Parçalanmış Aile" kodsuz kaydedilmisti;
    // tahkikat/raporlar kodla calisir). Ayni listede tekrar eden kod da
    // reddedilir. Adi bos, kodu dolu satirlara izin verilir ("Yardım
    // Kriterleri" kodu anahtar olarak kullanir).
    const hatalar: string[] = []
    for (const [kategori, liste] of Object.entries(values as Record<string, unknown>)) {
      if (!Array.isArray(liste)) continue
      const baslik = String((titles as Record<string, unknown>)[kategori] ?? kategori)
      const gorulen = new Set<string>()
      for (const satir of liste as Array<{ id?: unknown; name?: unknown }>) {
        const id = String(satir?.id ?? '').trim()
        const ad = String(satir?.name ?? '').trim()
        if (ad && !id) hatalar.push(`"${baslik}" listesinde "${ad}" satırının kodu boş.`)
        if (id) {
          if (gorulen.has(id)) hatalar.push(`"${baslik}" listesinde ${id} kodu birden fazla kez kullanılmış.`)
          gorulen.add(id)
        }
      }
    }
    if (hatalar.length > 0) {
      return NextResponse.json(
        { success: false, error: `Kaydedilemedi: ${hatalar.slice(0, 5).join(' ')}${hatalar.length > 5 ? ` (+${hatalar.length - 5} sorun daha)` : ''} Kodu girip tekrar kaydedin.` },
        { status: 400 }
      )
    }

    const data = await predefinedValuesService.save(values, titles)

    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
