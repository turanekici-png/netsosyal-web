import 'server-only'

type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitOptions = {
  limit: number
  windowMs: number
}

const entries = new Map<string, RateLimitEntry>()
const MAX_ENTRIES = 10_000
let lastCleanupAt = 0

function cleanupExpiredEntries(now: number) {
  if (entries.size < MAX_ENTRIES && now - lastCleanupAt < 60_000) return

  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) entries.delete(key)
  }

  if (entries.size >= MAX_ENTRIES) {
    const overflow = entries.size - MAX_ENTRIES + 1
    let removed = 0
    for (const key of entries.keys()) {
      entries.delete(key)
      removed += 1
      if (removed >= overflow) break
    }
  }

  lastCleanupAt = now
}

export function checkRateLimit(key: string, options: RateLimitOptions) {
  const now = Date.now()
  cleanupExpiredEntries(now)
  const existing = entries.get(key)

  if (!existing || existing.resetAt <= now) {
    entries.set(key, { count: 1, resetAt: now + options.windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  existing.count += 1
  if (existing.count <= options.limit) {
    return { allowed: true, retryAfterSeconds: 0 }
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  }
}

export function clearRateLimit(key: string) {
  entries.delete(key)
}

// GUVENLIK: Uygulama SU AN ters proxy ARKASINDA DEGIL - dogrudan
// "next start" ile internete aciliyor. Bu durumda "X-Forwarded-For" /
// "X-Real-IP" basliklarini TAMAMEN istemci belirler (sahtelenebilir), bu
// yuzden onlara GUVENILMEZ; her istekte rastgele bir IP yazilarak IP bazli
// hiz sinirlari atlatilabilirdi. Bu yuzden guvenilir bir proxy acikca
// tanimlanmadikca (TRUST_PROXY_HEADERS=true) bu basliklar YOK SAYILIR ve
// sabit bir anahtar dondurulur - IP katmani "global" bir tavan gibi calisir,
// asil koruma ise her uc noktada AYRICA bulunan hesap/TC bazli sinirdir
// (bkz. login-account:, nvi-tc:, online-application-submit-tc: ...).
// Ileride onune Caddy/nginx/Cloudflare konursa TRUST_PROXY_HEADERS=true
// yapilarak gercek istemci IP'si tekrar devreye alinir.
export function getRequestClientKey(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const realIp = request.headers.get('x-real-ip')?.trim()
    return forwardedFor || realIp || 'local-network'
  }
  return 'no-proxy'
}
