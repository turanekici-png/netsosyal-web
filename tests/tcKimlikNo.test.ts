import { describe, expect, it } from 'vitest'
import { isValidTcKimlikNo } from '@/lib/utils/tcKimlikNo'

describe('isValidTcKimlikNo', () => {
  it('kontrol basamaklari tutan numarayi kabul eder', () => {
    // Algoritmaya gore uretilmis gecerli ornek numaralar.
    expect(isValidTcKimlikNo('10000000146')).toBe(true)
    expect(isValidTcKimlikNo('19191919190')).toBe(true)
  })

  it('11 haneli ama kontrol basamagi tutmayan numarayi reddeder', () => {
    expect(isValidTcKimlikNo('12345678901')).toBe(false)
    expect(isValidTcKimlikNo('11111111111')).toBe(false)
  })

  it('ilk hanesi 0 olani reddeder', () => {
    expect(isValidTcKimlikNo('01234567890')).toBe(false)
  })

  it('11 hane disindaki uzunluklari reddeder', () => {
    expect(isValidTcKimlikNo('1000000014')).toBe(false)
    expect(isValidTcKimlikNo('100000001466')).toBe(false)
    expect(isValidTcKimlikNo('')).toBe(false)
  })

  it('rakam disi karakter iceren girdiyi reddeder', () => {
    expect(isValidTcKimlikNo('1000000014a')).toBe(false)
    expect(isValidTcKimlikNo('10 00000146')).toBe(false)
  })
})
