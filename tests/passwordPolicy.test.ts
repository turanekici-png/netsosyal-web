import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, isValidNewPassword } from '@/lib/security/passwordPolicy'

describe('isValidNewPassword', () => {
  it('kurala uyan parolalari kabul eder', () => {
    expect(isValidNewPassword('Sivas2026')).toBe(true)
    expect(isValidNewPassword('aB3xxxxx')).toBe(true)
    expect(isValidNewPassword('Yardim-01')).toBe(true)
  })

  it('8 karakterden kisa olani reddeder', () => {
    expect(isValidNewPassword('Ab3xxxx')).toBe(false)
    expect(MIN_PASSWORD_LENGTH).toBe(8)
  })

  it('buyuk harf yoksa reddeder', () => {
    expect(isValidNewPassword('sivas2026')).toBe(false)
  })

  it('rakam yoksa reddeder', () => {
    expect(isValidNewPassword('SivasKentt')).toBe(false)
  })

  it('string olmayan girdileri reddeder', () => {
    expect(isValidNewPassword(undefined as unknown as string)).toBe(false)
    expect(isValidNewPassword(12345678 as unknown as string)).toBe(false)
  })
})
