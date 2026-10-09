import {
  DEFAULT_PREDEFINED_VALUES,
  findPredefinedCategoryByCandidates,
  normalizePredefinedText,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'

function findCategory(
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  candidates: string[],
) {
  return findPredefinedCategoryByCandidates(values, titles, candidates)
}

function resolveValueName(
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  candidates: string[],
  value: string | null,
) {
  if (!value) return null

  const category = findCategory(values, titles, candidates)
  if (!category) return value

  const normalizedValue = normalizePredefinedText(value)
  const match = values[category]?.find((option) => (
    option.id === value ||
    normalizePredefinedText(option.id) === normalizedValue ||
    normalizePredefinedText(option.name) === normalizedValue
  ))

  return match?.name ?? value
}

export async function resolveCashPredefinedLabels(
  period: string | null,
  label: string | null,
  stage: string | null = null,
) {
  const { values, titles } = await predefinedValuesService.getAll()

  return {
    period: resolveValueName(values, titles, ['donem bilgisi', 'donem'], period),
    label: resolveValueName(values, titles, ['etiket bilgisi', 'etiket'], label),
    stage: resolveValueName(values, titles, ['nakit asama', 'nakit asamasi', 'nakit durumu'], stage),
  }
}

export async function createCashPredefinedLabelResolver() {
  const { values, titles } = await predefinedValuesService.getAll()

  return (period: string | null, label: string | null) => ({
    period: resolveValueName(values, titles, ['donem bilgisi', 'donem'], period),
    label: resolveValueName(values, titles, ['etiket bilgisi', 'etiket'], label),
  })
}

export async function getCashLabelFilterOptions() {
  const { values, titles } = await predefinedValuesService.getAll()
  const labelCategory = findCategory(values, titles, ['etiket bilgisi', 'etiket'])
  const options = labelCategory ? values[labelCategory] ?? [] : []

  return options.map((option) => ({
    value: option.name,
    label: option.name,
    count: 0,
  }))
}

export async function getCashStatusMap() {
  const { values, titles } = await predefinedValuesService.getAll()
  const cashStatusCategory = findCategory(values, titles, ['nakit durumu'])
  const options = cashStatusCategory ? values[cashStatusCategory] ?? [] : []
  const sourceOptions = options.length > 0 ? options : DEFAULT_PREDEFINED_VALUES.assistanceStatus

  return sourceOptions.reduce((acc, option) => {
    acc[option.id] = option.name
    return acc
  }, {} as Record<string, string>)
}
