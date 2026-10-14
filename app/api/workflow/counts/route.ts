import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { settingService } from '@/lib/services'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { getAnnotatedTahkikatFiles } from '../tahkikat/_lib/files'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-10-14): sol menudeki Is Akisi listelerinin (Ön
// İnceleme / Tahkikat / Sonuç Bekleyen) uzerinde bekleyen dosya sayisi
// bildirimi. Sayilar ilgili LISTELERLE BIREBIR ayni kurali kullanir:
//  - Ön İnceleme     : dosyalar.durumu = 5   (bkz. /api/workflow-preliminary-review)
//  - Tahkikat        : dosyalar.durumu = 1, yonetici degilse SADECE kisinin
//                      fiili sahibi oldugu dosyalar (bkz. /api/workflow/tahkikat -
//                      ayni getAnnotatedTahkikatFiles fonksiyonu)
//  - Sonuç Bekleyen  : dosyalar.durumu = 2   (bkz. /api/workflow/guncelleme)
export async function GET() {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = (permissionsSetting?.value as UserPermissionsById | undefined) ?? {}
    const currentPermissionConfig = permissions[String(sessionUser.id)] ?? null
    const isAdmin = !currentPermissionConfig || currentPermissionConfig.isAdmin === true

    const [statusRows, tahkikatRows] = await Promise.all([
      prisma.$queryRaw<Array<{ on_inceleme: number; sonuc_bekleyen: number }>>`
        SELECT
          COUNT(*) FILTER (WHERE d.durumu = 5)::int AS on_inceleme,
          COUNT(*) FILTER (WHERE d.durumu = 2)::int AS sonuc_bekleyen
        FROM dosyalar d
        WHERE d.durumu IN (2, 5);
      `,
      getAnnotatedTahkikatFiles(),
    ])

    const tahkikat = isAdmin
      ? tahkikatRows.length
      : tahkikatRows.filter((row) => row.effectiveOwnerId === String(sessionUser.id)).length

    return NextResponse.json({
      success: true,
      data: {
        onInceleme: Number(statusRows[0]?.on_inceleme ?? 0),
        tahkikat,
        sonucBekleyen: Number(statusRows[0]?.sonuc_bekleyen ?? 0),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'İş akışı sayıları alınamadı.' },
      { status: 500 },
    )
  }
}
