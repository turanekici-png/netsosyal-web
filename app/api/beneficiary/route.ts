import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { beneficiaryService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { buildAssistanceExistsCondition, readAssistanceFilterParams } from '@/lib/utils/assistanceFilter'
import {
  BENEFICIARY_FROM_CLAUSE,
  beneficiaryGenderLabelSql,
  buildBeneficiaryConditions,
  buildBeneficiaryOrderBy,
  finalizeWhereClause,
} from '@/lib/beneficiary/beneficiaryListQuery'

export const dynamic = "force-dynamic"

type BeneficiaryListRow = {
  id: string
  dosyaId: string | null
  dosyaNo: string | null
  dosyaDurumu: number | null
  incelemePuani: number | null
  tc: string | null
  adSoyad: string | null
  adi: string | null
  soyadi: string | null
  telefon: string | null
  ilce: string | null
  mahalle: string | null
  yakinligi: number | null
  cinsiyet: string | null
  babaAdi: string | null
  anaAdi: string | null
  dogumTarihi: Date | null
  olumTarihi: string | null
  medeniHali: number | null
  adresNo: string | null
  adres: string | null
  kayitTarihi: Date | null
  guncellemeTarihi: Date | null
}

type DeletePayload = { ids?: Array<string | number> }

const PAGE_SIZE_LIMIT = 200

function getPositiveNumber(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function normalizeIds(ids: DeletePayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

function buildWhereClause(searchParams: URLSearchParams, search: string) {
  const builder = buildBeneficiaryConditions(searchParams, search)

  const assistanceCondition = buildAssistanceExistsCondition(builder, 'b.dosyaid', readAssistanceFilterParams(searchParams))
  if (assistanceCondition) builder.clauses.push(assistanceCondition)

  return finalizeWhereClause(builder)
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const page = getPositiveNumber(searchParams.get('page'), 1)
    const limit = Math.min(getPositiveNumber(searchParams.get('limit'), 50), PAGE_SIZE_LIMIT)
    const queryLimit = limit + 1
    const offset = (page - 1) * limit
    const search = searchParams.get('search')?.trim() || ''
    const orderBy = buildBeneficiaryOrderBy(searchParams.get('sort'))
    const whereClause = buildWhereClause(searchParams, search)
    const exportAll = searchParams.get('export') === 'all'
    const limitClause = exportAll
      ? ''
      : `LIMIT $${whereClause.values.length + 1} OFFSET $${whereClause.values.length + 2}`
    const queryValues = exportAll
      ? whereClause.values
      : [...whereClause.values, queryLimit, offset]

    const totalRows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`
      SELECT COUNT(*)::bigint AS total
      ${BENEFICIARY_FROM_CLAUSE}
      ${whereClause.sql}
    `, ...whereClause.values)

    const rows = await prisma.$queryRawUnsafe<BeneficiaryListRow[]>(`
      SELECT
        b.id::text AS "id",
        b.dosyaid::text AS "dosyaId",
        d.dosyano AS "dosyaNo",
        d.durumu AS "dosyaDurumu",
        d.inceleme_puani AS "incelemePuani",
        b.tckimlikno AS "tc",
        COALESCE(
          NULLIF(BTRIM(b.adisoyadi), ''),
          NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(b.adi), ''), NULLIF(BTRIM(b.soyadi), ''))), '')
        ) AS "adSoyad",
        b.adi AS "adi",
        b.soyadi AS "soyadi",
        b.ceptel AS "telefon",
        b.nfilce AS "ilce",
        b.nfmahkoy AS "mahalle",
        b.yakinligi AS "yakinligi",
        ${beneficiaryGenderLabelSql} AS "cinsiyet",
        b.babaadi AS "babaAdi",
        b.anaadi AS "anaAdi",
        b.dogumtarihi AS "dogumTarihi",
        b.olumtarihi AS "olumTarihi",
        b.medenihali AS "medeniHali",
        b.adresno AS "adresNo",
        b.adres AS "adres",
        b.ilkislemtarihi AS "kayitTarihi",
        b.islemtarihi AS "guncellemeTarihi"
      ${BENEFICIARY_FROM_CLAUSE}
      ${whereClause.sql}
      ORDER BY ${orderBy}
      ${limitClause}
    `, ...queryValues)

    const hasNext = rows.length > limit
    const pagedRows = exportAll ? rows : hasNext ? rows.slice(0, limit) : rows

    return NextResponse.json({
      success: true,
      data: pagedRows,
      pagination: {
        page,
        limit,
        hasNext,
        total: Number(totalRows[0]?.total || 0),
      },
    })
  } catch (error) {
    console.error('GET Beneficiary Error:', error)
    return NextResponse.json(
      { success: false, error: 'Bireyler getirilirken hata olustu.' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/beneficiary' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const newBeneficiary = await withAuditedWrite((tx) => beneficiaryService.create({
      tc: body.tc,
      name: body.name,
      phone: body.phone,
      district: body.district,
      status: body.status ? parseInt(body.status) : 0,
      notes: body.notes
    }, tx), getAuditMetaFromRequest(request))

    return NextResponse.json({
      ...newBeneficiary,
      registerDate: newBeneficiary.createdAt ? new Date(newBeneficiary.createdAt).toLocaleDateString('tr-TR') : '-'
    }, { status: 201 })
  } catch (error) {
    console.error('POST Beneficiary Error:', error)
    return NextResponse.json({ error: 'Birey eklenirken hata olustu veya bu TC zaten mevcut.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.delete', page: '/beneficiary' })
    if (accessDenied) return accessDenied

    const payload = await request.json().catch(() => ({})) as DeletePayload
    const ids = normalizeIds(payload.ids)

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek birey seçilmedi.' }, { status: 400 })
    }

    const deleted = await withAuditedWrite((tx) => tx.$executeRawUnsafe(
      `
        DELETE FROM bireyler
        WHERE id = ANY($1::bigint[])
          AND COALESCE(yakinligi, -1) <> 0
      `,
      ids,
    ), getAuditMetaFromRequest(request))

    if (deleted === 0) {
      return NextResponse.json(
        { success: false, error: 'Dosya sahibi olan bireyler bu ekrandan silinemez.' },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        requested: ids.length,
        deleted,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Birey silinemedi.' },
      { status: 500 },
    )
  }
}
