import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { requireDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'

export const dynamic = 'force-dynamic'

const allowedTypes = new Set(['ekmek', 'hazir_yemek', 'kahvalti'])
const numberValue = (value: unknown) => Number(String(value ?? '').replace(',', '.'))

async function access() {
  return requireApiAccess({ page: '/hakedis' })
}

export async function GET(request: Request) {
  try {
    const denied = await access()
    if (denied) return denied

    const yearParam = new URL(request.url).searchParams.get('year')
    const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null
    const pool = getSqlMonitorPool()
    const [tenders, monthly] = await Promise.all([
      pool.query(
        `SELECT
           h.id::text, h.yil, h.ihale_turu, h.ihale_miktari::text, h.birim_fiyati::text,
           h.kdv_orani::text, h.damga_vergisi_orani::text,
           h.teslim_alinan_miktar::text, h.damga_vergisi::text,
           h.odenen_toplam_tutar::text, h.ihale_baslangic_tarihi, h.ihale_bitis_tarihi,
           h.aciklama,
           CASE WHEN h.ihale_miktari > 0
             THEN ROUND((h.teslim_alinan_miktar / h.ihale_miktari) * 100, 2)::text
             ELSE '0' END AS gerceklesme_yuzdesi,
           GREATEST(h.ihale_miktari - h.teslim_alinan_miktar, 0)::text AS kalan_miktar,
           ROUND(h.ihale_miktari * h.birim_fiyati, 2)::text AS ihale_bedel_tutari
         FROM public."hakediş_rapor" h
         WHERE ($1::smallint IS NULL OR h.yil = $1)
         ORDER BY h.yil DESC, h.ihale_turu, h.id DESC`,
        [year],
      ),
      pool.query(
        `SELECT
           a.id::text, a.hakedis_id::text, a.yil, a.ay,
           a.teslim_alinan_miktar::text, a.kdv_orani::text,
           a.damga_vergisi_orani::text, a.brut_tutar::text,
           a.kdv_tutari::text, a.damga_vergisi_tutari::text,
           a.odenecek_tutar::text, a.aciklama
         FROM public."hakediş_aylik" a
         JOIN public."hakediş_rapor" h ON h.id = a.hakedis_id
         WHERE ($1::smallint IS NULL OR h.yil = $1)
         ORDER BY a.yil DESC, a.ay DESC, a.id DESC`,
        [year],
      ),
    ])

    return NextResponse.json({ success: true, data: { tenders: tenders.rows, monthly: monthly.rows } })
  } catch (error) {
    console.error('[Hakediş] Listeleme hatası:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Hakediş bilgileri alınamadı.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const denied = await access()
    if (denied) return denied
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')
    const pool = getSqlMonitorPool()

    if (action === 'tender' || action === 'updateTender') {
      const tenderId = String(body.tenderId || '')
      const year = Number(body.year)
      const type = String(body.type || '')
      const tenderAmount = numberValue(body.tenderAmount)
      const unitPrice = numberValue(body.unitPrice)
      const vatRate = numberValue(body.vatRate)
      const stampRate = numberValue(body.stampRate)
      if (!Number.isInteger(year) || year < 2000 || year > 2200 || !allowedTypes.has(type)) {
        return NextResponse.json({ success: false, error: 'Yıl veya ihale türü geçersiz.' }, { status: 400 })
      }
      if (![tenderAmount, unitPrice, vatRate, stampRate].every(Number.isFinite) || tenderAmount <= 0 || unitPrice < 0 || vatRate < 0 || vatRate > 100 || stampRate < 0 || stampRate > 100) {
        return NextResponse.json({ success: false, error: 'Miktar, fiyat veya vergi oranları geçersiz.' }, { status: 400 })
      }
      if (action === 'updateTender') {
        if (!/^\d+$/.test(tenderId)) {
          return NextResponse.json({ success: false, error: 'İhale kaydı geçersiz.' }, { status: 400 })
        }
        const result = await pool.query(
          `UPDATE public."hakediş_rapor" SET
             yil=$2, ihale_turu=$3, ihale_miktari=$4, birim_fiyati=$5,
             kdv_orani=$6, damga_vergisi_orani=$7,
             ihale_baslangic_tarihi=$8::date, ihale_bitis_tarihi=$9::date,
             aciklama=$10, guncelleme_tarihi=CURRENT_TIMESTAMP
           WHERE id=$1::bigint AND teslim_alinan_miktar <= $4
           RETURNING id::text`,
          [tenderId, year, type, tenderAmount, unitPrice, vatRate, stampRate, body.startDate || null, body.endDate || null, String(body.description || '').trim() || null],
        )
        if (result.rowCount === 0) {
          return NextResponse.json({ success: false, error: 'İhale bulunamadı veya miktar teslim alınan toplamdan az olamaz.' }, { status: 400 })
        }
        return NextResponse.json({ success: true, data: result.rows[0] })
      }
      const result = await pool.query(
        `INSERT INTO public."hakediş_rapor"
          (yil, ihale_turu, ihale_miktari, birim_fiyati, kdv_orani, damga_vergisi_orani,
           ihale_baslangic_tarihi, ihale_bitis_tarihi, aciklama)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9)
         RETURNING id::text`,
        [year, type, tenderAmount, unitPrice, vatRate, stampRate, body.startDate || null, body.endDate || null, String(body.description || '').trim() || null],
      )
      return NextResponse.json({ success: true, data: result.rows[0] }, { status: 201 })
    }

    if (action === 'monthly') {
      const tenderId = String(body.tenderId || '')
      const year = Number(body.year)
      const month = Number(body.month)
      const quantity = numberValue(body.quantity)
      if (!/^\d+$/.test(tenderId) || !Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(quantity) || quantity < 0) {
        return NextResponse.json({ success: false, error: 'Aylık teslimat bilgileri geçersiz.' }, { status: 400 })
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tenderResult = await client.query(
          `SELECT h.ihale_miktari::text, h.birim_fiyati::text, h.kdv_orani::text,
                  h.damga_vergisi_orani::text,
                  COALESCE((SELECT SUM(a.teslim_alinan_miktar)
                            FROM public."hakediş_aylik" a
                            WHERE a.hakedis_id = h.id
                              AND NOT (a.yil = $2 AND a.ay = $3)), 0)::text AS onceki_teslimat
           FROM public."hakediş_rapor" h WHERE h.id = $1::bigint FOR UPDATE`,
          [tenderId, year, month],
        )
        const tender = tenderResult.rows[0]
        if (!tender) {
          await client.query('ROLLBACK')
          return NextResponse.json({ success: false, error: 'İhale kaydı bulunamadı.' }, { status: 404 })
        }
        const unitPrice = Number(tender.birim_fiyati)
        const tenderAmount = Number(tender.ihale_miktari)
        const previousDelivery = Number(tender.onceki_teslimat)
        if (previousDelivery + quantity > tenderAmount) {
          await client.query('ROLLBACK')
          const remaining = Math.max(0, tenderAmount - previousDelivery)
          return NextResponse.json({
            success: false,
            error: `Girilen miktar ihale kalanını aşıyor. En fazla ${remaining.toLocaleString('tr-TR')} teslimat girebilirsiniz.`,
          }, { status: 400 })
        }
        const vatRate = body.vatRate === '' || body.vatRate === undefined ? Number(tender.kdv_orani) : numberValue(body.vatRate)
        const stampRate = body.stampRate === '' || body.stampRate === undefined ? Number(tender.damga_vergisi_orani) : numberValue(body.stampRate)
        if (![vatRate, stampRate].every(Number.isFinite) || vatRate < 0 || vatRate > 100 || stampRate < 0 || stampRate > 100) {
          await client.query('ROLLBACK')
          return NextResponse.json({ success: false, error: 'Vergi oranları geçersiz.' }, { status: 400 })
        }
        const gross = Math.round(quantity * unitPrice * 100) / 100
        const vat = Math.round(gross * vatRate) / 100
        const stamp = Math.round(gross * stampRate) / 100
        const payable = Math.round((gross + vat - stamp) * 100) / 100

        const updated = await client.query(
          `UPDATE public."hakediş_aylik" SET
             teslim_alinan_miktar=$4, kdv_orani=$5, damga_vergisi_orani=$6,
             brut_tutar=$7, kdv_tutari=$8, damga_vergisi_tutari=$9,
             odenecek_tutar=$10, aciklama=$11, guncelleme_tarihi=CURRENT_TIMESTAMP
           WHERE hakedis_id=$1::bigint AND yil=$2 AND ay=$3
           RETURNING id::text`,
          [tenderId, year, month, quantity, vatRate, stampRate, gross, vat, stamp, payable, String(body.description || '').trim() || null],
        )
        if (updated.rowCount === 0) {
          await client.query(
            `INSERT INTO public."hakediş_aylik"
              (hakedis_id, yil, ay, teslim_alinan_miktar, kdv_orani, damga_vergisi_orani,
               brut_tutar, kdv_tutari, damga_vergisi_tutari, odenecek_tutar, aciklama)
             VALUES ($1::bigint,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [tenderId, year, month, quantity, vatRate, stampRate, gross, vat, stamp, payable, String(body.description || '').trim() || null],
          )
        }
        await client.query(
          `UPDATE public."hakediş_rapor" h SET
             teslim_alinan_miktar = s.miktar,
             damga_vergisi = s.damga,
             odenen_toplam_tutar = s.odeme,
             guncelleme_tarihi = CURRENT_TIMESTAMP
           FROM (
             SELECT hakedis_id, COALESCE(SUM(teslim_alinan_miktar),0) miktar,
                    COALESCE(SUM(damga_vergisi_tutari),0) damga,
                    COALESCE(SUM(odenecek_tutar),0) odeme
             FROM public."hakediş_aylik" WHERE hakedis_id=$1::bigint GROUP BY hakedis_id
           ) s WHERE h.id=s.hakedis_id`,
          [tenderId],
        )
        await client.query('COMMIT')
        return NextResponse.json({ success: true, data: { gross, vat, stamp, payable } }, { status: 201 })
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    }

    return NextResponse.json({ success: false, error: 'İşlem türü geçersiz.' }, { status: 400 })
  } catch (error) {
    console.error('[Hakediş] Kayıt hatası:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Hakediş kaydedilemedi.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const denied = await access()
    if (denied) return denied
    const destructiveDenied = await requireDestructiveAuthorization(request)
    if (destructiveDenied) return destructiveDenied

    const id = new URL(request.url).searchParams.get('id') || ''
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, error: 'İhale kaydı geçersiz.' }, { status: 400 })
    }
    const result = await getSqlMonitorPool().query(
      `DELETE FROM public."hakediş_rapor" WHERE id=$1::bigint RETURNING id::text`,
      [id],
    )
    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'İhale kaydı bulunamadı.' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Hakediş] Silme hatası:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'İhale silinemedi.' }, { status: 500 })
  }
}
