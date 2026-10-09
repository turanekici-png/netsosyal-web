import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser, requireApiAccess, requireAuthorizedPersonnelOrAdmin } from '@/lib/apiAuth'
import { settingService, reportService } from '@/lib/services'
import { AUTHORIZED_PERSONNEL_SETTING_KEY, type AuthorizedPersonnelEntry } from '@/lib/constants/authorizedPersonnel'
import { sendPushToAuthorizedPersonnel, sendPushToUser } from '@/lib/services/webPush.service'
import { sendWhatsappNotificationToAuthorizedPersonnel, sendWhatsappNotificationToUser } from '@/lib/services/whatsappNotify.service'

export const dynamic = 'force-dynamic'

// Yazdirma onayi istenebilecek kayit turleri - digerlerinde odeme penceresi
// (ya da "Donem Disi Gida" gibi pencere kavrami olmayan) yazdirma
// kisitlamasi yok, bu yuzden onay akisi da GEREKMEZ. Bu turler ayni zamanda
// onaylandiginda otomatik bir İnceleme Raporu OLUSTURAN turlerdir (bkz. asagi)
// - TEK ISTISNA "yrd_ddgidadosyali" (Dönem Dışı Gıda): bkz.
// AUTO_REPORT_KAYIT_TURU notu.
const PRINT_KAYIT_TURU = new Set(['yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_ddgidadosyali'])

// Kullanici istegi (Ekim 2026): "Dönem Dışı Gıda onay talepleri ve
// onayları Raporlar ve Tahkikat alanına işlenmesin, veriyi çoğaltıyor" -
// bu talep turu icin (digerlerinden farkli olarak) ASAGIDA (kayit
// olusturulurken) otomatik bir İnceleme Raporu ARTIK OLUSTURULMAZ. Onay
// akisinin kendisi (talep/onay/red, bildirimler, Onay Bekleyenler listesi)
// TAMAMEN AYNEN calismaya devam eder - sadece "Raporlar ve Tahkikatlar >
// İnceleme Raporları" tablosuna otomatik/yinelenen bir satir EKLENMEZ.
const AUTO_REPORT_KAYIT_TURU = new Set(['yrd_gidabankasi', 'yrd_destekpaketi'])

// Genel olarak onay istenebilecek TUM kayit turleri - yazdirma onayina ek
// olarak, Tahkikat > İnceleme Raporları penceresindeki "Uygun Görüş İste"
// butonu da AYNI onay altyapisini (Onay Bekleyenler, bildirimler vb.)
// kullanir - burada kayit_id dogrudan tahkikatraporlari.id'yi tutar (rapor
// zaten var oldugu icin, print turlerinin aksine YENI bir rapor OLUSTURULMAZ).
const APPROVABLE_KAYIT_TURU = new Set([...PRINT_KAYIT_TURU, 'tahkikat_raporu'])

const KAYIT_TURU_LABELS: Record<string, string> = {
  yrd_gidabankasi: 'Gıda Bankası',
  yrd_destekpaketi: 'Destek Paketi',
  yrd_ddgidadosyali: 'Dönem Dışı Gıda',
  tahkikat_raporu: 'İnceleme Raporu',
}

type ApprovalRequestRow = {
  id: string
  kayitTuru: string
  kayitId: string
  dosyaId: string
  donem: number | null
  durum: number
  talepTarihi: Date
  onayTarihi: Date | null
  aciklama: string | null
  redAciklama: string | null
  dosyaNo: string | null
  kisiAdi: string | null
  miktar: string | null
  talepEdenAdi: string | null
  onaylayanAdi: string | null
  hedefAdi: string | null
  raporKonu: string | null
  raporIcerik: string | null
}

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

// GET - onay taleplerini listeler (varsayilan: sadece beklemede olanlar).
// Sadece "Yetkili Personel" (veya admin) gorebilir.
export async function GET(request: Request) {
  try {
    const accessCheck = await requireAuthorizedPersonnelOrAdmin()
    if (accessCheck.response) return accessCheck.response

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending'
    const durumFilter = status === 'approved' ? [1] : status === 'rejected' ? [2] : status === 'cancelled' ? [3] : status === 'all' ? [0, 1, 2, 3] : [0]

    const rows = await prisma.$queryRaw<ApprovalRequestRow[]>`
      SELECT
        o.id::text AS "id",
        o.kayit_turu AS "kayitTuru",
        o.kayit_id::text AS "kayitId",
        o.dosya_id::text AS "dosyaId",
        o.donem AS "donem",
        o.durum AS "durum",
        o.talep_tarihi AS "talepTarihi",
        o.onay_tarihi AS "onayTarihi",
        o.aciklama AS "aciklama",
        o.red_aciklama AS "redAciklama",
        d.dosyano AS "dosyaNo",
        -- İnceleme Raporu talepleri icin gercek bir "muracaat eden kisi"
        -- olmadigindan, o kolonda raporun konu basligi gosterilir.
        COALESCE(gb.muracaateden, dp.muracaateden, dd.muracaateden, src.konu) AS "kisiAdi",
        COALESCE(gb.miktar, dp.miktar, dd.miktar)::text AS "miktar",
        COALESCE(NULLIF(BTRIM(requester.kullanicitamadi), ''), requester.kullaniciadi) AS "talepEdenAdi",
        COALESCE(NULLIF(BTRIM(approver.kullanicitamadi), ''), approver.kullaniciadi) AS "onaylayanAdi",
        COALESCE(NULLIF(BTRIM(target.kullanicitamadi), ''), target.kullaniciadi) AS "hedefAdi",
        -- Yetkili personelin talebi ACMADAN once ne yazildigini gorebilmesi
        -- icin raporun konu basligi + tam icerigi doner - bu SADECE
        -- "tahkikat_raporu" (Uygun Görüş İste) icin degil, YAZDIRMA onayi
        -- (Gıda Bankası/Destek Paketi/Dönem Dışı Gıda) talepleri icin de
        -- gecerlidir - onlar da POST'ta otomatik bir rapor OLUSTURUYOR (bkz.
        -- approval-requests/route.ts POST, rapor_id alani). Bu, "rpt" ile AYRI
        -- bir join - "src" (kaynak/orphan kontrolu) ile KARISTIRILMAMALI:
        -- rapor sonradan silinmis olsa bile talep hala GECERLI/gosterilir,
        -- sadece rapor blogu bos kalir.
        rpt.konu AS "raporKonu",
        rpt.rapor AS "raporIcerik"
      FROM yardim_onay_talepleri o
      LEFT JOIN dosyalar d ON d.id = o.dosya_id
      LEFT JOIN yrd_gidabankasi gb ON o.kayit_turu = 'yrd_gidabankasi' AND gb.id = o.kayit_id
      LEFT JOIN yrd_destekpaketi dp ON o.kayit_turu = 'yrd_destekpaketi' AND dp.id = o.kayit_id
      LEFT JOIN yrd_ddgidadosyali dd ON o.kayit_turu = 'yrd_ddgidadosyali' AND dd.id = o.kayit_id
      -- "src" - SADECE tahkikat_raporu icin KAYNAK kaydin kendisi (kayit_id =
      -- rapor id) - orphan kontrolu VE kisiAdi fallback'i bunu kullanir.
      LEFT JOIN tahkikatraporlari src ON o.kayit_turu = 'tahkikat_raporu' AND src.id = o.kayit_id
      -- "rpt" - HER turde (yazdirma onayi DAHIL) BAGLI/iliskili rapor - SADECE
      -- goruntuleme icin, orphan kontrolune DAHIL EDILMEZ.
      LEFT JOIN tahkikatraporlari rpt ON rpt.id = o.rapor_id
      LEFT JOIN kullanicilar requester ON requester.id = o.talep_eden_kullaniciid
      LEFT JOIN kullanicilar approver ON approver.id = o.onaylayan_kullaniciid
      LEFT JOIN kullanicilar target ON target.id = o.hedef_kullaniciid
      WHERE o.durum = ANY(${durumFilter})
        -- Kaynak kayit (yrd_gidabankasi/yrd_destekpaketi/yrd_ddgidadosyali/
        -- tahkikatraporlari satiri) sonradan SILINMIS olabilir (ör. test
        -- amacli acilip silinen muracaatlar) - boyle "yetim" (orphan)
        -- talepler, altinda artik gercek bir dosya/kisi/tutar bilgisi
        -- olmadigi icin listede "-" doldurulmus satirlar olarak goruntuye
        -- kirlilik katiyordu. Kaynagi hala VAR OLAN talepler disinda
        -- hicbiri gosterilmez - "rpt" (goruntuleme amacli rapor) BURAYA
        -- KATILMAZ, cunku bir raporun VAR OLMASI/SILINMESI talebin
        -- gecerliligini ETKILEMEZ.
        AND COALESCE(gb.id, dp.id, dd.id, src.id) IS NOT NULL
      ORDER BY o.talep_tarihi DESC
      LIMIT 300
    `

    const data = rows.map((row) => ({
      ...row,
      turAdi: KAYIT_TURU_LABELS[row.kayitTuru] || row.kayitTuru,
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Onay talepleri alınamadı.' },
      { status: 500 },
    )
  }
}

// POST - yeni bir onay talebi olusturur. Ayni (kayit_turu, kayit_id, donem)
// icin ZATEN beklemede bir talep varsa, YENISINI OLUSTURMAZ - mevcut talebi
// dondurur (ayni kaydi ust uste birden fazla kez onaya gondermeyi engeller).
export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const body = await request.json()
    const kayitTuru = typeof body.kayitTuru === 'string' ? body.kayitTuru.trim() : ''
    const kayitId = cleanBigInt(body.kayitId)
    const dosyaId = cleanBigInt(body.dosyaId)
    const donem = Number.isInteger(body.donem) ? body.donem : null
    const aciklama = typeof body.aciklama === 'string' && body.aciklama.trim() ? body.aciklama.trim().slice(0, 300) : null

    if (!APPROVABLE_KAYIT_TURU.has(kayitTuru) || !kayitId || !dosyaId) {
      return NextResponse.json({ success: false, error: 'Geçersiz onay talebi bilgisi.' }, { status: 400 })
    }

    // "Uygun Görüş İste" (İnceleme Raporu) - ayri bir islem yetkisiyle
    // kisitlanir (bkz. Ayarlar > Kullanici Yetkileri > Dosya İşlemleri).
    // Yazdirma onayi talepleri (PRINT_KAYIT_TURU) icin boyle bir kisit yok -
    // onlar zaten dosyayi goren herkesin kullanabildigi mevcut bir akis.
    if (kayitTuru === 'tahkikat_raporu') {
      const accessCheck = await requireApiAccess({ action: 'documents.reportOpinion' })
      if (accessCheck) return accessCheck
    }

    // Hedef kullanici opsiyonel ama gonderilmisse GERCEKTEN "Ayarlar >
    // Yetkili Personeller" listesinde olmali - istemciden gelen keyfi bir ID
    // ile baskasi hedef gosterilemez.
    let hedefKullaniciId: number | null = null
    if (body.hedefKullaniciId !== undefined && body.hedefKullaniciId !== null && body.hedefKullaniciId !== '') {
      const candidateId = Number(body.hedefKullaniciId)
      if (Number.isInteger(candidateId)) {
        const authorizedSetting = await settingService.getByKey(AUTHORIZED_PERSONNEL_SETTING_KEY)
        const authorizedList = (authorizedSetting?.value as AuthorizedPersonnelEntry[] | undefined) ?? []
        if (authorizedList.some((entry) => entry.userId === String(candidateId))) {
          hedefKullaniciId = candidateId
        }
      }
    }

    const existingPending = await prisma.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM yardim_onay_talepleri
      WHERE kayit_turu = ${kayitTuru}
        AND kayit_id = ${kayitId}
        AND donem IS NOT DISTINCT FROM ${donem}
        AND durum = 0
      LIMIT 1
    `

    if (existingPending.length > 0) {
      // Zaten beklemede olan talebe hedef kisi guncellenmek istenmis olabilir
      // (ör. once genele gonderildi, sonra belirli bir kisi secildi).
      if (hedefKullaniciId !== null) {
        await prisma.$executeRaw`
          UPDATE yardim_onay_talepleri SET hedef_kullaniciid = ${hedefKullaniciId}
          WHERE id = ${existingPending[0].id} AND hedef_kullaniciid IS NULL
        `
      }
      return NextResponse.json({ success: true, data: { id: existingPending[0].id.toString(), alreadyPending: true } })
    }

    const inserted = await prisma.$queryRaw<{ id: bigint }[]>`
      INSERT INTO yardim_onay_talepleri (kayit_turu, kayit_id, dosya_id, donem, durum, talep_eden_kullaniciid, talep_tarihi, aciklama, hedef_kullaniciid)
      VALUES (${kayitTuru}, ${kayitId}, ${dosyaId}, ${donem}, 0, ${Number(sessionUser.id)}, NOW(), ${aciklama}, ${hedefKullaniciId})
      RETURNING id
    `

    // "onay_islemleri" - bu talebin GECMISINE (audit trail) ilk satiri
    // (talep_edildi) ekler - bkz. prisma/schema.prisma.
    await prisma.$executeRaw`
      INSERT INTO onay_islemleri (onay_talep_id, islem_tipi, kayit_turu, kayit_id, dosya_id, donem, kullaniciid, aciklama)
      VALUES (${inserted[0].id}, 'talep_edildi', ${kayitTuru}, ${kayitId}, ${dosyaId}, ${donem}, ${Number(sessionUser.id)}, ${aciklama})
    `

    // Onay isterken yazilan aciklama, Raporlar > Tahkikat > İnceleme
    // Raporları alanina da otomatik bir rapor kaydi olarak eklenir - konu
    // basligi kayit turunu belirtir, icerik ise aciklama metnidir. Bu rapor
    // onaylandiginda (bkz. [id]/route.ts PATCH) onaylayan_kullaniciid alani
    // doldurulur ve rapor listesinde onaylayan kisi sag tarafta gorunur.
    // "tahkikat_raporu" turunde ZATEN VAR OLAN bir rapora onay/gorus
    // istendigi icin burada YENI bir rapor OLUSTURULMAZ (kayit_id zaten o
    // raporun id'sidir) - sadece PRINT_KAYIT_TURU icin gecerlidir.
    if (AUTO_REPORT_KAYIT_TURU.has(kayitTuru)) {
      try {
        const report = await reportService.create(
          {
            requestId: dosyaId.toString(),
            title: `${KAYIT_TURU_LABELS[kayitTuru] || kayitTuru} Yazdırma Onay Talebi`,
            content: aciklama || 'Onay talebi oluşturuldu.',
            date: new Date(),
            kullaniciid: Number(sessionUser.id),
          },
          prisma,
        )
        await prisma.$executeRaw`
          UPDATE yardim_onay_talepleri SET rapor_id = ${BigInt(report.id)} WHERE id = ${inserted[0].id}
        `
      } catch {
        // Rapor olusturma basarisiz olsa bile onay talebi zaten olusturuldu -
        // bu ikincil (yan) bir kayit oldugu icin ana akisi bozmamali.
      }
    } else if (kayitTuru === 'tahkikat_raporu') {
      // Uygun gorus istenen raporun rapor_id'si zaten kendisidir - talep
      // onaylandiginda [id]/route.ts PATCH bu alani okuyup rapora
      // onaylayan_kullaniciid yazar.
      await prisma.$executeRaw`
        UPDATE yardim_onay_talepleri SET rapor_id = ${kayitId} WHERE id = ${inserted[0].id}
      `
    }

    // Masaüstü bildirimi (Web Push) - yetkili personelin ekranı/oturumu
    // kapalı olsa bile (bilgisayar açık, tarayıcı çalışıyorsa) işletim
    // sisteminin bildirim kutusunda bir uyarı gösterir. Yapılandırılmamışsa
    // (VAPID anahtarları yoksa) sessizce hiçbir şey yapmaz - kritik akışı
    // ASLA engellemez.
    try {
      const fileRow = await prisma.$queryRaw<{ dosyano: string | null }[]>`SELECT dosyano FROM dosyalar WHERE id = ${dosyaId}`
      const dosyaNo = fileRow[0]?.dosyano || dosyaId.toString()
      const label = KAYIT_TURU_LABELS[kayitTuru] || kayitTuru
      const pushPayload = {
        title: 'Onay Bekleyen İşleminiz Var',
        body: `${label} - Dosya ${dosyaNo}${aciklama ? `: ${aciklama}` : ''}`,
        url: '/approval-queue',
        tag: `approval-${inserted[0].id}`,
      }
      if (hedefKullaniciId !== null) {
        await sendPushToUser(hedefKullaniciId, pushPayload)
      } else {
        await sendPushToAuthorizedPersonnel(pushPayload)
      }
    } catch {
      // Push basarisiz olsa bile talep zaten olusturuldu - kritik degil.
    }

    // Ayni bildirim, EK OLARAK, sadece bunu Ayarlar > Kullanici Yetkileri'nden
    // acikca istemis olan yetkili(ler)e WhatsApp uzerinden de gonderilir -
    // bkz. lib/services/whatsappNotify.service.ts (kullanici tercih etmediyse
    // sessizce hicbir sey yapmaz).
    try {
      const fileRow = await prisma.$queryRaw<{ dosyano: string | null }[]>`SELECT dosyano FROM dosyalar WHERE id = ${dosyaId}`
      const dosyaNo = fileRow[0]?.dosyano || dosyaId.toString()
      const label = KAYIT_TURU_LABELS[kayitTuru] || kayitTuru
      const whatsappMessage = `Onay Bekleyen İşleminiz Var\n${label} - Dosya ${dosyaNo}${aciklama ? `: ${aciklama}` : ''}`
      if (hedefKullaniciId !== null) {
        await sendWhatsappNotificationToUser(hedefKullaniciId, whatsappMessage)
      } else {
        await sendWhatsappNotificationToAuthorizedPersonnel(whatsappMessage)
      }
    } catch {
      // WhatsApp bildirimi ikincil (yan) bir islemdir - kritik degil.
    }

    return NextResponse.json({ success: true, data: { id: inserted[0].id.toString(), alreadyPending: false } }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Onay talebi oluşturulamadı.' },
      { status: 500 },
    )
  }
}
