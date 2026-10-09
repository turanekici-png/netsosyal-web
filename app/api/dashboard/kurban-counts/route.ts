import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { ensureKurbanCountsTable } from '@/lib/services/kurbanCounts.service'

export const dynamic = 'force-dynamic'

type KurbanCountPayload = {
  tarih?: string
  kurbanTuru?: string
  kurbanCinsi?: string
  adet?: string | number
}

const KURBAN_TURLERI = new Set(['Vekaleten Kurban Kesimi', 'Vacip Kurban Kesimi'])
const KURBAN_CINSLERI = new Set(['Büyük Baş Kurban', 'Küçük Baş Kurban'])

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null

  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return text
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanCount(value: unknown) {
  const count = Number(value)
  return Number.isInteger(count) && count > 0 ? count : null
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/dashboard/kurban-records' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as KurbanCountPayload
  const tarih = cleanDate(payload.tarih)
  const kurbanTuru = cleanText(payload.kurbanTuru, 100)
  const kurbanCinsi = cleanText(payload.kurbanCinsi, 100)
  const adet = cleanCount(payload.adet)

  if (!tarih || !kurbanTuru || !kurbanCinsi || !adet) {
    return NextResponse.json({ success: false, error: 'Tarih, kurban turu, kurban cinsi ve adet bilgisi zorunludur.' }, { status: 400 })
  }

  if (!KURBAN_TURLERI.has(kurbanTuru) || !KURBAN_CINSLERI.has(kurbanCinsi)) {
    return NextResponse.json({ success: false, error: 'Kurban turu veya kurban cinsi gecersiz.' }, { status: 400 })
  }

  try {
    await ensureKurbanCountsTable()

    const rows = await prisma.$queryRaw<{ id: bigint }[]>`
      INSERT INTO public.yrd_kurban (
        tarih, kurban_turu, kurban_cinsi, adet, ilkislemtarihi, islemtarihi
      )
      VALUES (
        ${tarih}::date, ${kurbanTuru}, ${kurbanCinsi}, ${adet}, NOW(), NOW()
      )
      RETURNING id;
    `

    return NextResponse.json({
      success: true,
      data: {
        id: rows[0]?.id?.toString() ?? null,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kurban sayisi kaydedilemedi.' },
      { status: 500 },
    )
  }
}
