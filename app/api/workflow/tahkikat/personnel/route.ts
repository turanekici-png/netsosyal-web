import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { getTahkikatPersonelListesi } from '../_lib/personnel'
import { getAnnotatedTahkikatFiles } from '../_lib/files'

export const dynamic = 'force-dynamic'

// GET - Tahkikat sayfasindaki "personel sekmeleri" icin: kullanici adi
// "tahkikat" ile BASLAYAN (ör. tahkikat1, tahkikat2) aktif kullanicilar +
// her birinin o an FIILEN sahip oldugu (manuel atama VEYA o ayki mahalle/
// paket rotasyonu - getAnnotatedTahkikatFiles ile ANA LISTEYLE (bkz.
// ../route.ts) AYNI hesap) dosya sayisi + bunlardan manuel atanip HENUZ
// "gorulmemis" olanlarin sayisi (bildirim rozeti). Kullanici istegi
// (2026-10-08, 4. tur): "hangi mahalle hangi görevlide ise o mahalle
// sadece o kullanıcının listesinde görünsün" - onceki surum SADECE manuel
// atama tablosunu (tahkikat_atamalari) sayiyordu, bu yuzden sekme
// rozetleri mahalle-rotasyonuyla gelen dosyalari "0" gosteriyordu (ana
// liste dogru filtreliyordu ama sekme sayaclari tutmuyordu) - duzeltildi.
export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ page: '/workflow/tahkikat' })
    if (accessDenied) return accessDenied

    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = (permissionsSetting?.value as UserPermissionsById | undefined) ?? {}
    const currentPermissionConfig = permissions[String(sessionUser.id)] ?? null
    const canAssign = !currentPermissionConfig || currentPermissionConfig.isAdmin === true

    const eligibleUsers = await getTahkikatPersonelListesi()
    const allFiles = await getAnnotatedTahkikatFiles()

    const countsByUserId = new Map<string, { assigned: number; unseen: number }>()
    for (const file of allFiles) {
      if (!file.effectiveOwnerId) continue
      const current = countsByUserId.get(file.effectiveOwnerId) ?? { assigned: 0, unseen: 0 }
      current.assigned += 1
      if (file.assignedUserId === file.effectiveOwnerId && file.assignedSeen === false) {
        current.unseen += 1
      }
      countsByUserId.set(file.effectiveOwnerId, current)
    }

    const personnel = eligibleUsers
      .map((user) => {
        const counts = countsByUserId.get(user.id) ?? { assigned: 0, unseen: 0 }
        return {
          id: user.id,
          name: user.name,
          assignedCount: counts.assigned,
          unseenCount: counts.unseen,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'))

    return NextResponse.json({
      success: true,
      data: {
        canAssign,
        currentUserId: String(sessionUser.id),
        personnel,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Tahkikat personeli alınamadı.' },
      { status: 500 },
    )
  }
}
