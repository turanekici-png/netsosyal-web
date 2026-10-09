import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getCommunicationUser } from '@/lib/communicationAuth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const currentUser = await getCommunicationUser()
  if (!currentUser) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const users = await prisma.user.findMany({
    where: { status: 1, id: { not: currentUser.id } },
    select: { id: true, kullanicitamadi: true, username: true },
    orderBy: [{ kullanicitamadi: 'asc' }, { username: 'asc' }],
  })

  return NextResponse.json({
    success: true,
    data: users.map((user) => ({
      id: user.id.toString(),
      name: user.kullanicitamadi || user.username || `Kullanıcı ${user.id}`,
    })),
    canPublishAnnouncement: currentUser.isAdmin,
  })
}
