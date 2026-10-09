import { NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, LEGACY_AUTH_COOKIE_NAMES } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function clearSessionCookies(response: NextResponse, request: Request) {
  const requestProtocol = new URL(request.url).protocol
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const isHttpsRequest = forwardedProtocol ? forwardedProtocol === 'https' : requestProtocol === 'https:'
  // Hem yeni hem eski (legacy) cerez adlarini temizle - yeniden adlandirma
  // sonrasi tarayicida iki cerez birden kalabilir.
  for (const cookieName of [AUTH_COOKIE_NAME, ...LEGACY_AUTH_COOKIE_NAMES]) {
    response.cookies.set({
      name: cookieName,
      value: '',
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttpsRequest,
      path: '/',
      maxAge: 0,
      expires: new Date(0),
    })
  }
  return response
}

export async function POST(request: Request) {
  return clearSessionCookies(
    NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } }),
    request,
  )
}

// Kullanici istegi (2026-10-07, 8. tur): Hizli Satis (SSO) icindeki
// "Çıkış yap" butonu eskiden SADECE Flask'in kendi oturumunu temizleyip
// tekrar kasa-girisi ekranina donuyordu - ama NetSosyal oturumu HALA
// ACIK oldugu icin, kullanici kok adrese ("/") her gittiginde proxy.ts
// onu TEKRAR otomatik olarak Hizli Satis'a yonlendiriyordu ("cikis
// yapamiyorum" sikayeti). Flask basit bir GET yonlendirmesiyle BURAYA
// (bkz. app.py - _cikis_hedefi) gelir; bu da NetSosyal oturumunu da
// temizleyip gercek giris ekranina dondurur.
export async function GET(request: Request) {
  // request.url'in host kismina GUVENILMEZ - bu sunucu 0.0.0.0'da
  // dinledigi icin (IIS ARR arkasinda calisirken) request.url burada hep
  // "http://0.0.0.0:3000/..." olarak geliyor; x-forwarded-* basliklarindan
  // gercek (tarayicinin gordugu) adres kurulur (proxy.ts'teki
  // isSameOriginBrowserRequest ile AYNI desen).
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host') || new URL(request.url).host
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProtocol || new URL(request.url).protocol.replace(':', '')
  const loginUrl = new URL('/login', `${protocol}://${host}`)

  const response = clearSessionCookies(NextResponse.redirect(loginUrl), request)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
