'use client'

import { useEffect, useState } from 'react'
import {
  USER_PERMISSIONS_SETTING_KEY,
  isActionScheduleActive,
  type UserPermissionConfig,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'

// Kullanici istegi: bazi ozellikler (ör. Ana Sayfa duzenini surukle-birak
// ile degistirme) SADECE belirli bir islem yetkisine sahip personelde acik
// olsun. Bu kanca, app/(modules)/documents/page.tsx'teki AYNI "mevcut
// kullaniciyi + tum kullanicilarin yetki haritasini cek, kendi kaydini sec"
// desenini (canUseAction) tekrar tekrar yazmamak icin genel amacli hale
// getirir - sunucu tarafindaki requireApiAccess/hasActionAccess ile AYNI
// semantigi kullanir (isAdmin => her zaman izinli, allowedActions bossa =>
// kisitlanmamis sayilir, aksi halde actionId listede VE zaman penceresi
// icinde olmali).
export function useCanUseAction() {
  const [permissionConfig, setPermissionConfig] = useState<UserPermissionConfig | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    let isCancelled = false

    async function loadPermissions() {
      try {
        const userResponse = await fetch('/api/users/current')
        const userPayload = await userResponse.json().catch(() => null)
        const userId = String(userPayload?.data?.id ?? '')
        if (!userResponse.ok || !userId) return

        const permissionResponse = await fetch(`/api/settings/${USER_PERMISSIONS_SETTING_KEY}`)
        if (!permissionResponse.ok) return

        const permissionPayload = await permissionResponse.json()
        const permissions = permissionPayload?.data?.value as UserPermissionsById | undefined

        if (!isCancelled) {
          setPermissionConfig(permissions?.[userId] ?? null)
        }
      } catch {
        if (!isCancelled) setPermissionConfig(null)
      } finally {
        if (!isCancelled) setIsLoaded(true)
      }
    }

    void loadPermissions()

    return () => {
      isCancelled = true
    }
  }, [])

  const canUseAction = (actionId: string) => {
    if (!permissionConfig || permissionConfig.isAdmin) return true
    if (permissionConfig.isActive === false) return false
    if (!permissionConfig.allowedActions?.length) return true
    if (!permissionConfig.allowedActions.includes(actionId)) return false

    return isActionScheduleActive(permissionConfig.actionSchedules?.[actionId])
  }

  return { canUseAction, isLoaded }
}
