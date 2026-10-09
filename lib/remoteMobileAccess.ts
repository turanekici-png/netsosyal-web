// Kullanici istegi (Agustos 2026): "mobil girisi ve UZAKTAN girisi yetki
// alanina baglayalim - yetki vermedigimiz kullanici mobilden ve uzaktan
// herhangi bir yerden giris yapamasin".
//
// Kural (kullanici onayi): istek YEREL AG DISI bir adres uzerinden geliyorsa
// VEYA tarayici MOBIL bir cihazsa -> bu erisim icin ozel yetki
// (UserPermissionConfig.allowRemoteMobileAccess) gerekir. Masaustu + yerel ag
// = serbest. "Tam yetkili" (isAdmin) veya hic permissionConfig'i olmayan
// kullanicilar bu kisittan MUAFtir.
//
// "Uzak" tespiti IP yerine HOST basligina bakar: kullanicilar yerel aga
// baglanirken 10.x / 192.168.x adresini, disaridan baglanirken kurumun genel
// (WAN) IP'sini yazar. Host basligi tarayicinin adres cubugundaki degerdir,
// pratikte guvenilirdir ve ters-proxy/soket-IP belirsizligi yasatmaz.

const LAN_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.local)(:\d{1,5})?$/i

// Kullanici istegi (Agustos 2026): Active Directory alan agindaki (domain)
// bilgisayarlar sunucuya cogu zaman IP yerine MAKINE ADIYLA baglanir
// (or. http://sunucu:3000 veya http://netsosyal.kurum.local). Bu adresler
// yukaridaki LAN_HOST_PATTERN'e uymadigindan "uzak" sayilip bu ic
// kullanicilardan da SMS dogrulama kodu isteniyordu. Cozum: sunucu yoneticisi
// bu ic ana bilgisayar adlarini INTERNAL_HOSTS ortam degiskenine (virgulle
// ayrilmis) yazar; buradaki host'lar - port'lu ya da portsuz - YEREL sayilir,
// dolayisiyla o adresten gelen girisler SMS kodundan MUAF olur ve "uzaktan/
// mobil erisim yetkisi" kisidina takilmaz.
//
// Bicim (hepsi kucuk/buyuk harf duyarsiz):
//   INTERNAL_HOSTS=sunucu,netsosyal.kurum.local,10.0.0.183
//   INTERNAL_HOSTS=*.kurum.local        -> tum alt alan adlari
// DIS (WAN) IP'sini veya herkese acik alan adini BURAYA YAZMAYIN - yoksa
// disaridan giren kullanicilardan da kod istenmez.
function isConfiguredInternalHost(hostWithoutPort: string): boolean {
  const raw = process.env.INTERNAL_HOSTS
  if (!raw) return false
  const host = hostWithoutPort.toLowerCase()
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry.startsWith('*.')) {
        const suffix = entry.slice(1) // ".kurum.local"
        return host.endsWith(suffix) && host.length > suffix.length
      }
      return host === entry
    })
}

export function isLanHost(host: string | null | undefined): boolean {
  const value = (host || '').trim()
  // Host belirsizse (bos) KILITLEME - yerel say. Guvenlik acisindan burada
  // "acik fail" tercih edildi cunku asil kapi (login + her istek kontrolu)
  // zaten cift katmanli; belirsiz bir header yuzunden yerel kullaniciyi
  // kilitlemek daha buyuk bir isleyis riski.
  if (!value) return true
  if (LAN_HOST_PATTERN.test(value)) return true
  // Port'u ("sunucu:3000" -> "sunucu") ayirip yapilandirilmis ic host
  // listesiyle karsilastir.
  const withoutPort = value.replace(/:\d{1,5}$/, '')
  return isConfiguredInternalHost(withoutPort)
}

const MOBILE_UA_PATTERN =
  /Mobi|Android|iPhone|iPod|iPad|IEMobile|Opera Mini|Opera Mobi|Windows Phone|BlackBerry|webOS|Kindle|Silk/i

export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  const value = (userAgent || '').trim()
  if (!value) return false
  return MOBILE_UA_PATTERN.test(value)
}

// Bu istek "kisitli baglam" mi (uzak adres VEYA mobil cihaz)?
export function isRestrictedAccessContext(
  host: string | null | undefined,
  userAgent: string | null | undefined,
): boolean {
  return !isLanHost(host) || isMobileUserAgent(userAgent)
}

// Standart Web `Headers`'tan host + user-agent okuyup kisitli baglam mi
// diye bakar (x-forwarded-host varsa oncelikli - Next kendi ekler).
export function isRestrictedAccessFromHeaders(headerBag: Headers): boolean {
  const host =
    headerBag.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    headerBag.get('host')
  const userAgent = headerBag.get('user-agent')
  return isRestrictedAccessContext(host, userAgent)
}
