import {
  DEFAULT_PREDEFINED_VALUES,
  normalizePredefinedText,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'

const numericTextPattern = /^-?\d+$/

export const getAssistanceStatusLabel = (
  values: PredefinedValuesMap,
  value: bigint | number | string | null | undefined,
  emptyLabel = '-',
) => {
  if (value === null || value === undefined) return emptyLabel
  const rawValue = String(value).trim()
  if (!rawValue) return emptyLabel
  if (!numericTextPattern.test(rawValue)) return rawValue
  return values.assistanceStatus?.find((item) => item.id === rawValue)?.name ?? rawValue
}

function findPredefinedCategory(
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  candidates: string[],
) {
  const normalizedCandidates = candidates.map(normalizePredefinedText)

  return Object.keys(values).find((key) => {
    const normalizedKey = normalizePredefinedText(key)
    const normalizedTitle = normalizePredefinedText(titles[key] ?? key)

    return normalizedCandidates.some((candidate) => (
      normalizedKey === candidate ||
      normalizedTitle === candidate ||
      normalizedKey.includes(candidate) ||
      normalizedTitle.includes(candidate)
    ))
  }) ?? null
}

export const getDgnAssistanceStatusLabel = (
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  value: bigint | number | string | null | undefined,
  emptyLabel = '-',
) => {
  if (value === null || value === undefined) return emptyLabel
  const rawValue = String(value).trim()
  if (!rawValue) return emptyLabel
  if (!numericTextPattern.test(rawValue)) return rawValue

  const category = findPredefinedCategory(values, titles, [
    'd-g-n yardim durumu',
    'dgn yardim durumu',
    'd g n yardim durumu',
  ])

  return (category ? values[category]?.find((item) => item.id === rawValue)?.name : null)
    ?? values.assistanceStatus?.find((item) => item.id === rawValue)?.name
    ?? rawValue
}

export const toAssistanceStatusMap = (values: PredefinedValuesMap) =>
  (values.assistanceStatus?.length ? values.assistanceStatus : DEFAULT_PREDEFINED_VALUES.assistanceStatus)
    .reduce((acc, item) => {
      acc[item.id] = item.name
      return acc
    }, {} as Record<string, string>)

export const getAssistanceStatusMap = async () => {
  const { values } = await predefinedValuesService.getAll()
  return toAssistanceStatusMap(values)
}

export const getDgnAssistanceStatusMap = async () => {
  const { values, titles } = await predefinedValuesService.getAll()
  const category = findPredefinedCategory(values, titles, [
    'd-g-n yardim durumu',
    'dgn yardim durumu',
    'd g n yardim durumu',
  ])
  const options = category ? values[category] ?? [] : []

  return (options.length ? options : values.assistanceStatus ?? DEFAULT_PREDEFINED_VALUES.assistanceStatus)
    .reduce((acc, item) => {
      acc[item.id] = item.name
      return acc
    }, {} as Record<string, string>)
}
