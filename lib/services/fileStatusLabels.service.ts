import type { PredefinedValuesMap } from '@/lib/constants/predefinedValues'

const numericTextPattern = /^-?\d+$/

export const getFileStatusLabel = (
  values: PredefinedValuesMap,
  value: bigint | number | string | null | undefined,
  emptyLabel = '-',
) => {
  if (value === null || value === undefined) return emptyLabel

  const rawValue = String(value).trim()
  if (!rawValue) return emptyLabel
  if (!numericTextPattern.test(rawValue)) return rawValue

  return values.fileStatus?.find((item) => item.id === rawValue)?.name ?? rawValue
}
