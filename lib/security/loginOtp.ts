import 'server-only'
import { createHash, createHmac, randomInt, timingSafeEqual } from 'crypto'

// Uzaktan / mobil girislerde kullanicinin kayitli cep telefonuna (WhatsApp)
// gonderilen 6 haneli tek-kullanimlik giris kodu. Kod BELLEKTE tutulur
// (rateLimit.ts ile ayni yaklasim) - kisa omurlu oldugu icin (5 dk) sunucu
// yeniden baslarsa kullanici sadece kodu yeniden ister. Kod DUZ tutulmaz,
// SHA-256 ozeti saklanir.

type OtpEntry = {
  hash: Buffer
  expiresAt: number
  attemptsLeft: number
}

const OTP_TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_ENTRIES = 5_000

const entries = new Map<string, OtpEntry>()

function hashCode(code: string): Buffer {
  return createHash('sha256').update(code).digest()
}

function pruneIfNeeded(now: number) {
  if (entries.size < MAX_ENTRIES) return
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key)
  }
  if (entries.size >= MAX_ENTRIES) {
    const firstKey = entries.keys().next().value
    if (firstKey !== undefined) entries.delete(firstKey)
  }
}

// Yeni bir giris kodu uretir, ozetini saklar ve DUZ kodu (SMS/WhatsApp ile
// gonderilmek uzere) dondurur.
export function createLoginOtp(userId: string): string {
  const now = Date.now()
  pruneIfNeeded(now)
  const code = Array.from({ length: 6 }, () => randomInt(0, 10)).join('')
  entries.set(userId, {
    hash: hashCode(code),
    expiresAt: now + OTP_TTL_MS,
    attemptsLeft: MAX_ATTEMPTS,
  })
  return code
}

type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'expired' | 'locked' | 'mismatch' }

export function verifyLoginOtp(userId: string, code: string): VerifyResult {
  const now = Date.now()
  const entry = entries.get(userId)

  if (!entry) return { ok: false, reason: 'missing' }
  if (entry.expiresAt <= now) {
    entries.delete(userId)
    return { ok: false, reason: 'expired' }
  }
  if (entry.attemptsLeft <= 0) {
    entries.delete(userId)
    return { ok: false, reason: 'locked' }
  }

  const provided = hashCode(String(code || ''))
  const matches = provided.length === entry.hash.length && timingSafeEqual(provided, entry.hash)

  if (!matches) {
    entry.attemptsLeft -= 1
    if (entry.attemptsLeft <= 0) {
      entries.delete(userId)
      return { ok: false, reason: 'locked' }
    }
    return { ok: false, reason: 'mismatch' }
  }

  // Tek kullanimlik - basarili dogrulamadan sonra kod gecersiz kilinir.
  entries.delete(userId)
  return { ok: true }
}

export function clearLoginOtp(userId: string) {
  entries.delete(userId)
}

export const LOGIN_OTP_TTL_SECONDS = OTP_TTL_MS / 1000

// --- OTP "bileti" (ticket) ---------------------------------------------------
// verify-otp uc noktasi oturumsuzdur ve userId ardisik/tahmin edilebilir bir
// sayidir. Bilet olmadan bir saldirgan userId'leri deneyerek keyfi
// kullanicilara SMS spam'i (maliyet + rahatsizlik) veya bekleyen bir kodu
// brute-force edebilirdi. Bilet, SIFRE dogrulamasi basarili oldugunda
// (login / change-password) uretilen, AUTH_SECRET ile imzali, kisa omurlu bir
// jetondur; verify-otp hem kod dogrulama hem "tekrar gonder" icin bunu ister.

const TICKET_TTL_MS = 15 * 60 * 1000

function ticketSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET tanımlanmalıdır.')
  return secret
}

export function createOtpTicket(userId: string): string {
  const expiresAt = Date.now() + TICKET_TTL_MS
  const payload = `${userId}.${expiresAt}`
  const sig = createHmac('sha256', ticketSecret()).update(`otp.${payload}`).digest('hex')
  return `${payload}.${sig}`
}

export function verifyOtpTicket(ticket: string, userId: string): boolean {
  if (typeof ticket !== 'string' || !ticket) return false
  const [tUserId, tExpiresAt, sig, ...rest] = ticket.split('.')
  if (!tUserId || !tExpiresAt || !sig || rest.length > 0) return false
  if (tUserId !== String(userId)) return false

  const expiresAt = Number(tExpiresAt)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false

  const expected = createHmac('sha256', ticketSecret()).update(`otp.${tUserId}.${tExpiresAt}`).digest('hex')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
