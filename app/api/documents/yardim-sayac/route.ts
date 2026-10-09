import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess, getSessionUser } from '@/lib/apiAuth'
import { isTrackedYardimTuru } from '@/lib/constants/yardimSayac'
import { nowAsNaiveIstanbulDate } from '@/lib/db/naiveIstanbulTime'

export const dynamic = 'force-dynamic'

// Yardim Sayac - kullanicilarin BARKOD YAZICISINA gonderdikleri (basiliya
// verdikleri) yardimlarin kaydi. Yalniz dort tur izlenir. Kayit eden yer:
// printRenderedDesign (app/(modules)/documents/page.tsx) -> yazdirma basari
// ile tamamlaninca buraya POST atar. Rapor: /reports/yardim-sayac.
//
// AKTIF AY VERISINE DOKUNMAZ: sadece kendi 'yardim_sayac' tablosuna yazar,
// hicbir yrd_* tablosunu / donem verisini degistirmez.

const PAGE_SIZE = 100

function clip(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text || text === '-') return null
  return text.length > max ? text.slice(0, max) : text
}

export async function POST(request: NextRequest) {
  try {
    const denied = await requireApiAccess({ page: '/documents' })
    if (denied) return denied

    const body = await request.json().catch(() => null) as {
      yardimTuru?: unknown
      dosyaNo?: unknown
      dosyaId?: unknown
      adSoyad?: unknown
      miktar?: unknown
      yaziciAdi?: unknown
      sanalYazici?: unknown
      aciklama?: unknown
    } | null

    // Kullanici istegi (2026-09-28): "bir yardım türü için bu sanal yazıcı
    // seçilir ise ... herhangi bir yazıcıya değilde direk olarak ...
    // yardım_sayaç tablosuna göndermek istiyorum" - Sanal Yazici (bkz.
    // documents/page.tsx VIRTUAL_PRINTER_NAME) ile gonderilen istekler,
    // ONCEDEN SABIT 4 turle SINIRLI olan "isTrackedYardimTuru" listesine
    // TABI DEGILDIR - hangi yardim turu icin sanal yazici secilmisse o tur
    // kaydedilir. GERCEK bir yaziciya gonderilen (bu bayrak OLMAYAN)
    // istekler ESKISI GIBI sadece 4 sabit turle sinirli kalir.
    const sanalYazici = body?.sanalYazici === true
    const yardimTuru = clip(body?.yardimTuru, 60)
    if (!sanalYazici && !isTrackedYardimTuru(yardimTuru)) {
      // Izlenmeyen tur - sessizce yok say (istemci her yazdirmada cagirabilir).
      return NextResponse.json({ success: true, logged: false })
    }
    if (!yardimTuru) {
      return NextResponse.json({ success: true, logged: false })
    }

    // "Gonderen kullanici" istemciden ALINMAZ - oturumdan cozulur.
    const user = await getSessionUser()
    const gonderenKullanici = clip(user?.name, 200) || clip(user?.username, 200)
    if (!gonderenKullanici) {
      return NextResponse.json({ success: true, logged: false })
    }

    // Kullanici istegi (14 Eylul 2026): "yardim_sayac... gercek Turkiye
    // saatinden 3 saat geride kaydediliyor" - DB kolonunun @default(now())
    // varsayilani PostgreSQL'in UTC oturumundaki CURRENT_TIMESTAMP'ini
    // kullaniyordu (ham deger UTC duvar-saati). Artik acikca Istanbul
    // duvar-saati hesaplanip yaziliyor (bkz. lib/db/naiveIstanbulTime.ts) -
    // ekranda gosterilen saat zaten DOGRUYDU, bu degisiklik HAM saklanan
    // degerin de gercek Turkiye saatiyle eslesmesini saglar.
    const simdi = nowAsNaiveIstanbulDate()

    const row = await prisma.yardimSayac.create({
      data: {
        islemTarihi: simdi,
        olusturmaTarihi: simdi,
        yardimTuru,
        dosyaNo: clip(body?.dosyaNo, 60),
        dosyaId: clip(body?.dosyaId, 40),
        adSoyad: clip(body?.adSoyad, 200),
        miktar: clip(body?.miktar, 80),
        yaziciAdi: clip(body?.yaziciAdi, 200),
        gonderenKullanici,
        aciklama: clip(body?.aciklama, 500),
      },
    })

    return NextResponse.json({ success: true, logged: true, id: row.id.toString() })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Yardım sayaç kaydı oluşturulamadı.' },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const denied = await requireApiAccess({ page: '/reports/yardim-sayac' })
    if (denied) return denied

    const sp = request.nextUrl.searchParams
    const currentPage = Math.max(1, Number(sp.get('page')) || 1)
    const search = (sp.get('search') || '').trim()
    const turFilter = (sp.get('tur') || '').trim()
    const baslangic = (sp.get('baslangic') || '').trim()
    const bitis = (sp.get('bitis') || '').trim()

    const where: Record<string, unknown> = {}
    if (isTrackedYardimTuru(turFilter)) {
      where.yardimTuru = turFilter
    }
    if (search) {
      where.OR = [
        { dosyaNo: { contains: search, mode: 'insensitive' } },
        { adSoyad: { contains: search, mode: 'insensitive' } },
        { gonderenKullanici: { contains: search, mode: 'insensitive' } },
      ]
    }
    const islemTarihi: Record<string, Date> = {}
    if (baslangic && !Number.isNaN(Date.parse(baslangic))) islemTarihi.gte = new Date(`${baslangic}T00:00:00`)
    if (bitis && !Number.isNaN(Date.parse(bitis))) islemTarihi.lte = new Date(`${bitis}T23:59:59.999`)
    if (Object.keys(islemTarihi).length) where.islemTarihi = islemTarihi

    const [totalCount, rows] = await Promise.all([
      prisma.yardimSayac.count({ where }),
      prisma.yardimSayac.findMany({
        where,
        orderBy: { id: 'desc' },
        take: PAGE_SIZE,
        skip: (currentPage - 1) * PAGE_SIZE,
      }),
    ])

    return NextResponse.json({
      success: true,
      totalCount,
      currentPage,
      pageSize: PAGE_SIZE,
      data: rows.map((row) => ({
        id: row.id.toString(),
        islemTarihi: row.islemTarihi,
        yardimTuru: row.yardimTuru,
        dosyaNo: row.dosyaNo,
        adSoyad: row.adSoyad,
        miktar: row.miktar,
        yaziciAdi: row.yaziciAdi,
        gonderenKullanici: row.gonderenKullanici,
        aciklama: row.aciklama,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Yardım sayaç kayıtları alınamadı.' },
      { status: 500 },
    )
  }
}
