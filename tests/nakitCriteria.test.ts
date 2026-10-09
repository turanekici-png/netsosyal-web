import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateAge, parseHouseholdSize } from '@/lib/nakitCriteria'

afterEach(() => vi.useRealTimers())

describe('calculateAge', () => {
  it('dogum gunu gectiyse tam yasi verir', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00'))
    expect(calculateAge('1990-01-15')).toBe(36)
  })

  it('dogum gunu bu yil daha gelmediyse bir eksigini verir', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00'))
    expect(calculateAge('1990-12-25')).toBe(35)
  })

  it('dogum gunu bugunse yas artar', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00'))
    expect(calculateAge('2000-08-30')).toBe(26)
  })

  it('gecersiz / bos girdi icin null', () => {
    expect(calculateAge(null)).toBeNull()
    expect(calculateAge('sacma')).toBeNull()
  })
})

describe('parseHouseholdSize', () => {
  it('sade rakam metnini sayiya cevirir', () => {
    expect(parseHouseholdSize('4')).toBe(4)
  })
  it('bosluk/harf iceren varyasyonlardan ilk sayiyi ayiklar', () => {
    expect(parseHouseholdSize(' 6 kisi')).toBe(6)
  })
  it('bos / sayisiz girdi icin null', () => {
    expect(parseHouseholdSize(null)).toBeNull()
    expect(parseHouseholdSize('yok')).toBeNull()
  })
})
