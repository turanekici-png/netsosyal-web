import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import {
  ONLINE_APPLICATION_AUTO_CRITERIA_SETTING_KEY,
  normalizeOnlineApplicationAutoCriteria,
  type OnlineApplicationAutoCriteria,
} from '@/lib/constants/onlineApplicationForms'
import { settingService } from '@/lib/services'

export const dynamic = 'force-dynamic'

type SaveCriteriaPayload = {
  criteria?: Partial<OnlineApplicationAutoCriteria>
}

// Kullanici istegi (2026-09-22, 3. tur): "bu işlemler için hangi kullanıcıya
// yetki verilmiş ise o işlem yapabilsin" - Otomatik Eleme Kriterleri'ni
// KAYDETME islemi eskiden genel/paylasimli "/api/settings" POST ucundan
// (bkz. app/api/settings/route.ts) geciyordu - o uc "settings.update" (genis
// yetkili Sistem Ayarlari) yetkisi ISTIYOR, ama bu kriterlerin UYGULANMASI
// (/api/online-applications/apply-criteria) zaten DAHA DAR/OZEL bir yetki
// olan "online.forms.criteria" kullaniyordu - bu TUTARSIZLIK yuzunden SADECE
// online.forms.criteria yetkisi olan (ama settings.update olmayan) bir
// kullanici kriterleri degistirip KAYDEDEMIYORDU. Bu ayri/ozel uc nokta,
// KAYDETME islemini de AYNI (online.forms.criteria) yetkiyle kontrol eder.
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'online.forms.criteria', page: '/online' })
    if (accessDenied) return accessDenied

    const body = await request.json() as SaveCriteriaPayload
    const nextCriteria = normalizeOnlineApplicationAutoCriteria(body.criteria)

    if (nextCriteria.minAgeEnabled && nextCriteria.maxAgeEnabled && nextCriteria.minAge > nextCriteria.maxAge) {
      return NextResponse.json(
        { success: false, error: 'Yaş alt sınırı, yaş üst sınırından büyük olamaz.' },
        { status: 400 },
      )
    }

    await settingService.set(ONLINE_APPLICATION_AUTO_CRITERIA_SETTING_KEY, nextCriteria, 'json')

    return NextResponse.json({ success: true, data: nextCriteria })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kriterler kaydedilemedi.' },
      { status: 500 },
    )
  }
}
