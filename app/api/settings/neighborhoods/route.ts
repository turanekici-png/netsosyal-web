import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'

export const dynamic = 'force-dynamic'

type NeighborhoodRow = {
  id: string
  name: string | null
  paymentDay: number | null
  paymentEndDay: number | null
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanDayOfMonth(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const day = Number(value)
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null
}

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

export async function GET() {
  try {
    const rows = await prisma.$queryRaw<NeighborhoodRow[]>`
      SELECT
        id::text AS id,
        mahalleadi AS "name",
        odemegunu AS "paymentDay",
        odemegunubitis AS "paymentEndDay"
      FROM mahalleler
      ORDER BY mahalleadi ASC NULLS LAST, id ASC
    `

    return NextResponse.json({ success: true, data: rows })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Mahalle listesi alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const name = cleanText(body.name)
    const paymentDay = cleanDayOfMonth(body.paymentDay)
    const paymentEndDay = cleanDayOfMonth(body.paymentEndDay)

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Mahalle adı zorunludur.' },
        { status: 400 },
      )
    }

    const rows = await prisma.$queryRaw<NeighborhoodRow[]>`
      INSERT INTO mahalleler (mahalleadi, odemegunu, odemegunubitis, islemtarihi)
      VALUES (${name}, ${paymentDay}, ${paymentEndDay}, NOW())
      RETURNING id::text AS id, mahalleadi AS "name", odemegunu AS "paymentDay", odemegunubitis AS "paymentEndDay"
    `

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Mahalle eklenemedi.' },
      { status: 500 },
    )
  }
}

// PATCH - kismi guncelleme: sadece BODY'de gonderilen alanlar degistirilir
// (name/paymentDay/paymentEndDay - ucu de opsiyonel). Boylece ornegin sadece
// odeme bitis gununu degistiren bir istek, mahalle adini veya baslangic
// gununu YANLISLIKLA sifirlamaz - her alan kendi "...Provided" bayragiyla
// ayri ayri kontrol edilir (bkz. asagidaki dinamik SET listesi).
//
// "applyToAll: true" gonderilirse "id" YOK SAYILIR ve odeme baslangic/bitis
// gunu TEK sorguda TUM mahallelere uygulanir ("Ayarlar > Mahalle Listesi"
// sayfasindaki "Tum Mahallelere Uygula" butonu icin) - mahalle adi bu modda
// degistirilemez (birden fazla mahallenin ayni ada sahip olmasi anlamsiz
// olurdu, o yuzden "name" alani applyToAll=true iken kasten yok sayilir).
export async function PATCH(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const applyToAll = body.applyToAll === true

    const paymentDayProvided = Object.prototype.hasOwnProperty.call(body, 'paymentDay')
    const paymentDay = paymentDayProvided ? cleanDayOfMonth(body.paymentDay) : null

    const paymentEndDayProvided = Object.prototype.hasOwnProperty.call(body, 'paymentEndDay')
    const paymentEndDay = paymentEndDayProvided ? cleanDayOfMonth(body.paymentEndDay) : null

    if (applyToAll) {
      if (!paymentDayProvided && !paymentEndDayProvided) {
        return NextResponse.json(
          { success: false, error: 'Uygulanacak ödeme başlangıç veya bitiş günü zorunludur.' },
          { status: 400 },
        )
      }

      const setClauses: string[] = ['islemtarihi = NOW()']
      const values: unknown[] = []

      if (paymentDayProvided) {
        values.push(paymentDay)
        setClauses.push(`odemegunu = $${values.length}`)
      }
      if (paymentEndDayProvided) {
        values.push(paymentEndDay)
        setClauses.push(`odemegunubitis = $${values.length}`)
      }

      const updatedCount = await prisma.$executeRawUnsafe(
        `UPDATE mahalleler SET ${setClauses.join(', ')}`,
        ...values,
      )

      return NextResponse.json({ success: true, updatedCount })
    }

    const id = cleanBigInt(body.id)

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Mahalle kaydı zorunludur.' },
        { status: 400 },
      )
    }

    const nameProvided = Object.prototype.hasOwnProperty.call(body, 'name')
    const name = nameProvided ? cleanText(body.name) : null

    if (nameProvided && !name) {
      return NextResponse.json(
        { success: false, error: 'Mahalle adı boş bırakılamaz.' },
        { status: 400 },
      )
    }

    const setClauses: string[] = ['islemtarihi = NOW()']
    const values: unknown[] = []

    if (nameProvided) {
      values.push(name)
      setClauses.push(`mahalleadi = $${values.length}`)
    }
    if (paymentDayProvided) {
      values.push(paymentDay)
      setClauses.push(`odemegunu = $${values.length}`)
    }
    if (paymentEndDayProvided) {
      values.push(paymentEndDay)
      setClauses.push(`odemegunubitis = $${values.length}`)
    }

    values.push(id.toString())
    const idParamIndex = values.length

    const rows = await prisma.$queryRawUnsafe<NeighborhoodRow[]>(
      `UPDATE mahalleler
       SET ${setClauses.join(', ')}
       WHERE id = $${idParamIndex}::bigint
       RETURNING id::text AS id, mahalleadi AS "name", odemegunu AS "paymentDay", odemegunubitis AS "paymentEndDay"`,
      ...values,
    )

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Güncellenecek mahalle bulunamadı.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, data: rows[0] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Mahalle güncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const id = cleanBigInt(body.id)

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Silinecek mahalle kaydı zorunludur.' },
        { status: 400 },
      )
    }

    const deletedCount = await prisma.$executeRaw`
      DELETE FROM mahalleler
      WHERE id = ${id}
    `

    if (deletedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Silinecek mahalle bulunamadı.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, deletedCount })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Mahalle silinemedi.' },
      { status: 500 },
    )
  }
}
