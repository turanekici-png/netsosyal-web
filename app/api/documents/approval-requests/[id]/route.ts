import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser, requireAuthorizedPersonnelOrAdmin } from '@/lib/apiAuth'
import { sendPushToUser } from '@/lib/services/webPush.service'
import { sendWhatsappNotificationToUser } from '@/lib/services/whatsappNotify.service'

export const dynamic = 'force-dynamic'

const KAYIT_TURU_LABELS: Record<string, string> = {
  yrd_gidabankasi: 'Gıda Bankası',
  yrd_destekpaketi: 'Destek Paketi',
  yrd_ddgidadosyali: 'Dönem Dışı Gıda',
  tahkikat_raporu: 'İnceleme Raporu',
}

type Params = { id: string }

type UpdatedRequestRow = {
  id: bigint
  kayit_turu: string
  kayit_id: bigint
  dosya_id: bigint
  donem: number | null
  rapor_id: bigint | null
  talep_eden_kullaniciid: number | null
}

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

// "onay_islemleri" - bu talebin GECMISINE (audit trail) bir satir ekler -
// bkz. prisma/schema.prisma.
async function logApprovalAction(row: UpdatedRequestRow, islemTipi: string, kullaniciid: number | null, aciklama: string | null) {
  await prisma.$executeRaw`
    INSERT INTO onay_islemleri (onay_talep_id, islem_tipi, kayit_turu, kayit_id, dosya_id, donem, kullaniciid, aciklama)
    VALUES (${row.id}, ${islemTipi}, ${row.kayit_turu}, ${row.kayit_id}, ${row.dosya_id}, ${row.donem}, ${kullaniciid}, ${aciklama})
  `
}

// PATCH - onayla/reddet/iptal et:
//  - approve/reject: sadece "Yetkili Personel" (veya admin) yapabilir.
//  - cancel: talebi GÖNDEREN kullanıcının kendisi, hâlâ beklemedeyken
//    ("Onaya Gönder"i yanlışlıkla ya da gereksiz yere basmışsa) geri
//    alabilmesi için - yetkili personel olması GEREKMEZ.
export async function PATCH(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const { id } = await params
    const requestId = cleanBigInt(id)
    if (!requestId) {
      return NextResponse.json({ success: false, error: 'Onay talebi bulunamadı.' }, { status: 400 })
    }

    const body = await request.json()
    const action = body.action === 'reject' ? 'reject' : body.action === 'approve' ? 'approve' : body.action === 'cancel' ? 'cancel' : null
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null

    if (!action) {
      return NextResponse.json({ success: false, error: 'Geçersiz işlem.' }, { status: 400 })
    }

    if (action === 'cancel') {
      const sessionUser = await getSessionUser()
      if (!sessionUser) {
        return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
      }

      const rows = await prisma.$queryRaw<UpdatedRequestRow[]>`
        UPDATE yardim_onay_talepleri
        SET durum = 3
        WHERE id = ${requestId} AND durum = 0 AND talep_eden_kullaniciid = ${Number(sessionUser.id)}
        RETURNING id, kayit_turu, kayit_id, dosya_id, donem, rapor_id, talep_eden_kullaniciid
      `

      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Talep bulunamadı, size ait değil ya da zaten karara bağlanmış.' },
          { status: 404 },
        )
      }

      await logApprovalAction(rows[0], 'iptal_edildi', Number(sessionUser.id), null)

      return NextResponse.json({ success: true })
    }

    const accessCheck = await requireAuthorizedPersonnelOrAdmin()
    if (accessCheck.response) return accessCheck.response
    const approver = accessCheck.user!

    if (action === 'reject' && !reason) {
      return NextResponse.json({ success: false, error: 'Reddetme gerekçesi zorunludur.' }, { status: 400 })
    }

    const durum = action === 'approve' ? 1 : 2

    const rows = action === 'approve'
      ? await prisma.$queryRaw<UpdatedRequestRow[]>`
          UPDATE yardim_onay_talepleri
          SET durum = ${durum}, onaylayan_kullaniciid = ${Number(approver.id)}, onay_tarihi = NOW()
          WHERE id = ${requestId} AND durum = 0
          RETURNING id, kayit_turu, kayit_id, dosya_id, donem, rapor_id, talep_eden_kullaniciid
        `
      : await prisma.$queryRaw<UpdatedRequestRow[]>`
          UPDATE yardim_onay_talepleri
          SET durum = ${durum}, onaylayan_kullaniciid = ${Number(approver.id)}, onay_tarihi = NOW(), red_aciklama = ${reason}
          WHERE id = ${requestId} AND durum = 0
          RETURNING id, kayit_turu, kayit_id, dosya_id, donem, rapor_id, talep_eden_kullaniciid
        `

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Talep bulunamadı veya zaten karara bağlanmış.' },
        { status: 404 },
      )
    }

    await logApprovalAction(rows[0], action === 'approve' ? 'onaylandi' : 'reddedildi', Number(approver.id), action === 'reject' ? reason : null)

    // Onaylandiginda, "Onaya Gönder" akisindan otomatik olusturulan
    // İnceleme Raporu kaydinda da onaylayan kisi bilgisi doldurulur -
    // rapor listesinde bu kisi sag tarafta gorunur (bkz. report.service.ts).
    if (action === 'approve' && rows[0].rapor_id) {
      await prisma.$executeRaw`
        UPDATE tahkikatraporlari SET onaylayan_kullaniciid = ${Number(approver.id)} WHERE id = ${rows[0].rapor_id}
      `
    }

    // "Uygun Görüş İste" (tahkikat_raporu) talebi REDDEDILDIGINDE, o dosyada
    // uygun görüş istenirken "İstenen Yardımlar" olarak gösterilen, HENUZ
    // karara baglanmamis (durumu=0) müracaatlar - kullanicinin acikca
    // istegi uzerine - otomatik olarak IPTAL EDILIR (durumu=3). Sadece bu
    // akisin kapsamindaki 4 tur (bkz. documents/page.tsx/approval-queue -
    // OPINION_FLOW_ASSISTANCE_TABLES / CONVERTIBLE_SOURCE_TABLES) etkilenir.
    if (action === 'reject' && rows[0].kayit_turu === 'tahkikat_raporu') {
      const dosyaIdText = rows[0].dosya_id.toString()
      const opinionFlowTables = ['yrd_ekmek', 'yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_haziryemek']
      for (const table of opinionFlowTables) {
        await prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET durumu = 3, durumutarih = CURRENT_DATE, bittarih = CURRENT_DATE WHERE dosyaid = $1::bigint AND durumu = 0`,
          dosyaIdText,
        )
      }
    }

    // Masaüstü bildirimi (Web Push) - talebi GÖNDEREN kullanıcıya, ekranı/
    // oturumu kapalı olsa bile karar sonucunu bildirir.
    if (rows[0].talep_eden_kullaniciid) {
      try {
        const fileRow = await prisma.$queryRaw<{ dosyano: string | null }[]>`SELECT dosyano FROM dosyalar WHERE id = ${rows[0].dosya_id}`
        const dosyaNo = fileRow[0]?.dosyano || rows[0].dosya_id.toString()
        const label = KAYIT_TURU_LABELS[rows[0].kayit_turu] || rows[0].kayit_turu
        await sendPushToUser(rows[0].talep_eden_kullaniciid, {
          title: action === 'approve' ? 'Talebiniz Onaylandı' : 'Talebiniz Reddedildi',
          body: `${label} - Dosya ${dosyaNo}`,
          url: '/documents',
          tag: `approval-decision-${rows[0].id}`,
        })
      } catch {
        // Push basarisiz olsa bile karar zaten kaydedildi - kritik degil.
      }

      // Ayni bildirim, EK OLARAK, sadece bunu Ayarlar > Kullanici
      // Yetkileri'nden acikca istemis olan kullaniciya WhatsApp uzerinden de
      // gonderilir (bkz. lib/services/whatsappNotify.service.ts).
      try {
        const fileRow = await prisma.$queryRaw<{ dosyano: string | null }[]>`SELECT dosyano FROM dosyalar WHERE id = ${rows[0].dosya_id}`
        const dosyaNo = fileRow[0]?.dosyano || rows[0].dosya_id.toString()
        const label = KAYIT_TURU_LABELS[rows[0].kayit_turu] || rows[0].kayit_turu
        const whatsappMessage = `${action === 'approve' ? 'Talebiniz Onaylandı' : 'Talebiniz Reddedildi'}\n${label} - Dosya ${dosyaNo}`
        await sendWhatsappNotificationToUser(rows[0].talep_eden_kullaniciid, whatsappMessage)
      } catch {
        // WhatsApp bildirimi ikincil (yan) bir islemdir - kritik degil.
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Onay talebi güncellenemedi.' },
      { status: 500 },
    )
  }
}
