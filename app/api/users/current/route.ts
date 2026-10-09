import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { settingService, userService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import {
  USER_PERMISSIONS_SETTING_KEY,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'
import { isRestrictedAccessFromHeaders } from '@/lib/remoteMobileAccess'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const userId = parseSessionValue(readSessionCookie(cookieStore))
    const user = userId ? await userService.getById(userId) : null

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Oturum bulunamadi.' },
        { status: 401 },
      )
    }

    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = permissionsSetting?.value as UserPermissionsById | undefined
    const userPermission = permissions?.[String(user.id)]

    if (user.status === 0 || userPermission?.isActive === false) {
      return NextResponse.json(
        { success: false, error: 'Kullanici pasif durumda. Uygulamaya erisim kapatildi.' },
        { status: 403 },
      )
    }

    // Uzaktan (yerel ag disi) / mobil cihaz erisim yetkisi - bkz.
    // lib/remoteMobileAccess.ts. "Tam yetkili" (isAdmin) veya hic
    // permissionConfig'i olmayan kullanicilar MUAF. Bu, istemci onyukleme
    // sirasinda (sidebar /api/users/current) net bir "engellendi" ekrani
    // gostermek icin - asil kapi login + requireApiAccess'te.
    if (
      userPermission &&
      !userPermission.isAdmin &&
      !userPermission.allowRemoteMobileAccess &&
      isRestrictedAccessFromHeaders(await headers())
    ) {
      return NextResponse.json(
        { success: false, error: 'Uzaktan / mobil cihazdan erişim yetkiniz bulunmuyor. Yerel ağdaki bir bilgisayardan giriş yapın.' },
        { status: 403 },
      )
    }

    return NextResponse.json({ success: true, data: user })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    )
  }
}

// Kullanicinin KENDI profil bilgilerini (telefon/adres) guncellemesi -
// "users.manage" yetkisi GEREKMEZ, sadece oturum acmis olmak yeterli (bkz.
// app/api/users/current/password/route.ts - ayni self-service deseni).
export async function PATCH(request: Request) {
  try {
    const cookieStore = await cookies()
    const userId = parseSessionValue(readSessionCookie(cookieStore))
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({})) as { phone?: string; address?: string }

    const updatedUser = await withAuditedWrite(
      (tx) => userService.update(userId, {
        phone: typeof body.phone === 'string' ? (body.phone.trim() || null) : undefined,
        address: typeof body.address === 'string' ? (body.address.trim() || null) : undefined,
      }, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true, data: updatedUser })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Profil güncellenemedi.' },
      { status: 400 },
    )
  }
}
