import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

const KAYIT_TURU_LABELS: Record<string, string> = {
  yrd_gidabankasi: 'Gıda Bankası',
  yrd_destekpaketi: 'Destek Paketi',
  yrd_ddgidadosyali: 'Dönem Dışı Gıda',
  tahkikat_raporu: 'İnceleme Raporu',
}

type DecisionRow = {
  id: string
  kayitTuru: string
  durum: number
  onayTarihi: Date | null
  redAciklama: string | null
  dosyaId: string
  dosyaNo: string | null
  onaylayanAdi: string | null
}

// GET - oturum sahibinin GONDERDIGI onay taleplerinden, karara baglanmis
// (onaylanmis/reddedilmis) ama HENUZ GORULMEMIS olanlari doner - header'daki
// "Gelen Bildirimler" cani bunu diger bildirim turleriyle birlikte gosterir.
export async function GET() {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const rows = await prisma.$queryRaw<DecisionRow[]>`
      SELECT
        o.id::text AS "id",
        o.kayit_turu AS "kayitTuru",
        o.durum AS "durum",
        o.onay_tarihi AS "onayTarihi",
        o.red_aciklama AS "redAciklama",
        o.dosya_id::text AS "dosyaId",
        d.dosyano AS "dosyaNo",
        COALESCE(NULLIF(BTRIM(approver.kullanicitamadi), ''), approver.kullaniciadi) AS "onaylayanAdi"
      FROM yardim_onay_talepleri o
      LEFT JOIN dosyalar d ON d.id = o.dosya_id
      LEFT JOIN kullanicilar approver ON approver.id = o.onaylayan_kullaniciid
      WHERE o.talep_eden_kullaniciid = ${Number(sessionUser.id)}
        AND o.durum IN (1, 2)
        AND o.bildirim_gorundu = false
      ORDER BY o.onay_tarihi DESC
      LIMIT 30
    `

    const data = rows.map((row) => ({
      id: row.id,
      dosyaId: row.dosyaId,
      dosyaNo: row.dosyaNo || '-',
      kayitTuru: row.kayitTuru,
      turAdi: KAYIT_TURU_LABELS[row.kayitTuru] || row.kayitTuru,
      durum: row.durum,
      onaylayanAdi: row.onaylayanAdi || '-',
      onayTarihi: row.onayTarihi,
      redAciklama: row.redAciklama,
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Bildirimler alınamadı.' },
      { status: 500 },
    )
  }
}
