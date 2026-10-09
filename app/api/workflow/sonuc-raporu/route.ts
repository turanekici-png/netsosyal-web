import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

export const dynamic = 'force-dynamic'

// İş Akışı > İnceleme Formları ekraninin veri kaynagi. Tek tek dosyalar
// icin degil, TUM dosyalar icin doldurulmus Güncelleme / Ön İnceleme /
// İnceleme (Tahkikat) formlarini tarih araligina gore listeler - "ne kadar
// islem yapilmis" sorusuna toplu cevap verir. Var olan per-dosya rotalari
// (guncelleme-formu, workflow/on-inceleme/report, documents/inceleme-formu)
// bilerek DEGISTIRILMEDI; bu ayri, salt-okunur rapor rotasi ayni tablolari
// sadece dosyaid filtresi olmadan, dosyalar ile join'leyerek okur.

type ReportType = 'guncelleme' | 'on-inceleme' | 'inceleme' | 'summary'

// Kullanici istegi (13 Eylul 2026): "tüm yapılan ön inceleme, tahkikat ve
// sonuç bekleyen raporları gruplar halinde görünsün". Bu rota ONCEDEN
// "inceleme" icin eski/artik KULLANILMAYAN inceleme_formu tablosunu (Tahkikat
// Formu v2'den ONCEki sistem) ve "guncelleme" icin de hicbir route'un
// YAZMADIGI guncelleme_formu tablosunu okuyordu - yani Tahkikat ve Sonuç
// Bekleyen (komisyon) raporlari bu ekranda HIC GORUNMUYORDU. Su an gercekte
// kullanilan kaynaklara tasindi:
//  - "inceleme" (Tahkikat)      -> inceleme_degerlendirme_formu (bkz. app/api/
//                                   documents/inceleme-degerlendirme/route.ts)
//  - "guncelleme" (Sonuç Bekleyen/Komisyon Raporu) -> tahkikatraporlari (bkz.
//                                   app/api/workflow/guncelleme/report/route.ts,
//                                   ayni tablo Prisma "Report" modeliyle de
//                                   eslesir - /api/reports/[id] ile duzenlenir/silinir)
//  - "on-inceleme" zaten dogru tabloyu (on_inceleme_raporlari) okuyordu.

function normalizeDate(value: string | null) {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

async function tableExists(pool: ReturnType<typeof getSqlMonitorPool>, tableName: string) {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  )
  return Boolean(result.rows[0]?.exists)
}

// Dosya sahibinin adi/soyadi icin bireyler tablosuna bakar (documents/route.ts'deki
// ayni desenle tutarli: once dosya sahibi/tipi=1 kaydi, yoksa ilk birey).
const OWNER_JOIN_SQL = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(BTRIM(b.adisoyadi), ''),
      NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(b.adi), ''), NULLIF(BTRIM(b.soyadi), ''))), '')
    ) AS adisoyadi
    FROM bireyler b
    WHERE b.dosyaid = d.id
    ORDER BY CASE WHEN b.tipi = 1 THEN 0 WHEN b.yakinligi = 0 THEN 1 ELSE 2 END, b.id ASC
    LIMIT 1
  ) owner ON TRUE
`

// NOT: guncelleme_formu / on_inceleme_raporlari / inceleme_formu tablolarinda
// (dosyalar/bireyler/yrd_* tablolarinin aksine) veritabani denetim (audit)
// trigger'i KURULU DEGIL - yani "islemi kim yapti" bilgisi sistem_hareket_log'da
// YOK (dogrulandi: bu 3 tablo icin hic satir yazilmiyor). Bu yuzden "İşlemi
// Yapan" bilgisini, formu ilk kaydeden route'un artik dogrudan yazdigi
// "kullaniciid" kolonundan okuyoruz (bkz. guncelleme-formu, inceleme-formu
// POST handler'lari ve on_inceleme_raporlari'nin zaten sahip oldugu ayni
// kolon). Bu kolon eklenmeden ONCE olusturulmus eski kayitlarda bu alan
// bos gorunur - gecmise donuk bilinmiyor, uydurulamaz.
const ADRES_EXPRESSION = `NULLIF(BTRIM(CONCAT_WS(', ', NULLIF(BTRIM(d.mahalleadi), ''), NULLIF(BTRIM(d.cadde), ''), NULLIF(BTRIM(d.sokak), ''))), '')`

export async function GET(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ page: '/workflow/sonuc' })
    if (accessDenied) return accessDenied

    const { searchParams } = request.nextUrl
    const type = (searchParams.get('type') || 'summary') as ReportType
    const dateFrom = normalizeDate(searchParams.get('dateFrom'))
    const dateTo = normalizeDate(searchParams.get('dateTo'))
    const search = searchParams.get('search')?.trim() || ''

    const pool = getSqlMonitorPool()

    if (type === 'guncelleme') {
      if (!(await tableExists(pool, 'tahkikatraporlari'))) return NextResponse.json({ success: true, data: [] })

      const clauses: string[] = []
      const values: string[] = []
      if (dateFrom) { values.push(dateFrom); clauses.push(`g.tarih >= $${values.length}::date`) }
      if (dateTo) { values.push(dateTo); clauses.push(`g.tarih <= $${values.length}::date`) }
      if (search) { values.push(`%${search}%`); clauses.push(`d.dosyano ILIKE $${values.length}`) }
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

      const result = await pool.query(
        `
          SELECT g.id::text AS id, g.dosyaid::text AS "dosyaid", d.dosyano AS "dosyaNo",
                 owner.adisoyadi AS "dosyaSahibi", d.telefon AS "telefon", ${ADRES_EXPRESSION} AS "adres",
                 ku.kullanicitamadi AS "islemYapan",
                 g.tarih AS "formTarihi", g.konu AS "sonuc", g.rapor AS "aciklama", g.islemtarihi
          FROM public.tahkikatraporlari g
          LEFT JOIN dosyalar d ON d.id = g.dosyaid
          LEFT JOIN kullanicilar ku ON ku.id = g.kullaniciid
          ${OWNER_JOIN_SQL}
          ${whereSql}
          ORDER BY g.tarih DESC, g.id DESC
          LIMIT 1000;
        `,
        values,
      )
      return NextResponse.json({ success: true, data: result.rows })
    }

    if (type === 'on-inceleme') {
      if (!(await tableExists(pool, 'on_inceleme_raporlari'))) return NextResponse.json({ success: true, data: [] })

      const clauses: string[] = []
      const values: string[] = []
      if (dateFrom) { values.push(dateFrom); clauses.push(`o.tarih >= $${values.length}::date`) }
      if (dateTo) { values.push(dateTo); clauses.push(`o.tarih <= $${values.length}::date`) }
      if (search) { values.push(`%${search}%`); clauses.push(`d.dosyano ILIKE $${values.length}`) }
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

      const result = await pool.query(
        `
          SELECT o.id::text AS id, o.dosyaid::text AS "dosyaid", d.dosyano AS "dosyaNo",
                 owner.adisoyadi AS "dosyaSahibi", d.telefon AS "telefon", ${ADRES_EXPRESSION} AS "adres",
                 ku.kullanicitamadi AS "islemYapan",
                 o.tarih, o.sonuc, o.aciklama, o.islemtarihi
          FROM public.on_inceleme_raporlari o
          LEFT JOIN dosyalar d ON d.id = o.dosyaid
          LEFT JOIN kullanicilar ku ON ku.id = o.kullaniciid
          ${OWNER_JOIN_SQL}
          ${whereSql}
          ORDER BY o.tarih DESC, o.id DESC
          LIMIT 1000;
        `,
        values,
      )
      return NextResponse.json({ success: true, data: result.rows })
    }

    if (type === 'inceleme') {
      if (!(await tableExists(pool, 'inceleme_degerlendirme_formu'))) return NextResponse.json({ success: true, data: [] })

      const clauses: string[] = []
      const values: string[] = []
      if (dateFrom) { values.push(dateFrom); clauses.push(`i.tarih >= $${values.length}::date`) }
      if (dateTo) { values.push(dateTo); clauses.push(`i.tarih <= $${values.length}::date`) }
      if (search) { values.push(`%${search}%`); clauses.push(`d.dosyano ILIKE $${values.length}`) }
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

      // Tahkikat Formu v2'nin (inceleme_degerlendirme_formu) eski sistemdeki
      // "otomatik_sonuc"/"komisyon_karari" ayrimi yok - bunlarin yerine
      // karar/eliminasyon_sonucu ve onay_durumu kullanildi (bkz. lib/constants/
      // incelemeDegerlendirmeForm.ts OnayDurumu etiketleri).
      const result = await pool.query(
        `
          SELECT i.id::text AS id, i.dosyaid::text AS "dosyaid", d.dosyano AS "dosyaNo",
                 owner.adisoyadi AS "dosyaSahibi", d.telefon AS "telefon", ${ADRES_EXPRESSION} AS "adres",
                 COALESCE(NULLIF(i.personel, ''), ku.kullanicitamadi) AS "islemYapan",
                 i.tarih AS "formTarihi", i.ad_soyad AS "adSoyad", i.toplam_puan AS "toplamPuan",
                 CASE WHEN i.eliminasyon_sonucu = 'RED' THEN 'ELİMİNASYON: RED' ELSE i.karar END AS "otomatikSonuc",
                 CASE i.onay_durumu
                   WHEN 'beklemede' THEN 'Onay Bekliyor'
                   WHEN 'onaylandi' THEN 'Onaylandı'
                   WHEN 'reddedildi' THEN 'Reddedildi'
                   ELSE 'Onay Gerekmiyor'
                 END AS "komisyonKarari",
                 i.personel AS "inceleyenAdSoyad", i.guncelleme_tarihi AS "islemtarihi"
          FROM public.inceleme_degerlendirme_formu i
          LEFT JOIN dosyalar d ON d.id = i.dosyaid
          LEFT JOIN kullanicilar ku ON ku.id = i.kullaniciid
          ${OWNER_JOIN_SQL}
          ${whereSql}
          ORDER BY i.tarih DESC, i.id DESC
          LIMIT 1000;
        `,
        values,
      )
      return NextResponse.json({ success: true, data: result.rows })
    }

    // type === 'summary': üç form türü için toplam sayı + sonuç dağılımı
    const [hasGuncelleme, hasOnInceleme, hasInceleme] = await Promise.all([
      tableExists(pool, 'tahkikatraporlari'),
      tableExists(pool, 'on_inceleme_raporlari'),
      tableExists(pool, 'inceleme_degerlendirme_formu'),
    ])

    const dateClauseFor = (column: string, values: string[]) => {
      const clauses: string[] = []
      if (dateFrom) { values.push(dateFrom); clauses.push(`${column} >= $${values.length}::date`) }
      if (dateTo) { values.push(dateTo); clauses.push(`${column} <= $${values.length}::date`) }
      return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    }

    const totals = { guncelleme: 0, onInceleme: 0, inceleme: 0 }
    const bySonuc: Array<{ type: string; sonuc: string; count: number }> = []

    if (hasGuncelleme) {
      const values: string[] = []
      const whereSql = dateClauseFor('tarih', values)
      const [totalRow, sonucRows] = await Promise.all([
        pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.tahkikatraporlari ${whereSql};`, values),
        pool.query<{ sonuc: string | null; count: string }>(
          `SELECT COALESCE(NULLIF(konu, ''), 'Belirtilmemiş') AS sonuc, COUNT(*)::text AS count FROM public.tahkikatraporlari ${whereSql} GROUP BY 1 ORDER BY 2 DESC;`,
          values,
        ),
      ])
      totals.guncelleme = Number(totalRow.rows[0]?.count || 0)
      sonucRows.rows.forEach((row) => bySonuc.push({ type: 'Sonuç Bekleyen', sonuc: row.sonuc || 'Belirtilmemiş', count: Number(row.count) }))
    }

    if (hasOnInceleme) {
      const values: string[] = []
      const whereSql = dateClauseFor('tarih', values)
      const [totalRow, sonucRows] = await Promise.all([
        pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.on_inceleme_raporlari ${whereSql};`, values),
        pool.query<{ sonuc: string | null; count: string }>(
          `SELECT COALESCE(NULLIF(sonuc, ''), 'Belirtilmemiş') AS sonuc, COUNT(*)::text AS count FROM public.on_inceleme_raporlari ${whereSql} GROUP BY 1 ORDER BY 2 DESC;`,
          values,
        ),
      ])
      totals.onInceleme = Number(totalRow.rows[0]?.count || 0)
      sonucRows.rows.forEach((row) => bySonuc.push({ type: 'Ön İnceleme', sonuc: row.sonuc || 'Belirtilmemiş', count: Number(row.count) }))
    }

    if (hasInceleme) {
      const values: string[] = []
      const whereSql = dateClauseFor('tarih', values)
      const [totalRow, sonucRows] = await Promise.all([
        pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.inceleme_degerlendirme_formu ${whereSql};`, values),
        pool.query<{ sonuc: string | null; count: string }>(
          `
            SELECT COALESCE(NULLIF(CASE WHEN eliminasyon_sonucu = 'RED' THEN 'ELİMİNASYON: RED' ELSE karar END, ''), 'Belirtilmemiş') AS sonuc,
                   COUNT(*)::text AS count
            FROM public.inceleme_degerlendirme_formu ${whereSql} GROUP BY 1 ORDER BY 2 DESC;
          `,
          values,
        ),
      ])
      totals.inceleme = Number(totalRow.rows[0]?.count || 0)
      sonucRows.rows.forEach((row) => bySonuc.push({ type: 'Tahkikat', sonuc: row.sonuc || 'Belirtilmemiş', count: Number(row.count) }))
    }

    return NextResponse.json({
      success: true,
      data: {
        totals: { ...totals, all: totals.guncelleme + totals.onInceleme + totals.inceleme },
        bySonuc,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Sonuç raporu alınamadı.' },
      { status: 500 },
    )
  }
}
