import 'server-only'
import { NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, createSessionValue } from '@/lib/auth'
import { isLanHost } from '@/lib/remoteMobileAccess'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'
import { sendSmsMessage } from '@/lib/services/smsProvider.service'
import { prisma } from '@/lib/db/prisma'
import { createLoginOtp, createOtpTicket, LOGIN_OTP_TTL_SECONDS } from '@/lib/security/loginOtp'

export function isHttpsRequest(request: Request): boolean {
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedProtocol) return forwardedProtocol === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

// Oturum cerezini bir NextResponse'a ekler.
//
// Kullanici istegi (2026-10-07, 7. tur): "tarayici/sekme kapatilip tekrar
// acildiginda herkes icin yeniden kullanici adi/sifre istensin, oturum
// hafizada kalmasin" - ozellikle KASA1/2/3, CARI, MUHASEBE gibi paylasilan
// kiosk hesaplarinda bir onceki kullanicinin acik oturumunun sonraki
// kisiye miras kalmamasi icin. Eskiden burada acikca "maxAge:
// SESSION_DURATION_SECONDS" (180 dk) verilip KALICI bir cerez
// yaziliyordu - tarayici tamamen kapatilip yeniden acilsa bile (bilgisayar
// yeniden baslatilsa bile) cerez diskte kalip oturumu canlı tutuyordu.
// maxAge/expires HIC VERILMEZSE bu bir "oturum cerezi" olur - tarayici
// SADECE o an acik, kapatilinca kaybolur; ama sunucu tarafindaki jetonun
// kendi icine gomulu 180 dk idle / 24 saat mutlak sinirlama (bkz.
// createSessionValue, lib/auth.ts) DEGISMEDEN calismaya devam eder - yani
// "180 dk hareketsizlikte dus" davranisi hala gecerli, sadece artik AYRICA
// "tarayici kapaninca da dus" eklendi.
export function attachSessionCookie(response: NextResponse, userId: string, request: Request) {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: createSessionValue(String(userId)),
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(request),
    path: '/',
  })
  return response
}

// Telefon numarasini maskeler: "5xx xxx 12 34" -> "5** *** ** 34"
export function maskPhone(phone: string): string {
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 4) return '***'
  const last2 = digits.slice(-2)
  return `${digits.slice(0, 3).replace(/\d(?=\d)/g, '*')}*** ** ${last2}`
}

type OtpUser = { id: string | number; name?: string | null; username?: string | null; phone?: string | null }

// SMS dogrulamasi SADECE gercekten UZAKTAN (yerel ag disi) girislerde
// istenir - mobil olsun web olsun. Yerel agdan (10.x / 192.168.x / localhost
// veya INTERNAL_HOSTS'ta tanimli alan-agi makine adlari) yapilan girisler -
// mobil cihaz da olsa - koddan MUAFtir. (Kullanici istegi.)
// "Uzak" tespiti Host basligina bakar (bkz. lib/remoteMobileAccess.ts notu:
// kullanicilar yerel agda 10.x/192.168.x veya makine adi, disaridan WAN
// IP'sini yazar).
export function isRemoteLoginRequest(request: Request): boolean {
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host')
  return !isLanHost(host)
}

// Kullanicinin kayitli cep telefonuna 6 haneli giris kodunu SMS ile gonderir.
// (Kullanici istegi: WhatsApp yerine SMS.) Donen: { sent, phoneHint } -
// sent=false ise telefon yok / SMS firmasi tanimsiz / gonderim hatasi.
export async function sendLoginOtp(
  user: OtpUser,
  actor = 'Sistem (Uzaktan Giriş Doğrulama)',
): Promise<{ sent: boolean; phoneHint: string | null; ticket: string; reason: null | 'no-phone' | 'send-failed' }> {
  const ticket = createOtpTicket(String(user.id))
  const phone = normalizeWhatsappPhoneNumber(user.phone || '')
  if (!phone) return { sent: false, phoneHint: null, ticket, reason: 'no-phone' }

  const code = createLoginOtp(String(user.id))
  const minutes = Math.round(LOGIN_OTP_TTL_SECONDS / 60)
  // SMS - kisa tutulur (tek SMS'e sigsin, gereksiz maliyet olmasin).
  const message = `Sosyal Yardim Yonetim Sistemi giris dogrulama kodunuz: ${code} - ${minutes} dk gecerli. Girisi siz yapmadiysaniz dikkate almayin.`

  const result = await sendSmsMessage(phone, message)

  // Loglama best-effort - gonderim sonucunu asla degistirmez.
  await prisma.sms_gonderim_log.create({
    data: {
      telefon: phone,
      adisoyadi: user.name || null,
      mesaj: message,
      durum: result.ok ? 'gönderildi' : 'hata',
      cevap: result.ok ? null : (result.error || result.raw || 'Bilinmeyen hata'),
      sms_tipi: 'otomatik',
      kanal: 'sms',
      kullanici: actor,
    },
  }).catch(() => { /* yoksay */ })

  if (!result.ok) {
    console.warn(`[uzaktan-giris-otp] Kullanici id=${user.id} icin kod SMS ile gonderilemedi: ${result.error}`)
  }

  return {
    sent: result.ok,
    phoneHint: maskPhone(phone),
    ticket,
    reason: result.ok ? null : 'send-failed',
  }
}
