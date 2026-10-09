import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  createSessionValue,
  parseSessionDetails,
  parseSessionValue,
  refreshSessionValue,
} from '@/lib/auth'

const NOW = 1_800_000_000_000 // sabit referans (ms)

afterEach(() => {
  vi.useRealTimers()
})

function freezeAt(ms: number) {
  vi.useFakeTimers()
  vi.setSystemTime(ms)
}

describe('createSessionValue / parseSessionDetails', () => {
  it('taze bir oturumu kabul eder ve userId dondurur', () => {
    freezeAt(NOW)
    const token = createSessionValue('42')
    expect(parseSessionValue(token)).toBe('42')
    const details = parseSessionDetails(token)
    expect(details?.userId).toBe('42')
    expect(details?.issuedAt).toBe(Math.floor(NOW / 1000))
    expect(details?.expiresAt).toBe(Math.floor(NOW / 1000) + SESSION_IDLE_SECONDS)
  })

  it('30 dk hareketsizlikten sonra oturum duser', () => {
    freezeAt(NOW)
    const token = createSessionValue('42')
    vi.setSystemTime(NOW + (SESSION_IDLE_SECONDS + 1) * 1000)
    expect(parseSessionValue(token)).toBeNull()
  })

  it('idle limiti dolmadan hemen once hala gecerli', () => {
    freezeAt(NOW)
    const token = createSessionValue('42')
    vi.setSystemTime(NOW + (SESSION_IDLE_SECONDS - 5) * 1000)
    expect(parseSessionValue(token)).toBe('42')
  })

  it('imzasi kurcalanmis jetonu reddeder', () => {
    freezeAt(NOW)
    const token = createSessionValue('42')
    const tampered = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a')
    expect(parseSessionValue(tampered)).toBeNull()
  })

  it('userId degistirilmis jetonu reddeder (imza tutmaz)', () => {
    freezeAt(NOW)
    const token = createSessionValue('42')
    const parts = token.split('.')
    parts[0] = '99'
    expect(parseSessionValue(parts.join('.'))).toBeNull()
  })

  it('bicimsiz / bos degerleri reddeder', () => {
    expect(parseSessionValue('')).toBeNull()
    expect(parseSessionValue(null)).toBeNull()
    expect(parseSessionValue('a.b')).toBeNull()
    expect(parseSessionValue('42.abc.def.ghi')).toBeNull()
  })
})

describe('mutlak ust sinir (12 saat)', () => {
  it('ilk giristen 12 saat sonra, aktif olsa bile oturum dusmeli', () => {
    freezeAt(NOW)
    let token = createSessionValue('7')
    // Kullanici surekli aktif: her 20 dk'da bir yenile.
    for (let elapsed = 20 * 60; elapsed < SESSION_ABSOLUTE_SECONDS; elapsed += 20 * 60) {
      vi.setSystemTime(NOW + elapsed * 1000)
      const next = refreshSessionValue(token)
      expect(next).not.toBeNull()
      token = next as string
    }
    // 12 saati gecince yenileme de artik gecerli oturum uretemez.
    vi.setSystemTime(NOW + (SESSION_ABSOLUTE_SECONDS + 60) * 1000)
    expect(parseSessionValue(token)).toBeNull()
    expect(refreshSessionValue(token)).toBeNull()
  })

  it('yenilenen jetonun son tarihi mutlak siniri asmaz', () => {
    freezeAt(NOW)
    let token = createSessionValue('7')
    const issuedAt = Math.floor(NOW / 1000)
    // Kullanici aktif: 20 dk'da bir yenile ki idle limitine takilmasin.
    for (let elapsed = 20 * 60; elapsed <= SESSION_ABSOLUTE_SECONDS - 600; elapsed += 20 * 60) {
      vi.setSystemTime(NOW + elapsed * 1000)
      token = refreshSessionValue(token) as string
      expect(token).not.toBeNull()
    }
    // Mutlak sinira ~10 dk kala: idle 30 dk isteyecek ama sinir kesmeli.
    const details = parseSessionDetails(token)
    expect(details?.expiresAt).toBe(issuedAt + SESSION_ABSOLUTE_SECONDS)
  })
})

describe('geriye uyumluluk (eski 3 parcali jeton)', () => {
  // Eski bicim: `userId.expiresAt.hmac(userId.expiresAt)` - createSessionValue
  // artik yeni bicim urettigi icin eskiyi elle kuruyoruz.
  it('eski bicimli gecerli jeton kabul edilir ve issuedAt null olur', async () => {
    const { createHmac } = await import('node:crypto')
    freezeAt(NOW)
    const exp = Math.floor(NOW / 1000) + 3600
    const payload = `5.${exp}`
    const sig = createHmac('sha256', process.env.AUTH_SECRET as string).update(payload).digest('hex')
    const legacy = `${payload}.${sig}`
    const details = parseSessionDetails(legacy)
    expect(details?.userId).toBe('5')
    expect(details?.issuedAt).toBeNull()
  })

  it('eski bicimli jeton yenilenince yeni 4 parcali bicime yukselir', async () => {
    const { createHmac } = await import('node:crypto')
    freezeAt(NOW)
    const exp = Math.floor(NOW / 1000) + 3600
    const payload = `5.${exp}`
    const sig = createHmac('sha256', process.env.AUTH_SECRET as string).update(payload).digest('hex')
    const upgraded = refreshSessionValue(`${payload}.${sig}`) as string
    expect(upgraded.split('.')).toHaveLength(4)
    expect(parseSessionDetails(upgraded)?.userId).toBe('5')
  })
})
