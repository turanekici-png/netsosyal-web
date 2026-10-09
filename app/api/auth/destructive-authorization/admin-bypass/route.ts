import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { settingService } from '@/lib/services'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { createDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'

export const dynamic = 'force-dynamic'

// POST - "Tam yetkili" (admin) kullanicilar icin silme onayi sifresini
// ATLAR: kullanicinin acikca istegi uzerine, DestructiveAuthorizationDialog
// once bu ucu dener; sadece GERCEKTEN tam yetkiliyse (sunucu tarafinda
// BAGIMSIZ olarak dogrulanir - istemcinin beyanina guvenilmez) sifresiz
// gecerli bir token doner, dialog acilmadan silme islemine devam edilir.
// Kisitli kullanicilar icin 403 doner, dialog normal sekilde sifre sorar.
export async function POST() {
  const cookieStore = await cookies()
  const userId = parseSessionValue(readSessionCookie(cookieStore))
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
  const permissions = permissionsSetting?.value as UserPermissionsById | undefined
  const permissionConfig = permissions?.[userId]
  const isAdmin = !permissionConfig || permissionConfig.isAdmin

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: 'Tam yetkili değilsiniz.' }, { status: 403 })
  }

  return NextResponse.json({ success: true, token: createDestructiveAuthorization(userId) })
}
