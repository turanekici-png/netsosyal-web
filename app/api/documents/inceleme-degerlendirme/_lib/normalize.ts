export function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

export function normalizeBigInt(value: unknown): string | null {
  const text = normalizeText(value)
  if (text === null) return null
  return /^\d+$/.test(text) ? text : null
}

export function normalizeInteger(value: unknown): number | null {
  const text = normalizeText(value)
  if (text === null) return null
  const number = Number(text)
  return Number.isInteger(number) ? number : null
}

export function normalizeNumber(value: unknown): number | null {
  const text = normalizeText(value)
  if (text === null) return null
  const normalized = text.replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

export function normalizeDate(value: unknown): string | null {
  const text = normalizeText(value)
  if (text === null) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

export function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}
