import { afterEach, describe, expect, it } from 'vitest'
import { isLanHost, isRestrictedAccessContext } from '@/lib/remoteMobileAccess'

const ORIGINAL_INTERNAL_HOSTS = process.env.INTERNAL_HOSTS

afterEach(() => {
  if (ORIGINAL_INTERNAL_HOSTS === undefined) {
    delete process.env.INTERNAL_HOSTS
  } else {
    process.env.INTERNAL_HOSTS = ORIGINAL_INTERNAL_HOSTS
  }
})

describe('isLanHost', () => {
  it('otomatik yerel araliklari (IP / localhost / *.local) yerel sayar', () => {
    delete process.env.INTERNAL_HOSTS
    expect(isLanHost('10.0.0.183:3000')).toBe(true)
    expect(isLanHost('192.168.1.5')).toBe(true)
    expect(isLanHost('172.16.4.9:3000')).toBe(true)
    expect(isLanHost('localhost:3000')).toBe(true)
    expect(isLanHost('sunucu.local')).toBe(true)
  })

  it('bos host belirsizse yerel sayar (acik-fail)', () => {
    delete process.env.INTERNAL_HOSTS
    expect(isLanHost('')).toBe(true)
    expect(isLanHost(null)).toBe(true)
  })

  it('yapilandirilmamisken alan-agi makine adini UZAK sayar', () => {
    delete process.env.INTERNAL_HOSTS
    expect(isLanHost('sunucu:3000')).toBe(false)
    expect(isLanHost('netsosyal.kurum.local')).toBe(false)
    expect(isLanHost('88.123.45.67')).toBe(false)
  })

  it('INTERNAL_HOSTS ile tanimli makine adlarini (port farketmez) yerel sayar', () => {
    process.env.INTERNAL_HOSTS = 'sunucu, netsosyal.kurum.local , 10.9.9.9'
    expect(isLanHost('sunucu:3000')).toBe(true)
    expect(isLanHost('SUNUCU')).toBe(true)
    expect(isLanHost('netsosyal.kurum.local:3000')).toBe(true)
    expect(isLanHost('10.9.9.9')).toBe(true)
    // Listede olmayan dis adres hala uzak
    expect(isLanHost('88.123.45.67')).toBe(false)
  })

  it('*.suffix jokeri alt alan adlarini yerel sayar ama ciplak suffix eslesmez', () => {
    // Not: "*.local" zaten LAN_HOST_PATTERN kapsaminda - jokeri baska bir
    // kurumsal son ekle sinayalim.
    process.env.INTERNAL_HOSTS = '*.kurum.internal'
    expect(isLanHost('netsosyal.kurum.internal')).toBe(true)
    expect(isLanHost('a.b.kurum.internal:3000')).toBe(true)
    expect(isLanHost('kurum.internal')).toBe(false)
    expect(isLanHost('baskakurum.internal')).toBe(false)
  })

  it('dis IP + masaustu = kisitli baglam olmaya devam eder', () => {
    process.env.INTERNAL_HOSTS = 'sunucu'
    expect(isRestrictedAccessContext('88.123.45.67', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(true)
    expect(isRestrictedAccessContext('sunucu:3000', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false)
  })
})
