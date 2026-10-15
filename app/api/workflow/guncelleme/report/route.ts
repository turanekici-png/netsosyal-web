import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { etkinKimlik } from '@/lib/auth/tahkikatEkip'
import { performansKaydet } from '@/lib/workflow/performans'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null
  return Number.isInteger(numericUserId) ? numericUserId : null
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function cleanBigInt(value: unknown) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null

  try {
    return BigInt(text)
  } catch {
    return null
  }
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow/guncelleme' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const fileId = cleanBigInt(payload.fileId ?? payload.requestId)
    const date = cleanDate(payload.date)
    const title = cleanText(payload.title, 200)
    const content = cleanText(payload.content, 10000)

    if (!fileId || !date || !title || !content) {
      return NextResponse.json(
        { success: false, error: 'Dosya, tarih, konu ve komisyon raporu zorunludur.' },
        { status: 400 },
      )
    }

    // Kullanici istegi (13 Eylul 2026): "İnceleme Formları raporunda...
    // İşlemi Yapan görünsün" - bu INSERT kullaniciid/ilkkullaniciid'i hic
    // yazmiyordu (evziyareti/on_inceleme_raporlari/inceleme_degerlendirme_
    // formu POST'larindaki AYNI desenin eksigiydi) - eklendi.
    const currentUserId = getCurrentUserId(request)

    const rows = await withAuditedWrite((tx) => tx.$queryRaw<Array<{ id: bigint | number | string }>>`
      INSERT INTO public.tahkikatraporlari (
        dosyaid, tarih, konu, rapor, kullaniciid, ilkkullaniciid, ilkislemtarihi, islemtarihi
      )
      VALUES (
        ${fileId}, ${date}::date, ${title}, ${content}, ${currentUserId}, ${currentUserId}, NOW(), NOW()
      )
      RETURNING id;
    `, getAuditMetaFromRequest(request))

    // 2026-10-15: Performans Raporu (is_akisi_performans) - konusu ne olursa
    // olsun Sonuç Bekleyen'den yazilan komisyon raporu sayilir.
    const kimlik = await etkinKimlik(await getSessionUser(), request.cookies)
    await performansKaydet({
      islemTuru: 'sonuc_bekleyen',
      dosyaid: fileId,
      kaynakTablo: 'tahkikatraporlari',
      kaynakId: rows[0]?.id !== undefined ? String(rows[0].id) : null,
      kullaniciId: kimlik.kullaniciId ?? currentUserId,
      ekipKullaniciId: kimlik.ekipKullaniciId,
      sonuc: title,
    })

    return NextResponse.json({
      success: true,
      data: {
        id: rows[0]?.id ? String(rows[0].id) : null,
        fileId: fileId.toString(),
      },
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Komisyon raporu kaydedilemedi.' },
      { status: 500 },
    )
  }
}
