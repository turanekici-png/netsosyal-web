import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import {
  ASSISTANT_PROVIDER_IDS,
  getProviderStatuses,
  saveProviderApiKey,
  setActiveProvider,
  getCustomInstructions,
  saveCustomInstructions,
  getBilgiTabani,
  saveBilgiTabani,
  type AssistantProvider,
} from '@/lib/services/aiAssistant.service'

async function settingsPayload() {
  const [statuses, customInstructions, bilgiTabani] = await Promise.all([getProviderStatuses(), getCustomInstructions(), getBilgiTabani()])
  return { ...statuses, customInstructions, bilgiTabani }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Kullanici istegi (14-15 Eylul 2026, 23.-24. tur): Gemini/OpenAI/DeepSeek/
// Anthropic API anahtarlari GENEL /api/settings/[key] ucundan GEÇMEZ - o uc
// noktanin GET'i hicbir yetki kontrolu yapmiyor (bkz. plan arastirmasi),
// yani anahtar oradan istemciye sizardi. Bu YUZDEN ozel, dar kapsamli bir
// uc nokta: GET SADECE "hangi saglayici aktif / hangilerinde anahtar
// tanimli" bilgisini doner, POST settings.update yetkisi ister, HAM
// ANAHTARLAR asla istemciye geri donmez.
function isValidProvider(value: unknown): value is AssistantProvider {
  return typeof value === 'string' && (ASSISTANT_PROVIDER_IDS as string[]).includes(value)
}

export async function GET() {
  const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
  if (accessDenied) return accessDenied

  return NextResponse.json({ success: true, data: await settingsPayload() })
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
  if (accessDenied) return accessDenied

  const body = await request.json().catch(() => null)

  // 2026-10-15: yapilandirilmis bilgi tabani (terim/kural/ornek/hazir soru)
  // kaydi - serbest metin talimatlardan ve API anahtarlarindan BAGIMSIZ.
  if (body && typeof body.bilgiTabani === 'object' && body.bilgiTabani !== null) {
    await saveBilgiTabani(body.bilgiTabani)
    return NextResponse.json({ success: true, data: await settingsPayload() })
  }

  // Kullanici istegi (15 Eylul 2026, 33. tur): "ben soyle dedigimde sen
  // boyle anla" - saglayici anahtarindan BAGIMSIZ, kendi basina gonderilen
  // ozel talimat kaydi. `customInstructions` alani varsa SADECE bunu isler.
  if (typeof body?.customInstructions === 'string') {
    await saveCustomInstructions(body.customInstructions)
    return NextResponse.json({ success: true, data: await settingsPayload() })
  }

  const provider = body?.provider
  if (!isValidProvider(provider)) {
    return NextResponse.json({ success: false, error: 'Geçersiz sağlayıcı.' }, { status: 400 })
  }

  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
  const makeActive = body?.makeActive !== false // varsayilan: anahtar girilince aktif de yapilir

  if (apiKey) {
    await saveProviderApiKey(provider, apiKey, makeActive)
  } else if (makeActive) {
    // Sadece aktif saglayiciyi degistirme (anahtar zaten daha once girilmis).
    await setActiveProvider(provider)
  } else {
    return NextResponse.json({ success: false, error: 'API anahtarı boş olamaz.' }, { status: 400 })
  }

  return NextResponse.json({ success: true, data: await settingsPayload() })
}
