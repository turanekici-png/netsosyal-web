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

type AssignedRow = {
  id: string
  kayitTuru: string
  dosyaId: string
  dosyaNo: string | null
  kisiAdi: string | null
  miktar: string | null
  talepEdenAdi: string | null
  talepTarihi: Date
  aciklama: string | null
}

// GET - oturum sahibine "hedef" olarak ACIKCA SECILMIS, hala beklemede
// (durum=0) ve HENUZ GORULMEMIS onay taleplerini doner - header'daki "Onay
// Bekleyen İşleminiz Var" popup'i bunu kullanir. Genel (hedefsiz) talepler
// zaten "Onay Bekleyenler" kirmizi rozetiyle TUM yetkili personele
// gosteriliyor - bu uc nokta sadece OZEL OLARAK bu kisiye yonlendirilenler
// icin ekstra bir hatirlatma sunar.
export async function GET() {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const rows = await prisma.$queryRaw<AssignedRow[]>`
      SELECT
        o.id::text AS "id",
        o.kayit_turu AS "kayitTuru",
        o.dosya_id::text AS "dosyaId",
        d.dosyano AS "dosyaNo",
        COALESCE(gb.muracaateden, dp.muracaateden, dd.muracaateden, src.konu) AS "kisiAdi",
        COALESCE(gb.miktar, dp.miktar, dd.miktar)::text AS "miktar",
        COALESCE(NULLIF(BTRIM(requester.kullanicitamadi), ''), requester.kullaniciadi) AS "talepEdenAdi",
        o.talep_tarihi AS "talepTarihi",
        o.aciklama AS "aciklama"
      FROM yardim_onay_talepleri o
      LEFT JOIN dosyalar d ON d.id = o.dosya_id
      LEFT JOIN yrd_gidabankasi gb ON o.kayit_turu = 'yrd_gidabankasi' AND gb.id = o.kayit_id
      LEFT JOIN yrd_destekpaketi dp ON o.kayit_turu = 'yrd_destekpaketi' AND dp.id = o.kayit_id
      LEFT JOIN yrd_ddgidadosyali dd ON o.kayit_turu = 'yrd_ddgidadosyali' AND dd.id = o.kayit_id
      -- SADECE tahkikat_raporu icin KAYNAK kaydin kendisi (kayit_id = rapor
      -- id) - "rapor_id" ile karistirilmamali (bkz. approval-requests/route.ts
      -- - "src" vs "rpt" aciklamasi), orphan kontrolu HER ZAMAN kaynagi baz alir.
      LEFT JOIN tahkikatraporlari src ON o.kayit_turu = 'tahkikat_raporu' AND src.id = o.kayit_id
      LEFT JOIN kullanicilar requester ON requester.id = o.talep_eden_kullaniciid
      WHERE o.hedef_kullaniciid = ${Number(sessionUser.id)}
        AND o.durum = 0
        AND o.hedef_bildirim_gorundu = false
        -- Kaynak kayit silinmis olabilir (bkz. approval-requests/route.ts
        -- ile ayni gerekce) - "yetim" talepler icin bildirim gosterilmez.
        AND COALESCE(gb.id, dp.id, dd.id, src.id) IS NOT NULL
      ORDER BY o.talep_tarihi DESC
      LIMIT 30
    `

    const data = rows.map((row) => ({
      ...row,
      turAdi: KAYIT_TURU_LABELS[row.kayitTuru] || row.kayitTuru,
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Bildirimler alınamadı.' },
      { status: 500 },
    )
  }
}
