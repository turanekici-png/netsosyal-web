import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { withAuditedWrite, getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { normalizeTrPhoneOrNull } from '@/lib/phone'

export const dynamic = 'force-dynamic'

// Kullanici istegi: bazi Nakit Yardımı müracaatları (ör. Excel ile toplu
// içe aktarılıp TC kimlik numarası HİÇBİR dosyayla eşleşmemiş kayıtlar -
// bkz. NakitApplicationsSyncButton.tsx) hiçbir dosyaya bağlı değildir
// (dosyaid IS NULL). Bu kayıtlara Nakit Müracaatları listesinde çift
// tıklandığında açılacak bir dosya olmadığı için normal "Dosya Yönetimi >
// Müracaat Düzenle" akışı (app/api/documents/applications, dosyaid=fileId
// eşleşmesi ZORUNLU) hiç çalışmaz. Bu uç nokta, SADECE dosyasız (dosyaid IS
// NULL) kayıtları, kendi id'leri üzerinden - bir dosya bağlamı gerekmeden -
// güncelleyebilmek için var; bir kayıt zaten bir dosyaya bağlıysa (normal
// akış) bu uç nokta ONU GÜNCELLEMEZ (aşağıdaki "AND dosyaid IS NULL" şartı
// bilinçli bir güvenlik sınırıdır - bu route'un normal, dosyaya bağlı
// müracaatları da değiştirebilen genel bir "id ile güncelle" ucuna
// dönüşmesini engeller).
type NoFileUpdatePayload = {
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
    const accessDenied = await requireApiAccess({ action: 'requests.update', page: '/assistance/nakit' })
    if (accessDenied) return accessDenied

    const body = (await request.json().catch(() => ({}))) as NoFileUpdatePayload
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
      WHERE id = ${id} AND dosyaid IS NULL
    `, getAuditMetaFromRequest(request))

    if (updatedCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Kayıt bulunamadı ya da artık bir dosyaya bağlı - bu durumda düzenleme normal Dosya Yönetimi ekranından yapılmalıdır.',
        },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, updatedCount })
  } catch (error) {
    console.error('Dosyasız nakit müracaatı güncelleme hatası:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Müracaat kaydı güncellenemedi.' },
      { status: 500 },
    )
  }
}
