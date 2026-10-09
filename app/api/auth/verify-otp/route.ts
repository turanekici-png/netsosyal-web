import { NextResponse } from 'next/server'
import { settingService, userService } from '@/lib/services'
import { checkRateLimit, clearRateLimit } from '@/lib/security/rateLimit'
import { verifyLoginOtp, verifyOtpTicket } from '@/lib/security/loginOtp'
import { attachSessionCookie, sendLoginOtp } from '@/lib/auth/remoteLoginOtp'
import {
  USER_PERMISSIONS_SETTING_KEY,
  isLoginAllowedNow,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'
import { isRestrictedAccessFromHeaders } from '@/lib/remoteMobileAccess'

export const dynamic = 'force-dynamic'

// Uzaktan/mobil giriste login/route.ts telefona 6 haneli kod gonderir ve
// oturum cerezi VERMEZ. Kullanici kodu buraya gonderir; kod dogruysa - ve
// gun/saat + uzaktan erisim yetkisi hala gecerliyse - oturum cerezi burada
// verilir. Bu uc middleware'de "public" listesindedir (henuz oturum yok).
type VerifyOtpPayload = {
  userId?: string | number
  code?: string
  resend?: boolean
  otpTicket?: string
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as VerifyOtpPayload
    const userId = String(body.userId || '').trim()
    const code = String(body.code || '').trim()
    const ticket = String(body.otpTicket || '')

    if (!userId || !/^\d+$/.test(userId)) {
      return NextResponse.json({ success: false, error: 'Geçersiz istek.' }, { status: 400 })
    }

    // Bilet dogrulamasi: bu adima ancak SIFRE dogrulamasindan gecmis
    // (login / change-password'un otpTicket verdigi) bir istemci ulasabilir.
    // Boylece keyfi userId'lere SMS spam'i / kod brute-force'u engellenir.
    if (!verifyOtpTicket(ticket, userId)) {
      return NextResponse.json(
        { success: false, error: 'Oturum doğrulaması geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.' },
        { status: 401 },
      )
    }

    // Deneme siniri - kod tahminini (6 hane = 1e6 olasilik) engeller.
    const rl = checkRateLimit(`verify-otp:${userId}`, { limit: 12, windowMs: 10 * 60 * 1000 })
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla deneme yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
      )
    }

    const user = await userService.getById(userId)
    if (!user || Number(user.status) !== 1) {
      return NextResponse.json({ success: false, error: 'Kod doğrulanamadı.' }, { status: 401 })
    }

    // "Kodu tekrar gönder"
    if (body.resend) {
      const rlResend = checkRateLimit(`verify-otp-resend:${userId}`, { limit: 4, windowMs: 15 * 60 * 1000 })
      if (!rlResend.allowed) {
        return NextResponse.json(
          { success: false, error: 'Çok fazla kod isteği. Lütfen kısa süre sonra tekrar deneyin.' },
          { status: 429, headers: { 'Retry-After': String(rlResend.retryAfterSeconds) } },
        )
      }
      const otp = await sendLoginOtp(user)
      return NextResponse.json({ success: otp.sent, otpRequired: true, phoneHint: otp.phoneHint, resent: otp.sent, otpTicket: otp.ticket })
    }

    const verdict = verifyLoginOtp(userId, code)
    if (!verdict.ok) {
      const messages: Record<string, string> = {
        missing: 'Doğrulama kodu bulunamadı veya süresi doldu. Lütfen yeniden kod isteyin.',
        expired: 'Doğrulama kodunun süresi doldu. Lütfen yeniden kod isteyin.',
        locked: 'Çok fazla hatalı deneme. Lütfen yeniden kod isteyin.',
        mismatch: 'Doğrulama kodu hatalı.',
      }
      return NextResponse.json(
        { success: false, error: messages[verdict.reason] || 'Kod doğrulanamadı.' },
        { status: 401 },
      )
    }

    // Savunma derinligi: kod dogru olsa bile gun/saat + uzaktan erisim
    // yetkisi login/route.ts'teki ile AYNI sekilde tekrar kontrol edilir.
    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = permissionsSetting?.value as UserPermissionsById | undefined
    const permissionConfig = permissions?.[String(user.id)]

    const schedule = permissionConfig?.loginSchedule
    if (schedule && !isLoginAllowedNow(schedule)) {
      return NextResponse.json(
        { success: false, error: 'Bu saatte/günde programa giriş yetkiniz bulunmamaktadır.' },
        { status: 403 },
      )
    }

    const isAdminLike = !permissionConfig || permissionConfig.isAdmin
    if (
      !isAdminLike &&
      !permissionConfig.allowRemoteMobileAccess &&
      isRestrictedAccessFromHeaders(request.headers)
    ) {
      return NextResponse.json(
        { success: false, error: 'Bu kullanıcının uzaktan / mobil cihazdan giriş yetkisi bulunmuyor.' },
        { status: 403 },
      )
    }

    clearRateLimit(`verify-otp:${userId}`)
    return attachSessionCookie(NextResponse.json({ success: true, data: user }), user.id, request)
  } catch (error) {
    console.error('OTP doğrulama hatası:', error)
    return NextResponse.json({ success: false, error: 'Kod doğrulanamadı.' }, { status: 500 })
  }
}
