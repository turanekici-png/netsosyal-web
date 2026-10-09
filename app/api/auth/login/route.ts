import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { settingService, userService } from '@/lib/services'
import { checkRateLimit, clearRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'
import { attachSessionCookie, isRemoteLoginRequest, sendLoginOtp } from '@/lib/auth/remoteLoginOtp'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import {
  USER_PERMISSIONS_SETTING_KEY,
  isLoginAllowedNow,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'
import { isRestrictedAccessFromHeaders } from '@/lib/remoteMobileAccess'

export const dynamic = 'force-dynamic'

type LoginPayload = {
  username?: string
  password?: string
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as LoginPayload
    const username = String(body.username || '').trim()
    const password = String(body.password || '').trim()
    const rateLimitKey = `login:${getRequestClientKey(request)}:${username.toLocaleLowerCase('tr-TR')}`
    const accountRateLimitKey = `login-account:${username.toLocaleLowerCase('tr-TR')}`

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Kullanici adi ve sifre zorunludur.' },
        { status: 400 },
      )
    }

    // Kullanici istegi: kilitlenme suresi eskiden 15 dakikaydi - artik 1
    // dakika (60sn). Limit (deneme sayisi) DEGISMEDI, sadece pencere suresi
    // kisaltildi - bu yuzden hem kisitlama hem de "sifirlanma" (resetAt)
    // artik 1 dakikalik bir pencerede hesaplanir.
    const LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 1000
    const rateLimit = checkRateLimit(rateLimitKey, { limit: 10, windowMs: LOGIN_RATE_LIMIT_WINDOW_MS })
    const accountRateLimit = checkRateLimit(accountRateLimitKey, { limit: 30, windowMs: LOGIN_RATE_LIMIT_WINDOW_MS })
    if (!rateLimit.allowed || !accountRateLimit.allowed) {
      const retryAfterSeconds = Math.max(rateLimit.retryAfterSeconds, accountRateLimit.retryAfterSeconds)
      return NextResponse.json(
        {
          success: false,
          error: 'Çok fazla başarısız giriş denemesi yapıldı. Lütfen kısa süre sonra tekrar deneyin.',
          // Kullanici istegi: giris sayfasi bu sureyi geri sayim olarak
          // gostersin diye JSON govdesinde de gonderilir (Retry-After
          // header'i istemci tarafinda okunabilir olsa da, JSON'da
          // gonderilmesi daha basit/guvenilir).
          retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      )
    }

    const user = await userService.authenticate(username, password)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Kullanici adi veya sifre hatali.' },
        { status: 401 },
      )
    }

    clearRateLimit(rateLimitKey)
    clearRateLimit(accountRateLimitKey)

    // Giris gun/saat kisiti (Ayarlar > Kullanici Yetkileri > Giris Izni) -
    // sifre dogru olsa bile, kullanicinin izinli oldugu gun/saat disindaysa
    // oturum acilmaz. "requireApiAccess" bu kisidi zaten ACIK oturumlar icin
    // de kontrol ediyor (bkz. lib/apiAuth.ts) - burasi ayrica GIRIS ANINDA
    // net bir mesajla engellemek icin.
    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = permissionsSetting?.value as UserPermissionsById | undefined
    const loginPermissionConfig = permissions?.[String(user.id)]
    const loginSchedule = loginPermissionConfig?.loginSchedule
    if (loginSchedule && !isLoginAllowedNow(loginSchedule)) {
      return NextResponse.json(
        { success: false, error: 'Bu saatte/günde programa giriş yetkiniz bulunmamaktadır.' },
        { status: 403 },
      )
    }

    // Uzaktan (yerel ag disi) / mobil cihaz erisimi - "Tam yetkili" veya hic
    // permissionConfig'i olmayan kullanicilar MUAF; digerleri icin
    // "allowRemoteMobileAccess" acikca verilmis olmali (bkz.
    // lib/remoteMobileAccess.ts, Ayarlar > Kullanici Yetkileri).
    const isLoginAdminLike = !loginPermissionConfig || loginPermissionConfig.isAdmin
    if (
      !isLoginAdminLike &&
      !loginPermissionConfig.allowRemoteMobileAccess &&
      isRestrictedAccessFromHeaders(request.headers)
    ) {
      return NextResponse.json(
        { success: false, error: 'Bu kullanıcının uzaktan / mobil cihazdan giriş yetkisi bulunmuyor. Yerel ağdaki bir bilgisayardan giriş yapın veya yöneticinize başvurun.' },
        { status: 403 },
      )
    }

    // "kullanicilar.sifre_degistirmeli" - eski sistemden gelen HERKES icin
    // (eski sifresi ne olursa olsun, sadece "123" degil) varsayilan TRUE
    // olan kalici bir bayrak (bkz. migration + schema.prisma). Once sadece
    // "123" degerini kontrol ediyorduk ama kullanicinin GERCEK eski sifresi
    // "123" olmayabiliyordu (canli tespit edildi) - bu yuzden artik GERCEK,
    // veritabaninda tutulan bir durum kullaniliyor: kim/hangi sifreyle
    // girerse girsin, bu bayrak true oldugu surece oturum acilmadan ONCE
    // sifre degistirmeye zorlanir. Kullanici kendi sifresini basariyla
    // degistirdiginde (change-password/route.ts) bayrak false'a ceker.
    if (user.mustChangePassword) {
      return NextResponse.json({
        success: true,
        mustChangePassword: true,
        data: { id: user.id, username: user.username, name: user.name },
      })
    }

    // UZAKTAN giris (yerel ag disi - Host basligina gore, mobil/web farketmez):
    // sifre dogru olsa bile, kullanicinin kayitli cep telefonuna SMS ile
    // 6 haneli tek-kullanimlik kod gonderilir; oturum cerezi ancak
    // /api/auth/verify-otp ile kod dogrulandiktan sonra verilir. Yerel agdan
    // (10.x / 192.168.x / localhost) girisler - mobil de olsa - bu adimdan
    // MUAFtir. Telefonu kayitli OLMAYAN veya kod GONDERILEMEYEN kullanici
    // uzaktan GIRIS YAPAMAZ (kullanici istegi).
    if (isRemoteLoginRequest(request)) {
      // Zaman asimi suresi (SESSION_IDLE_SECONDS = 180 dk) icinde bu
      // cihazdan hala GECERLI bir oturum cerezi geliyorsa, kullanici yakin
      // zamanda zaten SMS koduyla dogrulanmis demektir - tekrar kod
      // gondermeden oturumu tazele. Sure dolunca (cerez gecersiz/yok/baska
      // kullanici) normal SMS akisi devreye girer. (Kullanici istegi.)
      const priorSessionUserId = parseSessionValue(readSessionCookie(await cookies()))
      if (priorSessionUserId && String(priorSessionUserId) === String(user.id)) {
        return attachSessionCookie(
          NextResponse.json({ success: true, data: user }),
          user.id,
          request,
        )
      }

      const otp = await sendLoginOtp(user)
      if (otp.sent) {
        return NextResponse.json({
          success: true,
          otpRequired: true,
          data: { id: user.id, username: user.username, name: user.name },
          phoneHint: otp.phoneHint,
          otpTicket: otp.ticket,
        })
      }

      // Kullanici istegi (2026-09-15): telefon numarasi kayitli OLMAYAN
      // kullanicilar (canli DB'de aktif kullanicilarin ~%60'i) daha once
      // uzaktan giriste TAMAMEN ENGELLENIYORDU - dogru sifreyi girseler bile
      // "telefon yok" hatasi aliyorlardi, bu da kullanici tarafinda "sifrem
      // kabul edilmiyor" seklinde algilaniyordu. Telefon numaralari
      // toplanana kadar (kullanici: "telefon bilgilerini sonra girelim")
      // gecici/kalici olarak: telefon YOKSA OTP adimi ATLANIR, sifre dogru
      // oldugu icin dogrudan oturum acilir. Telefonu OLUP da SMS
      // GONDERILEMEYEN (send-failed - SMS servisi gecici sorunlu) durumda
      // ENGELLEME AYNEN devam eder - bu durumda kullaniciya guvenlik
      // amaciyla dogrulama sart kosulur.
      if (otp.reason === 'no-phone') {
        console.warn(
          `[uzaktan-giris] Kullanici "${username}" (id=${user.id}) icin kayitli telefon yok - OTP atlanarak dogrudan giris yapildi.`,
        )
        return attachSessionCookie(NextResponse.json({ success: true, data: user }), user.id, request)
      }

      console.warn(
        `[uzaktan-giris] Kullanici "${username}" (id=${user.id}) uzaktan giris denedi ancak dogrulama kodu gonderilemedi (${otp.reason}) - giris ENGELLENDI.`,
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Doğrulama kodu telefonunuza gönderilemedi (SMS servisi geçici olarak yanıt vermiyor). Kısa süre sonra tekrar deneyin veya yöneticinize başvurun.',
        },
        { status: 403 },
      )
    }

    return attachSessionCookie(NextResponse.json({ success: true, data: user }), user.id, request)
  } catch (error) {
    // Oturumsuz/herkese acik bu uc noktada ham hata mesaji (ör. veritabani
    // hata detayi) istemciye DONMEZ - sadece sunucu loguna yazilir.
    console.error('Giris hatasi:', error)
    return NextResponse.json(
      { success: false, error: 'Giris yapilamadi.' },
      { status: 500 },
    )
  }
}
