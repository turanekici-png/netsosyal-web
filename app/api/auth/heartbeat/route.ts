import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  AUTH_COOKIE_NAME,
  readSessionCookie,
  refreshSessionValue,
} from '@/lib/auth'
import { isHttpsRequest } from '@/lib/auth/remoteLoginOtp'

export const dynamic = 'force-dynamic'

// Hareketsizlik (idle) zaman asimi icin "sliding" oturum yenileme ucu.
// Istemci (components/layout/IdleLogout.tsx) kullanici GERCEKTEN bir islem
// yaptikca (fare/klavye/dokunma/tiklama) periyodik olarak bunu cagirir ve
// oturum son tarihini "simdi + 180 dk" ileri attirir. Arka plan yoklamalari
// (bildirim sayaci vb.) bu ucu CAGIRMAZ - dolayisiyla ekran basinda kimse
// yoksa oturum 180 dk (3 saat) sonra kendiliginden duser.
export async function POST(request: Request) {
  const cookieStore = await cookies()
  const nextValue = refreshSessionValue(readSessionCookie(cookieStore))

  if (!nextValue) {
    return NextResponse.json(
      { success: false, error: 'Oturum bulunamadi.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const response = NextResponse.json(
    { success: true },
    { headers: { 'Cache-Control': 'no-store' } },
  )
  // Kullanici istegi (2026-10-07, 7. tur): attachSessionCookie ile AYNI
  // sebep - maxAge VERILMEZ, oturum cerezi tarayici kapaninca kaybolsun.
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: nextValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(request),
    path: '/',
  })
  return response
}
