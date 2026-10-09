import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Kullanici istegi (Eylul 2026): "Belgeler" ekranindan bir dosyaya belge
// eklenip KAYDET'e basildiginda, o dosyanin BEKLEYEN nakit yardim
// muracaatlari (yrd_ayninakti, durumu = 0) varsa bir pencerede listelensin;
// kullanici her muracaatin "asama" bilgisini (istege bagli) guncelleyip
// kaydedebilsin.
//
// GET  ?dosyaId=<id>   -> o dosyanin durumu=0 nakit muracaatlari
// PATCH { updates: [{ id, asama }] }  -> secili muracaatlarin "asama"sini yazar

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

export async function GET(request: Request) {
  const accessDenied = await requireApiAccess({ page: '/documents' })
  if (accessDenied) return accessDenied

  const dosyaId = new URL(request.url).searchParams.get('dosyaId')
  if (!dosyaId || !/^\d+$/.test(dosyaId)) {
    return NextResponse.json({ success: false, error: 'Geçersiz dosya kimliği.' }, { status: 400 })
  }

  try {
    const result = await sqlMonitorService.executeQuery(`
      SELECT
        t.id::text          AS id,
        d.dosyano           AS dosyano,
        t.muracaateden      AS muracaateden,
        t.donem             AS donem,
        COALESCE(t.asama, '') AS asama,
        (t.otomatikrediptal IS TRUE)                AS "otomatikRedIptal",
        (COALESCE(t.asama, '') ILIKE '%otomatik red%') AS "isOtomatikRed",
        to_char(t.muracaattarihi, 'DD.MM.YYYY') AS muracaattarihi
      FROM yrd_ayninakti t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      WHERE t.dosyaid = ${sqlString(dosyaId)}::bigint AND t.durumu = 0
      ORDER BY t.muracaattarihi DESC NULLS LAST, t.id DESC
    `)
    return NextResponse.json({ success: true, data: result.rows ?? [] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Nakit müracaatları alınamadı.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  const accessDenied = await requireApiAccess({ page: '/documents' })
  if (accessDenied) return accessDenied
  const user = await getSessionUser()

  const body = await request.json().catch(() => null)
  const updates = Array.isArray(body?.updates) ? body.updates : []
  const clean = updates
    .map((u: unknown) => {
      const item = u as Record<string, unknown>
      const id = String(item?.id ?? '')
      const asama = typeof item?.asama === 'string' ? item.asama : undefined
      const otomatikRedIptal = typeof item?.otomatikRedIptal === 'boolean' ? item.otomatikRedIptal : undefined
      return { id, asama, otomatikRedIptal }
    })
    .filter((u: { id: string; asama?: string; otomatikRedIptal?: boolean }) =>
      /^\d+$/.test(u.id) && (u.asama !== undefined || u.otomatikRedIptal !== undefined))

  if (clean.length === 0) {
    return NextResponse.json({ success: true, data: { updated: 0 } })
  }

  try {
    let updated = 0
    for (const { id, asama, otomatikRedIptal } of clean) {
      const sets: string[] = []
      if (asama !== undefined) {
        sets.push(`asama = ${sqlString(asama.trim())}`)
      }
      if (otomatikRedIptal === true) {
        // "Otomatik Red iptal" -> muracaat otomatik reddin DISINDA tutulur;
        // asama HALA "Otomatik Red" ise ve kullanici ayrica bir asama
        // yazmadiysa -> "İNCELENECEK"e cekilir (kayit reddte takili kalmasin).
        sets.push('otomatikrediptal = TRUE')
        if (asama === undefined) {
          sets.push(`asama = CASE WHEN asama ILIKE '%otomatik red%' THEN 'İNCELENECEK' ELSE asama END`)
        }
      } else if (otomatikRedIptal === false) {
        sets.push('otomatikrediptal = FALSE')
      }
      if (sets.length === 0) continue
      sets.push('islemtarihi = NOW()')
      if (user?.id) sets.push(`kullaniciid = ${Number(user.id)}`)

      // Yalnizca HALA durumu=0 olan (bekleyen) muracaatlar guncellenir.
      const res = await sqlMonitorService.executeQuery(`
        UPDATE yrd_ayninakti SET ${sets.join(', ')}
        WHERE id = ${sqlString(id)}::bigint AND durumu = 0
      `)
      updated += res.rowCount ?? 0
    }
    return NextResponse.json({ success: true, data: { updated } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Aşama bilgisi kaydedilemedi.' },
      { status: 500 },
    )
  }
}
