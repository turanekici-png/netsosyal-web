import { createHmac, timingSafeEqual } from 'crypto'

export const AUTH_COOKIE_NAME = 'netsosyal_session'
// Eski cerez adi - yeniden adlandirma (nextsosyal -> netsosyal) sirasinda
// mevcut oturumlarin DUSMEMESI icin okuma yaparken bu isim de denenir.
// Yeni cerezler her zaman AUTH_COOKIE_NAME ile yazilir; eski cerez suresi
// dolunca kendiliginden kaybolur.
export const LEGACY_AUTH_COOKIE_NAMES = ['nextsosyal_session'] as const

// Hareketsizlik (idle) zaman asimi: oturumda 180 dakika (3 saat) boyunca
// HICBIR istek yapilmazsa oturum duser. Her istekte cerez yeniden imzalanip
// bu sure ileri atilir (sliding), ancak asagidaki MUTLAK ust sinir asilamaz.
// (Kullanici istegi Eylul 2026: 30 dk -> 180 dk. Bu sure ICINDE yeniden
// giris yapan uzaktaki kullaniciya SMS kodu GONDERILMEZ - bkz.
// app/api/auth/login/route.ts; sure dolunca oturum duser ve kod istenir.)
export const SESSION_IDLE_SECONDS = 60 * 180
// Mutlak ust sinir: ilk giristen bu kadar sonra, kullanici aktif olsa bile
// oturum kesin duser (sliding sonsuza uzamasin). 180 dk idle ile uyumlu
// olmasi icin 12 saatten 24 saate cikarildi (bir is gunu boyunca aktif
// kullanici gun ortasinda dusmesin).
export const SESSION_ABSOLUTE_SECONDS = 60 * 60 * 24
// Cerezin tarayici tarafindaki maxAge'i = idle suresi.
export const SESSION_DURATION_SECONDS = SESSION_IDLE_SECONDS

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET tanımlanmalıdır.')
  return secret
}

function signPayload(payload: string) {
  return createHmac('sha256', getAuthSecret()).update(payload).digest('hex')
}

// Yeni jeton bicimi: `userId.issuedAt.expiresAt.signature`
//  - issuedAt  : ilk giris ani (mutlak ust sinir bundan hesaplanir)
//  - expiresAt : hareketsizlik son tarihi (her istekte ileri atilir)
export function createSessionValue(userId: string, issuedAtSeconds?: number) {
  const now = Math.floor(Date.now() / 1000)
  const issuedAt = issuedAtSeconds && Number.isSafeInteger(issuedAtSeconds) ? issuedAtSeconds : now
  const idleDeadline = now + SESSION_IDLE_SECONDS
  const absoluteDeadline = issuedAt + SESSION_ABSOLUTE_SECONDS
  const expiresAt = Math.min(idleDeadline, absoluteDeadline)
  const payload = `${userId}.${issuedAt}.${expiresAt}`
  return `${payload}.${signPayload(payload)}`
}

// Cerez deposundan (Next cookies() / NextRequest.cookies) oturum jetonunu
// okur - once yeni ad, sonra eski (legacy) adlar denenir. Boylece
// nextsosyal -> netsosyal yeniden adlandirmasi mevcut oturumlari dusurmez.
type CookieReader = { get: (name: string) => { value?: string } | undefined }
export function readSessionCookie(store: CookieReader): string | undefined {
  const current = store.get(AUTH_COOKIE_NAME)?.value
  if (current) return current
  for (const legacy of LEGACY_AUTH_COOKIE_NAMES) {
    const v = store.get(legacy)?.value
    if (v) return v
  }
  return undefined
}

function safeEqualHex(signature: string, expected: string) {
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (signatureBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(signatureBuffer, expectedBuffer)
}

export type SessionDetails = {
  userId: string
  // Yeni bicimde ilk giris ani; eski (legacy) jetonlarda bilinmedigi icin null.
  issuedAt: number | null
  expiresAt: number
}

// Jetonu dogrular ve icerigini dondurur. Hem yeni 4 parcali bicimi hem de
// eski 3 parcali (`userId.expiresAt.signature`) bicimi kabul edilir - boylece
// bu guncelleme canliya alindiginda mevcut oturumlar bir kez daha yenilenerek
// yeni bicime tasinir, kimse aninda dusmez.
export function parseSessionDetails(value?: string | null): SessionDetails | null {
  if (!value) return null

  const parts = value.split('.')
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (parts.length === 4) {
    const [userId, issuedAtValue, expiresAtValue, signature] = parts
    if (!userId || !/^\d+$/.test(userId) || !/^\d+$/.test(issuedAtValue) || !/^\d+$/.test(expiresAtValue) || !signature) {
      return null
    }
    const issuedAt = Number(issuedAtValue)
    const expiresAt = Number(expiresAtValue)
    if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return null
    if (expiresAt <= nowSeconds) return null
    // Mutlak ust sinir asilmis mi?
    if (issuedAt + SESSION_ABSOLUTE_SECONDS <= nowSeconds) return null
    if (!safeEqualHex(signature, signPayload(`${userId}.${issuedAt}.${expiresAt}`))) return null
    return { userId, issuedAt, expiresAt }
  }

  if (parts.length === 3) {
    const [userId, expiresAtValue, signature] = parts
    if (!userId || !/^\d+$/.test(userId) || !/^\d+$/.test(expiresAtValue) || !signature) return null
    const expiresAt = Number(expiresAtValue)
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) return null
    if (!safeEqualHex(signature, signPayload(`${userId}.${expiresAt}`))) return null
    return { userId, issuedAt: null, expiresAt }
  }

  return null
}

export function parseSessionValue(value?: string | null): string | null {
  return parseSessionDetails(value)?.userId ?? null
}

// Mevcut oturumun idle son tarihini "simdi + 180 dk" olarak ileri atar
// (sliding). Mutlak ust sinir (ilk giristen 24 saat) korunur. /api/auth/heartbeat
// tarafindan, kullanici gercekten bir islem yaptikca cagrilir. Oturum artik
// gecerli degilse null doner.
export function refreshSessionValue(currentValue?: string | null): string | null {
  const details = parseSessionDetails(currentValue)
  if (!details) return null
  return createSessionValue(details.userId, details.issuedAt ?? undefined)
}
