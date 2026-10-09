import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'
import { AUTHORIZED_PERSONNEL_SETTING_KEY, type AuthorizedPersonnelEntry } from '@/lib/constants/authorizedPersonnel'

export const dynamic = 'force-dynamic'

// GET - "Onaya Gönder" penceresindeki kişi seçici için "Ayarlar > Yetkili
// Personeller" listesini isim/ünvan bilgisiyle döner. /api/settings/[key]
// "settings.update" yetkisi ister (Ayarlar sayfasına özel) - bu ise SADECE
// isim listesini döndüren, herhangi bir oturum açmış kullanıcının
// erişebileceği daha kısıtlı/salt-okunur bir uç noktadır.
export async function GET() {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const authorizedSetting = await settingService.getByKey(AUTHORIZED_PERSONNEL_SETTING_KEY)
    const authorizedList = (authorizedSetting?.value as AuthorizedPersonnelEntry[] | undefined) ?? []

    if (authorizedList.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    const userIds = authorizedList.map((entry) => BigInt(entry.userId)).filter((id) => !Number.isNaN(Number(id)))
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, status: 1 },
      select: { id: true, kullanicitamadi: true, username: true },
    })
    const usersById = new Map(users.map((user) => [user.id.toString(), user]))

    const data = authorizedList
      .map((entry) => {
        const user = usersById.get(entry.userId)
        if (!user) return null
        return {
          id: entry.userId,
          name: (user.kullanicitamadi || '').trim() || user.username || 'Kullanıcı',
          title: entry.title || '',
        }
      })
      .filter((entry): entry is { id: string; name: string; title: string } => entry !== null)

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Yetkili personel listesi alınamadı.' },
      { status: 500 },
    )
  }
}
