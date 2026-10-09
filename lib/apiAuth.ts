import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { isRestrictedAccessFromHeaders } from '@/lib/remoteMobileAccess'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { settingService, userService } from '@/lib/services'
import {
  USER_PERMISSIONS_SETTING_KEY,
  isActionScheduleActive,
  isLoginAllowedNow,
  type UserPermissionConfig,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'
import { AUTHORIZED_PERSONNEL_SETTING_KEY, type AuthorizedPersonnelEntry } from '@/lib/constants/authorizedPersonnel'

type ApiAccessRule = {
  action?: string
  page?: string
}

function hasPageAccess(permissionConfig: UserPermissionConfig, permissionPath: string) {
  return (permissionConfig.allowedPages || []).some((allowedPath) => (
    permissionPath === allowedPath ||
    (permissionPath === '/dashboard' && allowedPath === '/') ||
    permissionPath.startsWith(`${allowedPath}/`) ||
    allowedPath.startsWith(`${permissionPath}/`)
  ))
}

function hasActionAccess(permissionConfig: UserPermissionConfig, actionId: string) {
  if (!(permissionConfig.allowedActions || []).includes(actionId)) return false
  return isActionScheduleActive(permissionConfig.actionSchedules?.[actionId])
}

// React.cache ile bu istek suresince (request-scoped) sonucu bellekte tutar.
// requireApiAccess() zaten oturum kullanicisini cozmek icin bunu cagiriyor;
// yazma islemlerini denetleyen withAuditedWrite/stampAuditUser da (lib/db/auditContext.ts)
// AYNI istekte tekrar cagiriyordu - bu da her kayit isleminde kullaniciyi
// veritabanindan IKI KEZ sorgulamaya (gereksiz bir gecikmeye) yol aciyordu.
// cache() sayesinde ayni istek icinde kac kez cagrilirsa cagrilsin
// veritabanina sadece bir kez gidilir.
export const getSessionUser = cache(async () => {
  const cookieStore = await cookies()
  const userId = parseSessionValue(readSessionCookie(cookieStore))
  return userId ? await userService.getById(userId) : null
})

export async function requireApiAccess(rule: ApiAccessRule) {
  const user = await getSessionUser()

  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Oturum bulunamadi.' },
      { status: 401 },
    )
  }

  const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
  const permissions = permissionsSetting?.value as UserPermissionsById | undefined
  const permissionConfig = permissions?.[String(user.id)]

  if (user.status === 0 || permissionConfig?.isActive === false) {
    return NextResponse.json(
      { success: false, error: 'Kullanici pasif durumda.' },
      { status: 403 },
    )
  }

  // Giris gun/saat kisiti - "tam yetkili kullanici" olsa bile programa HANGI
  // gun/saatlerde girilebilecegini belirler, bu yuzden isAdmin bypass'indan
  // ONCE kontrol ediliyor. Zaten acik bir oturum, kisit saatine girince bir
  // sonraki istekte burada kesilir (aninda cikis yapilmis gibi davranir).
  if (permissionConfig?.loginSchedule && !isLoginAllowedNow(permissionConfig.loginSchedule)) {
    return NextResponse.json(
      { success: false, error: 'Bu saatte/günde programa giriş yetkiniz bulunmamaktadır.' },
      { status: 403 },
    )
  }

  // Uzaktan (yerel ag disi adres) / mobil cihaz erisimi - "Tam yetkili"
  // veya hic permissionConfig'i olmayan kullanicilar MUAF; digerleri icin
  // "allowRemoteMobileAccess" acikca verilmis olmali. isAdmin bypass'indan
  // ONCE kontrol edilir; masaustunde acilan bir oturum telefona/uzaga
  // tasinsa bile bir sonraki istekte burada kesilir (bkz.
  // lib/remoteMobileAccess.ts).
  if (
    permissionConfig &&
    !permissionConfig.isAdmin &&
    !permissionConfig.allowRemoteMobileAccess &&
    isRestrictedAccessFromHeaders(await headers())
  ) {
    return NextResponse.json(
      { success: false, error: 'Uzaktan / mobil cihazdan erişim yetkiniz bulunmuyor.' },
      { status: 403 },
    )
  }

  if (!permissionConfig || permissionConfig.isAdmin) return null

  // Bir islem yetkisi verildiyse sayfayi gorebilmek tek basina yeterli degildir.
  // Salt goruntuleme rotalari ise sayfa yetkisiyle calismaya devam eder.
  if (rule.action && hasActionAccess(permissionConfig, rule.action)) return null
  if (!rule.action && rule.page && hasPageAccess(permissionConfig, rule.page)) return null

  // Islem yetkisi verilmis ama su an gecerli zaman disinda ise (gunluk saat
  // araligi ve/veya tarih araligi ile kisitlanmis) daha aciklayici bir hata
  // donduruyoruz - "hicbir zaman yetkiniz yok" ile "su an disinda yetkiniz
  // yok" mesajlarinin ayni gorunmesi kullaniciyi yaniltir.
  if (
    rule.action &&
    (permissionConfig.allowedActions || []).includes(rule.action) &&
    !isActionScheduleActive(permissionConfig.actionSchedules?.[rule.action])
  ) {
    return NextResponse.json(
      { success: false, error: 'Bu islem icin su anda yetkiniz yok (izin verilen zaman araligi disinda).' },
      { status: 403 },
    )
  }

  return NextResponse.json(
    { success: false, error: 'Bu islem icin yetkiniz yok.' },
    { status: 403 },
  )
}

// Sadece "tam yetkili" (admin) kullanicilarin yapabilmesi gereken islemler
// icin (ör. kurumun PAYLAŞILAN WhatsApp oturumunu baglama/kesme/yeniden
// adlandirma - bkz. app/api/whatsapp/*). Ayni "isAdmin" semantigini kullanir:
// hic permissionConfig kaydi yoksa (varsayilan) VEYA isAdmin=true ise gecer.
export async function requireAdminAccess() {
  const user = await getSessionUser()

  if (!user) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
  const permissions = permissionsSetting?.value as UserPermissionsById | undefined
  const permissionConfig = permissions?.[String(user.id)]
  const isAdmin = !permissionConfig || permissionConfig.isAdmin

  if (!isAdmin) {
    return NextResponse.json({ success: false, error: 'Bu işlem için tam yetkili (admin) olmanız gerekir.' }, { status: 403 })
  }

  return null
}

// Onay gerektiren islemler (bkz. app/api/documents/approval-requests) icin -
// sistem yoneticileri (isAdmin) HER ZAMAN gecer (genel yetkilendirme
// kuraliyla tutarli), digerleri ise "Ayarlar > Yetkili Personeller"
// listesinde (bkz. lib/constants/authorizedPersonnel.ts) olmalidir.
export async function requireAuthorizedPersonnelOrAdmin() {
  const user = await getSessionUser()

  if (!user) {
    return { user: null, response: NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 }) }
  }

  const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
  const permissions = permissionsSetting?.value as UserPermissionsById | undefined
  const permissionConfig = permissions?.[String(user.id)]
  const isAdmin = !permissionConfig || permissionConfig.isAdmin

  if (isAdmin) return { user, response: null }

  const authorizedSetting = await settingService.getByKey(AUTHORIZED_PERSONNEL_SETTING_KEY)
  const authorizedList = (authorizedSetting?.value as AuthorizedPersonnelEntry[] | undefined) ?? []
  const isAuthorized = authorizedList.some((entry) => entry.userId === String(user.id))

  if (!isAuthorized) {
    return {
      user,
      response: NextResponse.json(
        { success: false, error: 'Bu işlem için "Yetkili Personel" olmanız gerekir.' },
        { status: 403 },
      ),
    }
  }

  // "Yetkili Personel" olmak TEK BASINA yetmez - kisitli bir kullaniciya
  // "Kullanıcı Yetkileri"nden "Onay Bekleyenler" (/approval-queue) sayfa
  // erisimi ayrica KAPATILMIS olabilir (bkz. app/(modules)/settings/page.tsx
  // - fixedPermissionPages). Bos allowedPages "tam yetkili" ile ayni anlama
  // gelir (bkz. hasPageAccess'in cagrildigi diger yerler, ör. sidebar.tsx).
  const hasPageGrant = !permissionConfig.allowedPages?.length || hasPageAccess(permissionConfig, '/approval-queue')
  if (!hasPageGrant) {
    return {
      user,
      response: NextResponse.json(
        { success: false, error: 'Bu sayfayı görüntüleme yetkiniz yok.' },
        { status: 403 },
      ),
    }
  }

  return { user, response: null }
}
