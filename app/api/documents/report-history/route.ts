import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// İnceleme Raporu (tahkikatraporlari) ve Ev Ziyareti (evziyareti) kayıtları
// icin "kim ne zaman girdi/güncelledi" tarihcesini gosterir. Bu tablolarin
// KENDI satirlarinda sadece EN SON durumu (kullaniciid/ilkkullaniciid) var -
// aradaki her degisikligin AYRI bir izini denetim (audit) trigger'inin
// yazdigi sistem_hareket_log tutuyor (her INSERT/UPDATE icin revision_no
// ile artan, eski_deger/yeni_deger JSON anlik goruntuleriyle).
//
// NOT: sistem_hareket_log.kullanici_adi bu iki tablo icin genelde "Sistem"
// olarak yazilmis (audit trigger oturum kullanicisini bu yazma yolunda
// dogru yakalayamamis) - bu yuzden GERCEK kullaniciyi metin sutunundan
// DEGIL, o revizyondaki satirin KENDI yeni_deger.kullaniciid /
// yeni_deger.ilkkullaniciid alanindan okuyup kullanicilar tablosuyla
// esliyoruz - bu her zaman dogru, cunku raporu asil kaydeden/guncelleyen
// uygulama kodu tarafindan yazilan gercek alan budur.
const ALLOWED_TABLES = new Set(['tahkikatraporlari', 'evziyareti'])

type HistoryLogRow = {
  id: string
  islem_tipi: string | null
  eski_deger: Record<string, unknown> | null
  yeni_deger: Record<string, unknown> | null
  tarih: Date | string | null
  revision_no: number | null
}

function cleanBigIntText(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : null
}

export async function GET(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ page: '/documents' })
    if (accessDenied) return accessDenied

    const { searchParams } = request.nextUrl
    const table = searchParams.get('table')?.trim() || ''
    const recordId = cleanBigIntText(searchParams.get('recordId'))

    if (!ALLOWED_TABLES.has(table) || !recordId) {
      return NextResponse.json({ success: false, error: 'Geçersiz parametre.' }, { status: 400 })
    }

    const logRows = await prisma.$queryRaw<HistoryLogRow[]>`
      SELECT
        h.id::text AS id,
        h.islem_tipi,
        h.eski_deger::jsonb AS eski_deger,
        h.yeni_deger::jsonb AS yeni_deger,
        h.tarih,
        h.revision_no
      FROM sistem_hareket_log h
      WHERE h.tablo_adi = ${table} AND h.kayit_id = ${recordId}
      ORDER BY h.revision_no ASC NULLS LAST, h.id ASC
    `

    const actorUserIds = Array.from(new Set(
      logRows.flatMap((row) => {
        const yeni = row.yeni_deger || {}
        const ids = [yeni.kullaniciid, yeni.ilkkullaniciid]
        return ids.filter((id): id is number => typeof id === 'number')
      })
    ))

    const nameById = new Map<number, string | null>()
    if (actorUserIds.length > 0) {
      const users = await prisma.$queryRaw<{ id: bigint; name: string | null }[]>`
        SELECT id, COALESCE(NULLIF(BTRIM(kullanicitamadi), ''), kullaniciadi) AS name
        FROM kullanicilar
        WHERE id = ANY(${actorUserIds.map((id) => BigInt(id))})
      `
      users.forEach((u) => nameById.set(Number(u.id), u.name))
    }

    const data = logRows.map((row) => {
      const op = (row.islem_tipi || '').toLocaleLowerCase('tr-TR')
      const isInsert = op === 'ekle' || op === 'insert'
      const yeni = row.yeni_deger || {}
      const eski = row.eski_deger || {}

      // Ekleme (ilk kayit) islemlerinde asıl giren kisi ilkkullaniciid'de,
      // guncellemelerde ise o revizyonu yapan kisi kullaniciid'de tutulur.
      const actorId = isInsert
        ? (typeof yeni.ilkkullaniciid === 'number' ? yeni.ilkkullaniciid : yeni.kullaniciid)
        : yeni.kullaniciid
      const userName = typeof actorId === 'number' ? (nameById.get(actorId) ?? null) : null

      // Guncellemelerde ne degisti - basit alan bazli karsilastirma (konu/rapor).
      const changedFields: string[] = []
      if (!isInsert) {
        if ((eski.konu ?? '') !== (yeni.konu ?? '')) changedFields.push('Konu')
        if ((eski.rapor ?? '') !== (yeni.rapor ?? '')) changedFields.push('Rapor metni')
        if ((eski.tarih ?? '') !== (yeni.tarih ?? '')) changedFields.push('Tarih')
      }

      return {
        id: row.id,
        isInsert,
        userName,
        activityDate: row.tarih,
        changedFields,
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Geçmiş bilgisi alınamadı.' },
      { status: 500 },
    )
  }
}
