import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'

const TOKEN_TTL_SECONDS = 90
const usedTokens = new Map<string, number>()

function secret() {
  const value = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET tanımlanmalıdır.')
  return value
}

function signature(payload: string) {
  return createHmac('sha256', secret()).update(`destructive:${payload}`).digest('base64url')
}

export function createDestructiveAuthorization(userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  const nonce = randomBytes(18).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt, nonce })).toString('base64url')
  return `${payload}.${signature(payload)}`
}

function consumeToken(token: string, expectedUserId: string) {
  const [payload, receivedSignature, ...rest] = token.split('.')
  if (!payload || !receivedSignature || rest.length > 0) return false

  const expectedSignature = signature(payload)
  const received = Buffer.from(receivedSignature)
  const expected = Buffer.from(expectedSignature)
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false

  let data: { userId?: string; expiresAt?: number; nonce?: string }
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return false
  }

  const now = Math.floor(Date.now() / 1000)
  for (const [usedNonce, expiry] of usedTokens) {
    if (expiry <= now) usedTokens.delete(usedNonce)
  }

  if (data.userId !== expectedUserId || !data.nonce || !data.expiresAt || data.expiresAt <= now) return false
  if (usedTokens.has(data.nonce)) return false
  usedTokens.set(data.nonce, data.expiresAt)
  return true
}

export async function requireDestructiveAuthorization(request: Request) {
  const cookieStore = await cookies()
  const userId = parseSessionValue(readSessionCookie(cookieStore))
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const token = request.headers.get('x-destructive-authorization') || ''
  if (!consumeToken(token, userId)) {
    return NextResponse.json(
      { success: false, error: 'Silme işlemi için kullanıcı şifrenizi yeniden doğrulamanız gerekiyor.' },
      { status: 428 },
    )
  }

  return null
}
