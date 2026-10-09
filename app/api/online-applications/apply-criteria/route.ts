import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import {
  DEFAULT_ONLINE_APPLICATION_FORMS,
  ONLINE_APPLICATION_AUTO_CRITERIA_SETTING_KEY,
  ONLINE_APPLICATION_FORMS_SETTING_KEY,
  normalizeOnlineApplicationAutoCriteria,
  type OnlineApplication,
  type OnlineApplicationAutoCriteria,
} from '@/lib/constants/onlineApplicationForms'
import { settingService } from '@/lib/services'

export const dynamic = 'force-dynamic'

const REJECTED_STAGE = 'UYGUN DEĞİL'
const REJECTED_NOTE = 'BAŞVURU KRİTERLERE UYMADIĞI İÇİN UYGUN GÖRÜLMEMİŞTİR'

type OnlineApplicationRow = {
  id: number
  dogumtarihi: Date | string | null
  yardim_turu: string | null
  answers: Record<string, unknown> | string | null
}

type ApplyCriteriaPayload = {
  criteria?: Partial<OnlineApplicationAutoCriteria>
}

function cleanText(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') return String(value)
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLabel(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function fieldKey(field: { id: string; label: string }) {
  const label = normalizeLabel(field.label)
  if (label.includes('tc') || label.includes('kimlik')) return 'tc'
  if (label.includes('doğum') || label.includes('dogum')) return 'birthDate'
  if (label.includes('ad soyad') || label.includes('adı soyadı')) return 'fullName'
  if (label.includes('adres no') || label.includes('adresno')) return 'addressNo'
  if (label.includes('adres')) return 'address'
  if (label.includes('telefon') || label.includes('cep')) return 'phone'
  if (label.includes('gelir')) return 'income'
  // Kullanici istegi (2026-09-22): "durum" kelimesini SART kosan eski
  // kontrol, "Araç Bilgisi" gibi etiketleri kacirip yanlis anahtarda
  // saklanmasina yol aciyordu - route.ts/OnlineApplicationClient.tsx ile
  // AYNI (senkron) duzeltme.
  const mentionsVehicle = label.includes('araç') || label.includes('araÃ§') || label.includes('arac')
  if (mentionsVehicle && label.includes('model')) return 'vehicleModelYear'
  if (mentionsVehicle) return 'vehicleStatus'
  if (label.includes('iban')) return 'iban'
  return field.id
}

function cleanNumber(value: unknown) {
  const text = cleanText(value).replace(/\./g, '').replace(',', '.')
  const match = text.match(/\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

function calculateAge(birthDate: string) {
  const date = new Date(`${birthDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null

  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const monthDiff = today.getMonth() - date.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age -= 1
  }
  return age
}

function parseAnswers(value: OnlineApplicationRow['answers']) {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return value
}

function getAnswerValue(
  answers: Record<string, unknown>,
  fields: Array<{ id: string; label: string }>,
  key: string,
) {
  if (answers[key] !== undefined) return answers[key]

  const field = fields.find((candidate) => fieldKey(candidate) === key)
  if (!field) return ''

  const mappedKey = fieldKey(field)
  return answers[mappedKey] ?? answers[field.id] ?? ''
}

async function getOnlineForms() {
  try {
    const setting = await settingService.getByKey(ONLINE_APPLICATION_FORMS_SETTING_KEY)
    return Array.isArray(setting?.value)
      ? setting.value as OnlineApplication[]
      : DEFAULT_ONLINE_APPLICATION_FORMS
  } catch {
    return DEFAULT_ONLINE_APPLICATION_FORMS
  }
}

async function getAutoCriteria() {
  try {
    const setting = await settingService.getByKey(ONLINE_APPLICATION_AUTO_CRITERIA_SETTING_KEY)
    return normalizeOnlineApplicationAutoCriteria(
      setting?.value && typeof setting.value === 'object'
        ? setting.value
        : null,
    )
  } catch {
    return normalizeOnlineApplicationAutoCriteria()
  }
}

function applicationViolatesCriteria(
  row: OnlineApplicationRow,
  forms: OnlineApplication[],
  criteria: OnlineApplicationAutoCriteria,
) {
  const answers = parseAnswers(row.answers)
  const formId = cleanText(answers.formId)
  const formTitle = cleanText(answers.formTitle) || cleanText(row.yardim_turu)
  const selectedForm = forms.find((form) => form.id === formId || form.title === formTitle)
  const fields = selectedForm?.fields ?? []
  const birthDate = cleanText(row.dogumtarihi) || cleanText(answers.birthDate) || cleanText(answers.f_birthDate)
  const income = cleanNumber(getAnswerValue(answers, fields, 'income'))
  const vehicleModelYear = cleanNumber(getAnswerValue(answers, fields, 'vehicleModelYear'))
  const applicantAge = birthDate ? calculateAge(birthDate) : null

  if (criteria.minAgeEnabled && applicantAge !== null && applicantAge < criteria.minAge) return true
  if (criteria.maxIncomeEnabled && income !== null && income > criteria.maxIncome) return true
  if (criteria.maxVehicleModelYearEnabled && vehicleModelYear !== null && vehicleModelYear > criteria.maxVehicleModelYear) return true
  if (criteria.maxAgeEnabled && applicantAge !== null && applicantAge > criteria.maxAge) return true

  return false
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'online.forms.criteria', page: '/online' })
    if (accessDenied) return accessDenied

    const body = await request.json().catch(() => ({})) as ApplyCriteriaPayload
    const criteria = body.criteria
      ? normalizeOnlineApplicationAutoCriteria(body.criteria)
      : await getAutoCriteria()
    const forms = await getOnlineForms()

    const rows = await prisma.$queryRaw<OnlineApplicationRow[]>`
      SELECT id, dogumtarihi, yardim_turu, answers
      FROM online_basvurular
    `

    let rejectedCount = 0
    let updatedCount = 0

    for (const row of rows) {
      if (!applicationViolatesCriteria(row, forms, criteria)) continue

      rejectedCount += 1
      const updatedRows = await prisma.$queryRaw<Array<{ id: number }>>`
        UPDATE online_basvurular
        SET asama = ${REJECTED_STAGE},
            aciklama = ${REJECTED_NOTE}
        WHERE id = ${row.id}
          AND (
            COALESCE(asama, '') <> ${REJECTED_STAGE}
            OR COALESCE(aciklama, '') <> ${REJECTED_NOTE}
          )
        RETURNING id
      `
      updatedCount += updatedRows.length
    }

    return NextResponse.json({
      success: true,
      data: {
        examined: rows.length,
        rejected: rejectedCount,
        updated: updatedCount,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kriterler uygulanamadi.' },
      { status: 400 },
    )
  }
}
