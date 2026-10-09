import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'

const TABLE_NAME = 'nakitkart'

type GulkartPayload = {
  id?: string
  dosyaid?: string
  bireyid?: string
  tckimlikno?: string
  adisoadi?: string
  kartno?: string
  dogumtarihi?: string
  ceptel?: string
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function normalizeBigInt(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  return /^\d+$/.test(text) ? text : null
}

export async function GET(request: NextRequest) {
  try {
    const dosyaId = request.nextUrl.searchParams.get('dosyaId')?.trim()
    const kartNo = request.nextUrl.searchParams.get('kartNo')?.trim()
    const pool = getSqlMonitorPool()

    if (kartNo) {
      const rezervResult = await pool.query(
        `
          SELECT kartno, barkod
          FROM public.nakitkartrezerv
          WHERE kartno = $1
          LIMIT 1;
        `,
        [kartNo],
      )

      return NextResponse.json({
        success: true,
        data: rezervResult.rows[0] || null,
      })
    }

    if (!dosyaId) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    const result = await pool.query(
      `
        SELECT id::text, dosyaid::text, bireyid::text, tckimlikno, adisoadi, kartno, dogumtarihi, ceptel,
               islemtarihi, ilkislemtarihi
        FROM public.${TABLE_NAME}
        WHERE dosyaid = $1::bigint
        ORDER BY id DESC NULLS LAST, ctid DESC;
      `,
      [dosyaId],
    )

    return NextResponse.json({ success: true, data: result.rows })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gülkart kayıtları alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as GulkartPayload
    const dosyaid = normalizeBigInt(payload.dosyaid)
    const kartno = normalizeText(payload.kartno)

    if (!dosyaid || !kartno) {
      return NextResponse.json({ success: false, error: 'Dosya id ve kart no zorunludur.' }, { status: 400 })
    }

    const pool = getSqlMonitorPool()
    const result = await withAuditedPoolWrite(pool, (client) => client.query(
      `
        INSERT INTO public.${TABLE_NAME}
          (dosyaid, bireyid, tckimlikno, adisoadi, kartno, dogumtarihi, ceptel, islemtarihi, ilkislemtarihi)
        VALUES
          ($1::bigint, $2::bigint, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id::text, dosyaid::text, bireyid::text, tckimlikno, adisoadi, kartno, dogumtarihi, ceptel,
                  islemtarihi, ilkislemtarihi;
      `,
      [
        dosyaid,
        normalizeBigInt(payload.bireyid),
        normalizeText(payload.tckimlikno),
        normalizeText(payload.adisoadi),
        kartno,
        normalizeText(payload.dogumtarihi),
        normalizeText(payload.ceptel),
      ],
    ), getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: result.rows[0] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gülkart kaydı eklenemedi.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as GulkartPayload
    const id = normalizeBigInt(payload.id)

    if (!id) {
      return NextResponse.json({ success: false, error: 'Güncellenecek kayıt seçilmedi.' }, { status: 400 })
    }

    const pool = getSqlMonitorPool()
    const result = await withAuditedPoolWrite(pool, (client) => client.query(
      `
        UPDATE public.${TABLE_NAME}
        SET bireyid = $2::bigint,
            tckimlikno = $3,
            adisoadi = $4,
            kartno = $5,
            dogumtarihi = $6,
            ceptel = $7,
            islemtarihi = NOW()
        WHERE id = $1::bigint
        RETURNING id::text, dosyaid::text, bireyid::text, tckimlikno, adisoadi, kartno, dogumtarihi, ceptel,
                  islemtarihi, ilkislemtarihi;
      `,
      [
        id,
        normalizeBigInt(payload.bireyid),
        normalizeText(payload.tckimlikno),
        normalizeText(payload.adisoadi),
        normalizeText(payload.kartno),
        normalizeText(payload.dogumtarihi),
        normalizeText(payload.ceptel),
      ],
    ), getAuditMetaFromRequest(request))

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Güncellenecek kayıt bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: result.rows[0] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gülkart kaydı güncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/documents' })
    if (accessDenied) return accessDenied

    const id = normalizeBigInt(request.nextUrl.searchParams.get('id'))

    if (!id) {
      return NextResponse.json({ success: false, error: 'Silinecek kayıt seçilmedi.' }, { status: 400 })
    }

    const pool = getSqlMonitorPool()
    const result = await withAuditedPoolWrite(pool, (client) => client.query(
      `
        DELETE FROM public.${TABLE_NAME}
        WHERE id = $1::bigint
        RETURNING id::text;
      `,
      [id],
    ), getAuditMetaFromRequest(request))

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek kayıt bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: result.rows[0] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gülkart kaydı silinemedi.' },
      { status: 500 },
    )
  }
}
