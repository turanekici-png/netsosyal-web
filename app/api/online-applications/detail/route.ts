import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

export const dynamic = 'force-dynamic'

type OnlineApplicationDetailPayload = {
  id?: string | number
  tc?: string
  fullName?: string
  birthDate?: string
  phone?: string
  iban?: string
  income?: string
  vehicleStatus?: string
  vehicleModelYear?: string
  assistanceType?: string
  amount?: string
  neighborhood?: string
  address?: string
  status?: string
  period?: string
  label?: string
  stage?: string
  description?: string
}

function cleanId(value: unknown) {
  const text = String(value ?? '').trim()
  return /^\d+$/.test(text) ? text : null
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanNullableText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanTc(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\D/g, '').slice(0, 11)
  return text.length === 11 ? text : null
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (match) return `${match[3]}-${match[2]}-${match[1]}`

  return null
}

function splitFullName(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { firstName: fullName, lastName: '' }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  }
}

function parseAnswers(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export async function PATCH(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'online.forms.manage', page: '/online' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as OnlineApplicationDetailPayload
  const id = cleanId(payload.id)
  const tc = cleanTc(payload.tc)
  const fullName = cleanText(payload.fullName, 120)

  if (!id) {
    return NextResponse.json({ success: false, error: 'Guncellenecek basvuru secilmedi.' }, { status: 400 })
  }

  if (!tc) {
    return NextResponse.json({ success: false, error: 'TC Kimlik No 11 haneli olmalidir.' }, { status: 400 })
  }

  if (!fullName) {
    return NextResponse.json({ success: false, error: 'Ad Soyad zorunludur.' }, { status: 400 })
  }

  const { firstName, lastName } = splitFullName(fullName)
  const birthDate = cleanDate(payload.birthDate)
  const phone = cleanNullableText(payload.phone, 20)
  const iban = cleanNullableText(payload.iban, 45)?.replace(/\s+/g, '').toUpperCase() ?? null
  const income = cleanNullableText(payload.income, 30)
  const vehicleStatus = cleanNullableText(payload.vehicleStatus, 30)
  const vehicleModelYear = cleanNullableText(payload.vehicleModelYear, 10)
  const assistanceType = cleanNullableText(payload.assistanceType, 150)
  const amount = cleanNullableText(payload.amount, 30)
  const neighborhood = cleanNullableText(payload.neighborhood, 120)
  const address = cleanNullableText(payload.address, 500)
  const status = cleanNullableText(payload.status, 50)
  const period = cleanNullableText(payload.period, 50)
  const label = cleanNullableText(payload.label, 100)
  const stage = cleanNullableText(payload.stage, 50)
  const description = cleanNullableText(payload.description, 1000)

  try {
    const pool = getSqlMonitorPool()
    const existingResult = await pool.query<{ answers: unknown }>(
      'SELECT answers FROM public.online_basvurular WHERE id = $1::int LIMIT 1',
      [id],
    )

    if (existingResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Basvuru bulunamadi.' }, { status: 404 })
    }

    const answersJson = JSON.stringify({
      ...parseAnswers(existingResult.rows[0]?.answers),
      tc,
      fullName,
      birthDate: birthDate || '',
      phone: phone || '',
      iban: iban || '',
      income: income || '',
      vehicleStatus: vehicleStatus || '',
      vehicleModelYear: vehicleModelYear || '',
      formTitle: assistanceType || '',
      amount: amount || '',
      miktar: amount || '',
      assistanceAmount: amount || '',
      period: period || '',
      donem: period || '',
      label: label || '',
      etiket: label || '',
      stage: stage || '',
      asama: stage || '',
    })

    const result = await pool.query(
      `
        UPDATE public.online_basvurular
        SET
          tckimlikno = $1,
          ad = $2,
          soyad = $3,
          dogumtarihi = $4,
          yardim_turu = $5,
          mahalleadi = $6,
          adres = $7,
          status = $8,
          donem = $9,
          etiket = $10,
          asama = $11,
          aciklama = $12,
          answers = $13::jsonb
        WHERE id = $14::int
      `,
      [
        tc,
        firstName,
        lastName,
        birthDate,
        assistanceType,
        neighborhood,
        address,
        status,
        period,
        label,
        stage,
        description,
        answersJson,
        id,
      ],
    )

    if ((result.rowCount || 0) === 0) {
      return NextResponse.json({ success: false, error: 'Basvuru bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { updated: result.rowCount || 0 } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Basvuru guncellenemedi.' },
      { status: 500 },
    )
  }
}
