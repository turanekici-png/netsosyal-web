import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { withAuditedWrite, getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { normalizeTrPhoneOrNull } from '@/lib/phone'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-09-22): "müracaatlar, yardımlar ve iptal
// edilenler sekmelerinde bir müracaat seçilip sağ tık yaptığımızda ...
// müracaatı aç butonu ekleyelim ve ... yetkili kullanıcı burada
// güncelleme ve değişiklik yapabilsin" - bu uc nokta, komsu
// no-file-update ile AYNI alan setini gunceller, ama o ucun BILEREK
// koydugu "AND dosyaid IS NULL" guvenlik sinirini TASIMAZ - yani dosyaya
// BAGLI müracaatlari da id'siyle guncelleyebilir. Bu, ManagedReportTablePage
// icindeki "Müracaatı Aç" butonuyla (bkz. saveNoFileCashApplicationEdit)
// HER müracaat (dosyali ya da dosyasiz) icin kullanilir.
type RecordUpdatePayload = {
  id?: string
  tc?: string
  fullName?: string
  birthDate?: string
  phone?: string
  iban?: string
  income?: string
  propertyInfo?: string
  vehicleInfo?: string
  applicationDate?: string
  period?: string
  label?: string
  amount?: string
  description?: string
  stage?: string
  stageDescription?: string
  stageCode?: string
  specialCode?: string
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanDate(value: unknown) {
  const text = cleanText(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function cleanInt(value: unknown) {
  const text = cleanText(value)
  if (!text) return null
  const normalized = Number(text.replace(',', '.'))
  return Number.isFinite(normalized) ? Math.trunc(normalized) : null
}

function cleanBigInt(value: unknown) {
  const text = cleanText(value)
  return text && /^\d+$/.test(text) ? BigInt(text) : null
}

export async function PATCH(request: Request) {
  try {
    // Kullanici istegi (2026-09-22): "Müracaatı Aç" butonu Müracaatlar,
    // Yardımlar ve İptal Edilenler sekmelerinin UCUNDE gorunur, ama bu
    // sekmelerdeki DIGER duzenleme butonlari (Personel Ata, Kayıt Bilgisi
    // Güncelle - bkz. bulk-update/personnel route'lari) "assistance.update"
    // yetkisini kullanir, sadece "requests.update" degil. Tek bir sabit
    // yetkiye baglanirsak, sadece digerine sahip bir kullanici butonu
    // gorup tiklayip "yetkiniz yok" hatasi alirdi - bu yuzden IKI yetkiden
    // HERHANGI BIRI yeterli sayilir.
    const deniedByAssistance = await requireApiAccess({ action: 'assistance.update', page: '/assistance/nakit' })
    if (deniedByAssistance) {
      const deniedByRequests = await requireApiAccess({ action: 'requests.update', page: '/assistance/nakit' })
      if (deniedByRequests) return deniedByRequests
    }

    const body = (await request.json().catch(() => ({}))) as RecordUpdatePayload
    const id = cleanBigInt(body.id)
    const fullName = cleanText(body.fullName)

    if (!id || !fullName) {
      return NextResponse.json(
        { success: false, error: 'Kayıt ve müracaat eden bilgisi zorunludur.' },
        { status: 400 },
      )
    }

    const updatedCount = await withAuditedWrite((tx) => tx.$executeRaw`
      UPDATE yrd_ayninakti
      SET muracaateden = ${fullName},
          tckimlikno = ${cleanText(body.tc)},
          ceptel = ${normalizeTrPhoneOrNull(cleanText(body.phone))},
          muracaattarihi = ${cleanDate(body.applicationDate) ?? new Date()},
          muracaatnotu = ${cleanText(body.description)},
          miktar = ${cleanInt(body.amount)},
          donem = ${cleanText(body.period)},
          iban = ${cleanText(body.iban)},
          aylikgelir = ${cleanInt(body.income)},
          etiket = ${cleanText(body.label)},
          dogumtarihi = ${cleanDate(body.birthDate)},
          mulkiyetbilgisi = ${cleanText(body.propertyInfo)},
          aracbilgisi = ${cleanText(body.vehicleInfo)},
          muracaatozelkod = ${cleanText(body.specialCode)},
          asama = ${cleanText(body.stage)},
          asamanotu = ${cleanText(body.stageDescription)},
          asamaozelkod = ${cleanText(body.stageCode)},
          islemtarihi = NOW()
      WHERE id = ${id}
    `, getAuditMetaFromRequest(request))

    if (updatedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Kayıt bulunamadı.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, updatedCount })
  } catch (error) {
    console.error('Nakit müracaatı güncelleme hatası:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Müracaat kaydı güncellenemedi.' },
      { status: 500 },
    )
  }
}
