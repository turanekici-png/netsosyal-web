import { NextRequest, NextResponse } from 'next/server'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

const tableSearchColumns: Record<string, string[]> = {
  yrd_ayninakti: ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano'],
  yrd_ddgidadosyali: ['t.muracaateden', 't.aciklama', 't.nedeni', 'd.dosyano'],
  yrd_destekpaketi: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
  yrd_ekmek: ['t.muracaateden', 't.aciklama', 't.kartno', 'd.dosyano'],
  yrd_gidabankasi: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
  yrd_giyim: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
  yrd_haziryemek: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
}

const allowedScopes: Record<string, string> = {
  't.durumu != 0': 't.durumu != 0',
  't.durumu = 0': 't.durumu = 0',
  't.durumu = 1': 't.durumu = 1',
  't.durumu = 6': 't.durumu = 6',
  // Gıda/Destek Paketi/Ekmek/Hazır Yemek "Yardım Alanlar" / "Yardım
  // Almayanlar" sekmeleri (bkz. ilgili page.tsx dosyaları) icin.
  't.durumu = 2': 't.durumu = 2',
  't.durumu != 0 AND t.durumu != 2': 't.durumu != 0 AND t.durumu != 2',
}

export async function GET(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ page: '/assistance' })
    if (accessDenied) return accessDenied

    const tableName = request.nextUrl.searchParams.get('table') || ''
    const scope = request.nextUrl.searchParams.get('scope') || ''
    const searchColumns = tableSearchColumns[tableName]
    const whereClause = allowedScopes[scope]

    if (!searchColumns || !whereClause) {
      return NextResponse.json({ success: false, error: 'Geçersiz yardım listesi.' }, { status: 400 })
    }

    const filters = Object.fromEntries(request.nextUrl.searchParams.entries())
    const filterCondition = buildFilterCondition(filters, 't')
    // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
    const searchCondition = buildTextSearchClause(searchColumns, request.nextUrl.searchParams.get('search')?.trim() || '')
    // Hata duzeltmesi (2026-09-12): "missing FROM-clause entry for table
    // 'gk'" - bkz. bulk-update/route.ts'teki AYNI duzeltme notu. "Gülkart"
    // filtresi aktifken (SADECE Nakit Yardimi listesinde gorunur)
    // buildFilterCondition "gk.kartno" uretir ama bu sorguda JOIN yoktu.
    const needsGulkartJoin = tableName === 'yrd_ayninakti' && /\bgk\./.test(filterCondition + searchCondition)

    const result = await sqlMonitorService.executeQuery(`
      SELECT d.dosyano, d.inceleme_puani, t.*
      FROM ${tableName} t
      LEFT JOIN dosyalar d ON t.dosyaid = d.id
      ${needsGulkartJoin ? `
      LEFT JOIN LATERAL (
        SELECT nk.kartno FROM nakitkart nk WHERE nk.tckimlikno = t.tckimlikno ORDER BY nk.id DESC LIMIT 1
      ) gk ON TRUE` : ''}
      WHERE ${whereClause} ${filterCondition} ${searchCondition}
      ORDER BY t.id DESC
    `)

    const rows = result.rows.map((row) =>
      Object.fromEntries(
        Object.entries(row as Record<string, unknown>).map(([key, value]) => [
          key,
          typeof value === 'bigint' ? value.toString() : value,
        ]),
      ),
    )

    return NextResponse.json({ success: true, data: rows, total: rows.length })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayıtlar dışa aktarılamadı.' },
      { status: 500 },
    )
  }
}
