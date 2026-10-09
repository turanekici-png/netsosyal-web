import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ONLINE_APPLICATION_CRITERIA,
  normalizeOnlineApplicationAutoCriteria,
  normalizeOnlineApplicationCriteria,
} from '@/lib/constants/onlineApplicationForms'

describe('normalizeOnlineApplicationCriteria', () => {
  it('eksik alanlari varsayilanlarla doldurur', () => {
    const result = normalizeOnlineApplicationCriteria({ maxAgeEnabled: true, maxAge: 70 })
    expect(result.maxAgeEnabled).toBe(true)
    expect(result.maxAge).toBe(70)
    expect(result.minAge).toBe(DEFAULT_ONLINE_APPLICATION_CRITERIA.minAge)
    expect(result.manualInfoCriteria).toEqual([])
  })

  it('0 veya negatif sayisal degerleri varsayilana geri ceker', () => {
    const result = normalizeOnlineApplicationCriteria({ maxAge: 0, minAge: -5, maxIncome: 0 })
    expect(result.maxAge).toBe(DEFAULT_ONLINE_APPLICATION_CRITERIA.maxAge)
    expect(result.minAge).toBe(DEFAULT_ONLINE_APPLICATION_CRITERIA.minAge)
    expect(result.maxIncome).toBe(DEFAULT_ONLINE_APPLICATION_CRITERIA.maxIncome)
  })

  it('null / undefined icin tam varsayilan setini dondurur', () => {
    expect(normalizeOnlineApplicationCriteria(null)).toEqual(DEFAULT_ONLINE_APPLICATION_CRITERIA)
    expect(normalizeOnlineApplicationCriteria(undefined)).toEqual(DEFAULT_ONLINE_APPLICATION_CRITERIA)
  })

  it('manualInfoCriteria dizisini string dizisine cevirir', () => {
    const result = normalizeOnlineApplicationCriteria({
      manualInfoCriteria: [1, 'kira', null] as unknown as string[],
    })
    expect(result.manualInfoCriteria).toEqual(['1', 'kira', ''])
  })
})

describe('normalizeOnlineApplicationAutoCriteria', () => {
  it('gecersiz sayisal degerleri varsayilana ceker, bool alanlari korur', () => {
    const result = normalizeOnlineApplicationAutoCriteria({ maxIncomeEnabled: true, maxIncome: -1 })
    expect(result.maxIncomeEnabled).toBe(true)
    expect(result.maxIncome).toBe(10000)
  })
})
