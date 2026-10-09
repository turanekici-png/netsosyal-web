'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_PREDEFINED_VALUES,
  DEFAULT_PREDEFINED_VALUE_TITLES,
  findPredefinedCategoryByCandidates,
  type PredefinedValue,
  type PredefinedValuesMap,
  type PredefinedValueTitlesMap,
} from '@/lib/constants/predefinedValues'

function options(values: PredefinedValuesMap, titles: PredefinedValueTitlesMap, candidates: string[], fallback: PredefinedValue[]) {
  const category = findPredefinedCategoryByCandidates(values, titles, candidates)
  return category && values[category]?.length ? values[category] : fallback
}

export function usePersonPredefinedOptions() {
  const [values, setValues] = useState<PredefinedValuesMap>(DEFAULT_PREDEFINED_VALUES)
  const [titles, setTitles] = useState<PredefinedValueTitlesMap>(DEFAULT_PREDEFINED_VALUE_TITLES)

  useEffect(() => {
    fetch('/api/predefined-values', { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (response.ok && payload.success && payload.data) {
          setValues({ ...DEFAULT_PREDEFINED_VALUES, ...payload.data.values })
          setTitles({ ...DEFAULT_PREDEFINED_VALUE_TITLES, ...payload.data.titles })
        }
      })
      .catch(() => undefined)
  }, [])

  return {
    maritalStatusOptions: options(values, titles, ['medeni hal', 'medeni durum', 'marital status'], DEFAULT_PREDEFINED_VALUES.maritalStatus),
    genderOptions: options(values, titles, ['cinsiyet', 'cinsiyeti', 'gender'], DEFAULT_PREDEFINED_VALUES.gender),
  }
}
