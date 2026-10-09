import type { UserPermissionConfig } from './userPermissions'

// Sayfa bazli yetki kontrolunun TEK ortak kaynagi. Once components/layout/
// AppShell.tsx (istemci, sekme/menu gizleme) ve app/page.tsx (sunucu, kok
// yonlendirme) icinde BIREBIR AYNI mantik iki ayri kopya olarak duruyordu
// ("degistirirken ikisini de guncelleyin" yorumuyla). 2026-09-14 (15. tur):
// proxy.ts'e (Node runtime middleware) DE ayni kontrolun gerekmesiyle
// (yetkisiz kullanici dogrudan adres yazarak sayfaya asla giremesin - salt
// istemci tarafinda "AccessDenied" karti degil, sunucu hicbir veri
// getirmeden once engellensin) kopya sayisi 3'e cikacakti - bu yuzden tek
// paylasilan, saf (React/Node/Edge'e bagli olmayan) bir modulde toplandi.
// Bu dosya SADECE saf fonksiyon/sabit icerir - proxy.ts (Edge/Node runtime),
// sunucu bilesenleri VE istemci bilesenleri tarafindan güvenle import
// edilebilir.

export function hasPageAccess(permissionConfig: UserPermissionConfig | null, permissionPath: string): boolean {
  if (!permissionConfig || permissionConfig.isAdmin) return true
  if (permissionConfig.isActive === false) return false
  // Kullanici istegi (2026-10-07): "Kurum İçi Mesaj" ve "Sosyal Asistan"
  // icin "HERKESE ACIK" istisnasi (14 Eylul 2026, 23. tur karari)
  // KALDIRILDI - artik diger sayfalar gibi allowedPages'te acikca
  // belirtilmedikce erisilemez. Sebep: "sadece Hizli Satis/Dernek
  // Islemleri'ne yetkili" tek-amacli (kiosk/kasiyer) hesaplarda bu ikisi
  // istisnasiz sizip "sadece X'e erissin" hedefini bozuyordu. Mevcut
  // kisitli kullanicilarin erisimini KAYBETMEMESI icin bu degisiklikle
  // AYNI ANDA, o ANDAKI tum kisitli kullanicilarin allowedPages'ine
  // '/communication' ve '/asistan' ACIKCA eklendi (bkz. migration script,
  // 2026-10-07) - yani mevcut davranis GORUNUSTE degismedi, sadece ARTIK
  // ISTENIRSE (ör. kiosk hesaplari icin) KAPATILABILIYOR.
  if (!permissionConfig.allowedPages?.length) return true

  return permissionConfig.allowedPages.some((allowedPath) => (
    permissionPath === allowedPath ||
    (permissionPath === '/dashboard' && allowedPath === '/') ||
    permissionPath.startsWith(`${allowedPath}/`) ||
    allowedPath.startsWith(`${permissionPath}/`)
  ))
}

// Kullanici istegi (2026-10-07, 3. tur): Hizli Satis'a erisim artik IKI
// AYRI yoldan saglanabilir - ya YENI, bagimsiz "/hizli-satis" yetkisi
// (herhangi bir kasa/isimli-kullanici alt maddesi "child implies parent"
// kuraliyla bunu otomatik tetikler), ya da ESKI/genel "/muhasebe" yetkisi
// (geriye donuk uyumluluk - Muhasebe modulune tam erisimi olan kullanicilar
// kaybetmesin). Sidebar gorunurlugu (sidebar.tsx), giris-sonrasi
// yonlendirme (app/page.tsx, header.tsx, proxy.ts) VE gercek erisim
// kontrolu (lib/hizliSatisProxy.ts) HEPSI bu TEK fonksiyonu kullanmali -
// yoksa biri guncellenip digeri unutuldugunda (bkz. 2026-10-07 regresyonu:
// proxy'nin erisim kontrolu duzeltildi ama sidebar gorunurlugu/yonlendirme
// unutulunca "Muhasebe" sidebar'dan TAMAMEN kayboldu) tutarsizlik olusur.
export function hasHizliSatisAccess(permissionConfig: UserPermissionConfig | null): boolean {
  return hasPageAccess(permissionConfig, '/hizli-satis') || hasPageAccess(permissionConfig, '/muhasebe')
}

// app/ altindaki GERCEK route klasorleriyle (app/(modules)/* + app/kaps,
// app/kurulum, app/login) birebir - yeni bir ust duzey sayfa eklenirse
// buraya da eklenmesi gerekir (bkz. KNOWN_INTERNAL_ROUTE_PREFIXES'in eski
// yeri olan AppShell.tsx'teki 9. tur notu).
export const KNOWN_INTERNAL_ROUTE_PREFIXES = [
  '/login', '/kurulum', '/kaps', '/online',
  '/dashboard', '/documents', '/beneficiary', '/approval-queue',
  '/communication', '/assistance', '/reports', '/requests', '/gulkart',
  '/settings', '/users', '/workflow', '/logs', '/hakedis', '/muhasebe', '/dernek',
  '/satis',
  '/forms-report', '/scheduled-tasks', '/sql-monitor', '/asistan',
]

export function isKnownInternalPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true
  return KNOWN_INTERNAL_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function getPermissionPath(pathname: string, searchParams: { get: (name: string) => string | null }): string {
  if ((pathname === '/settings' || pathname === '/settings/') && searchParams.get('tab') === 'userPermissions') {
    return '/settings/user-permissions'
  }

  if ((pathname === '/settings' || pathname === '/settings/') && searchParams.get('tab') === 'online') {
    return '/settings/online'
  }

  // "/satis" - kasiyerler icin dogrudan giris adresi (bkz. proxy.ts +
  // app/satis/page.tsx) - gercek yetki anahtari sidebar'daki "Muhasebe" ile
  // AYNI ("/muhasebe"), ayri bir izin satiri GEREKMEZ. Eskiden "/hizli-satis"
  // da vardi - kullanici istegiyle KALDIRILDI.
  if (pathname === '/satis') {
    return '/muhasebe'
  }

  return pathname
}
