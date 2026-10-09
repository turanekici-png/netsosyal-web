import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { DEFAULT_STARTUP_PAGE, STARTUP_PAGE_OPTIONS } from '@/lib/constants/startupPages'
import {
  USER_PERMISSIONS_SETTING_KEY,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'
import { hasPageAccess as canAccessPath, getPermissionPath, hasHizliSatisAccess } from '@/lib/constants/pageAccess'

// "/satis" (Hizli Satis) gibi gercek sayfa yolu ile yetki-kontrol yolu
// FARKLI olan birkac ozel durum var (bkz. getPermissionPath - "/satis"
// yetki icin "/muhasebe"ye eslenir). Bu sunucu bileseninde gercek bir
// URLSearchParams yok (settings sekmeleri gibi searchParams'a bakan
// ozel durumlar burada hic devreye girmez) - no-op bir stub yeterli.
const noopSearchParams = { get: () => null }

export const dynamic = 'force-dynamic'

// Kullanici istegi (14 Eylul 2026, 14. tur): giriste HERKES icin (hem
// masaustu hem mobil, yetkisi olsa BILE) uygulama koku ("/") her zaman
// Dosya Yonetimi'ne (DEFAULT_STARTUP_PAGE) duser. Onceki turde (13. tur)
// eklenen kisisel "baslangic sayfasi sec" tercihi (header > "İşlemler" >
// bkz. app/api/user-startup-page/route.ts) ARTIK bu yonlendirmede
// KULLANILMIYOR - kullanici o secimin menude KALMASINI istedi (ve secenek
// listesi zaten yetkiye gore filtreleniyor, bkz. header.tsx
// "visibleStartupPageOptions"), ama giris sonrasi HER ZAMAN Dosya
// Yonetimi acilsin istedi.
//
// Yine de: Dosya Yonetimi'ne erisimi olmayan (cok nadir) bir kullanici
// icin AccessDenied karti yerine erisimi olan ilk sayfaya duser (bkz.
// STARTUP_PAGE_OPTIONS taramasi asagida).
export default async function RootPage() {
  let target: string = DEFAULT_STARTUP_PAGE

  try {
    const userId = parseSessionValue(readSessionCookie(await cookies()))
    if (userId) {
      const permissionSetting = await prisma.setting.findUnique({ where: { key: USER_PERMISSIONS_SETTING_KEY } })
      const permissions = permissionSetting?.value as UserPermissionsById | undefined
      const permissionConfig = permissions?.[userId] ?? null

      // Kullanici istegi (2026-10-07, 3. tur): "/satis" (Hizli Satis) artik
      // iki ayri yolla erisilebilir (bkz. hasHizliSatisAccess - YENI
      // bagimsiz "/hizli-satis" yetkisi VEYA ESKI genel "/muhasebe"
      // yetkisi) - sade getPermissionPath+canAccessPath ikilisi bunu tek
      // bir yola indirgedigi icin (ya biri ya digeri) EKSIK kaliyordu.
      const canAccessOption = (path: string) => (
        path === '/satis' ? hasHizliSatisAccess(permissionConfig) : canAccessPath(permissionConfig, getPermissionPath(path, noopSearchParams))
      )

      if (!canAccessOption(target)) {
        const fallback = STARTUP_PAGE_OPTIONS.find((opt) => canAccessOption(opt.path))
        target = fallback?.path ?? '/documents'
      }
    }
  } catch {
    // ayar okunamadi - varsayilan
  }
  redirect(target)
}
