import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'

export const dynamic = 'force-dynamic'

const SMS_INTEGRATION_SETTINGS_KEY = 'sms_integration_settings'

type SmsMessageTemplate = {
  id: string
  title: string
  text: string
  active: boolean
}

type SmsIntegrationSettingsValue = {
  templates?: unknown
  activeProvider?: string
  providers?: Record<string, { senderTitle?: string } | undefined>
}

// Kullanici istegi: nakit yardımları (ve diger) listelerinde toplu SMS
// gönderirken, Ayarlar > Sistem Ayarları > SMS Entegrasyonu > SMS
// Şablonları'nda kayıtlı hazır şablonlardan seçip herkese gönderebilsin -
// bkz. components/shared/BulkSmsSendButton.tsx. Bu, `/api/settings/
// sms_integration_settings` ucunun DOGRUDAN kullanilmasi yerine BILEREK
// AYRI bir uç: o genel uç, SMS saglayici KIMLIK BILGILERINI (kullanici
// adi/sifre/apiKey/apiSecret) DAHIL TUM ayari donuyor - bu bilgiler
// birden fazla sayfada (Dosyalar/Bireyler/Nakit Yardımları vb.)
// gomulu bu paylasilan bilesene SIZDIRILMAMALI. Bu uc SADECE sablon
// listesini (id/başlık/metin), sadece AKTIF olanlari dondurur.
export async function GET() {
  try {
    const accessDenied = await requireApiAccess({})
    if (accessDenied) return accessDenied

    const setting = await settingService.getByKey(SMS_INTEGRATION_SETTINGS_KEY)
    const value = setting?.value as SmsIntegrationSettingsValue | undefined
    const templates = Array.isArray(value?.templates) ? (value.templates as SmsMessageTemplate[]) : []

    const activeTemplates = templates
      .filter((template) => template && template.active && template.text?.trim())
      .map((template) => ({ id: template.id, title: template.title || 'Adsız Şablon', text: template.text }))

    // Kullanici istegi (2026-09-16): toplu SMS gönderiminde de hazır
    // şablonlardaki "{kurum}" (kurum başlığı) alanı otomatik doldurulsun -
    // bu SADECE gönderici başlığıdır (zaten her giden SMS'in üzerinde
    // görünür), gizli bir kimlik bilgisi değildir, bu yüzden bu genel uca
    // eklenmesi güvenlik acisindan sorun teşkil etmez (bkz. yukarıdaki
    // "SIZDIRILMAMALI" notu - o not şifre/apiKey/apiSecret için geçerlidir).
    const senderTitle = value?.activeProvider ? value.providers?.[value.activeProvider]?.senderTitle || '' : ''

    return NextResponse.json({ success: true, data: activeTemplates, senderTitle })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'SMS şablonları alınamadı.' },
      { status: 500 },
    )
  }
}
