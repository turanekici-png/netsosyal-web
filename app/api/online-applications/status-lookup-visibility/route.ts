import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'

export const dynamic = 'force-dynamic'

const GENERAL_SETTINGS_KEY = 'general_settings'

type StatusLookupPayload = {
  enabled?: boolean
}

// Kullanici istegi (2026-09-22, 3. tur): "Başvuru Sorgulama" ac/kapa
// anahtarini (bkz. app/online/ApplicationStatusLookupToggle.tsx,
// /onlinebasvuru sayfasindaki ApplicationStatusLookup karti) artik SADECE
// bu ozel yetkiye (online.forms.statusLookup) sahip kullanicilar
// degistirebilir - eskiden genel/paylasimli "/api/settings" POST ucundan
// geciyordu ve genis yetkili "settings.update" istiyordu.
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'online.forms.statusLookup', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json() as StatusLookupPayload
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Geçersiz istek.' },
        { status: 400 },
      )
    }

    // Diger genel ayarlari (kurum adi, telefon, online basvuru metinleri vb.)
    // BOZMAMAK icin once mevcut degeri okuyup sadece bu tek alani degistiriyoruz.
    const current = await settingService.getByKey(GENERAL_SETTINGS_KEY)
    const currentValue = current?.value && typeof current.value === 'object'
      ? current.value as Record<string, unknown>
      : {}
    const merged = { ...currentValue, applicationStatusLookupEnabled: body.enabled }

    await settingService.set(GENERAL_SETTINGS_KEY, merged, 'json')

    return NextResponse.json({ success: true, data: { applicationStatusLookupEnabled: body.enabled } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kaydedilemedi.' },
      { status: 500 },
    )
  }
}
