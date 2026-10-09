import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser } from '@/lib/apiAuth'
import { ensureTahkikatAtamalariTable } from '../_lib/assignments'

export const dynamic = 'force-dynamic'

// POST - oturum sahibi kendi "personel sekmesini" actiginda, ona ozel
// atanmis ve henuz gorulmemis dosyalari "gorundu" olarak isaretler (sekme
// uzerindeki bildirim rozeti boylece kaybolur). Sadece KENDI atamalarini
// etkiler - baska birinin sekmesine bakmak onun bildirimini temizlemez.
export async function POST() {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    await ensureTahkikatAtamalariTable()

    await prisma.$executeRaw`
      UPDATE tahkikat_atamalari
      SET gorundu = true
      WHERE atanankullaniciid = ${Number(sessionUser.id)} AND gorundu = false;
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Islem basarisiz.' },
      { status: 500 },
    )
  }
}
