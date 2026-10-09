import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { userService } from '@/lib/services'
import { checkRateLimit, clearRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'
import { isValidNewPassword, PASSWORD_POLICY_DESCRIPTION } from '@/lib/security/passwordPolicy'
import { attachSessionCookie, isRemoteLoginRequest, sendLoginOtp } from '@/lib/auth/remoteLoginOtp'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Bu uc nokta, login/route.ts "mustChangePassword: true" donduğunde devreye
// girer - kullanici HENUZ oturum cerezine sahip degildir (login sirasinda
// bilincli olarak verilmedi), bu yuzden burada ESKI kullanici adi + mevcut
// (varsayilan) sifre YENIDEN dogrulanir - istemciye guvenilmiyor. Basarili
// sifre degisikliginden SONRA oturum cerezi burada verilir; boylece giris
// akisi ancak sifre gercekten degistirildiginde tamamlanmis olur.
type ChangePasswordPayload = {
  username?: string
  currentPassword?: string
  newPassword?: string
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as ChangePasswordPayload
    const username = String(body.username || '').trim()
    const currentPassword = String(body.currentPassword || '').trim()
    const newPassword = String(body.newPassword || '').trim()

    if (!username || !currentPassword || !newPassword) {
      return NextResponse.json(
        { success: false, error: 'Kullanıcı adı, mevcut şifre ve yeni şifre zorunludur.' },
        { status: 400 },
      )
    }

    const rateLimitKey = `change-password:${getRequestClientKey(request)}:${username.toLocaleLowerCase('tr-TR')}`
    const rateLimit = checkRateLimit(rateLimitKey, { limit: 10, windowMs: 15 * 60 * 1000 })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla deneme yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      )
    }

    if (!isValidNewPassword(newPassword)) {
      return NextResponse.json(
        { success: false, error: `Yeni şifre kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}` },
        { status: 400 },
      )
    }

    // Mevcut sifreyi YENIDEN dogrula - istemcinin gonderdigi username/
    // currentPassword'e kor kor guvenilmiyor.
    const user = await userService.authenticate(username, currentPassword)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Mevcut şifre hatalı.' },
        { status: 401 },
      )
    }

    // userService.update'in genel tipinde (IUser) "password" alani disari
    // aktarilan/genel tipte bilincli olarak yok (mapUser onu siler) - servis
    // GERCEKTE bunu "as any" ile ic taraftan okuyor (bkz. user.service.ts),
    // burada da ayni kurulu kaliba uyuluyor. mustChangePassword:false ACIKCA
    // gonderiliyor - aksi halde update() sifre degisince VARSAYILAN olarak
    // bayragi TEKRAR true yapardi (admin'in birine yeni sifre atadigi durum
    // icin dogru varsayilan, ama burada kullanici KENDI sifresini basariyla
    // degistirdigi icin bayragin kalkmasi gerekiyor).
    await userService.update(user.id, { password: newPassword, mustChangePassword: false } as any)
    clearRateLimit(rateLimitKey)

    // UZAKTAN ise (yerel ag disi): sifre degistirildi ama oturum cerezi
    // verilmeden once telefona 6 haneli kod gonderilir (login/route.ts ile
    // ayni kural). Telefon yoksa / kod gonderilemezse giris ENGELLENIR -
    // ancak sifre ZATEN degistirilmis olur (kullanici yerel agdan girip
    // devam edebilir).
    if (isRemoteLoginRequest(request)) {
      // login/route.ts ile ayni kural: zaman asimi suresi icinde bu cihazdan
      // hala gecerli bir oturum cerezi geliyorsa SMS kodu istenmeden oturum
      // acilir.
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

      // Kullanici istegi (2026-09-15): bkz. login/route.ts ayni tarihli not -
      // telefon numarasi kayitli OLMAYAN kullanicilar sifrelerini basariyla
      // degistirseler bile burada ENGELLENIYORDU. Telefon yoksa OTP adimi
      // atlanip dogrudan oturum acilir; telefonu olup SMS GONDERILEMEYEN
      // durumda (send-failed) engelleme aynen devam eder.
      if (otp.reason === 'no-phone') {
        console.warn(
          `[uzaktan-giris] Kullanici id=${user.id} icin kayitli telefon yok - sifre degisikliginden sonra OTP atlanarak dogrudan giris yapildi.`,
        )
        return attachSessionCookie(NextResponse.json({ success: true, data: user }), user.id, request)
      }

      console.warn(
        `[uzaktan-giris] Kullanici id=${user.id} uzaktan sifre degistirdi ancak dogrulama kodu gonderilemedi (${otp.reason}) - giris ENGELLENDI.`,
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Şifreniz güncellendi ancak doğrulama kodu telefonunuza gönderilemedi. Kısa süre sonra yeni şifrenizle tekrar giriş yapmayı deneyin.',
        },
        { status: 403 },
      )
    }

    return attachSessionCookie(NextResponse.json({ success: true, data: user }), user.id, request)
  } catch (error) {
    console.error('Sifre degistirme hatasi:', error)
    return NextResponse.json(
      { success: false, error: 'Şifre değiştirilemedi.' },
      { status: 500 },
    )
  }
}
