import { cookies } from 'next/headers'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { settingService } from '@/lib/services'
import {
  USER_PERMISSIONS_SETTING_KEY,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'

export async function getCommunicationUser() {
  const cookieStore = await cookies()
  const userId = parseSessionValue(readSessionCookie(cookieStore))
  if (!userId) return null

  const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } })
  if (!user || user.status === 0) return null

  const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
  const permissions = permissionsSetting?.value as UserPermissionsById | undefined
  const permission = permissions?.[userId]
  if (permission?.isActive === false) return null

  return {
    id: user.id,
    name: user.kullanicitamadi || user.username || 'Kullanıcı',
    isAdmin: permission?.isAdmin === true || user.yetki === 1,
  }
}
