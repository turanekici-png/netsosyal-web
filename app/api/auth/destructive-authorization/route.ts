import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { userService } from '@/lib/services'
import { checkRateLimit, clearRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'
import { createDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const userId = parseSessionValue(readSessionCookie(cookieStore))
  if (!userId) return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { password?: string }
  const password = String(body.password || '')
  if (!password) return NextResponse.json({ success: false, error: 'Şifrenizi girmeniz gerekiyor.' }, { status: 400 })

  const rateLimitKey = `destructive:${getRequestClientKey(request)}:${userId}`
  const limit = checkRateLimit(rateLimitKey, { limit: 8, windowMs: 15 * 60 * 1000 })
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Çok fazla hatalı şifre denemesi yapıldı. Lütfen daha sonra tekrar deneyin.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const user = await userService.getById(userId)
  if (!user?.username || !(await userService.authenticate(user.username, password))) {
    return NextResponse.json({ success: false, error: 'Kullanıcı şifreniz hatalı.' }, { status: 401 })
  }

  clearRateLimit(rateLimitKey)
  return NextResponse.json({ success: true, token: createDestructiveAuthorization(userId) })
}
