import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { settingService } from '@/lib/services/settings.service'
import { runAssistantChat, type AssistantChatMessage } from '@/lib/services/aiAssistant.service'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { hasActionAccess } from '@/lib/services/asistanSql.service'
import { checkRateLimit } from '@/lib/security/rateLimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Kullanici istegi (14 Eylul 2026, 23. tur): Sosyal Asistan sayfasi HERKESE
// acik (bkz. lib/constants/pageAccess.ts /asistan istisnasi) - bu yuzden
// burada sayfa duzeyinde requireApiAccess YOK, sadece OTURUM kontrolu.
// Kullanici istegi (15 Eylul 2026, 40. tur): "rapor alma" ve "veri islemleri"
// AYRI yetkilere bolundu - asistani (sohbeti) FIILEN kullanabilmek icin
// "asistan.report" yetkisi GEREKIR (asagida kontrol edilir); veri
// degistirme araclari ayrica "asistan.write" ister (bkz. aiAssistant.service.ts).
// Tablo bazli erisim ise HER SQL calistirmasinda ayrica (asistanSql.service.ts)
// kullanicinin MEVCUT sayfa/islem yetkisine gore kontrol edilir.
export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  // Maliyet/kotuye kullanim kontrolu - her Gemini cagrisi gercek para
  // maliyeti tasidigi icin kullanici basina makul bir sinir.
  const rateLimit = checkRateLimit(`asistan-chat:${user.id}`, { limit: 30, windowMs: 10 * 60 * 1000 })
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Çok fazla mesaj gönderildi. Lütfen kısa süre sonra tekrar deneyin.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const rawHistory = Array.isArray(body?.history) ? body.history : []

  if (!message) {
    return NextResponse.json({ success: false, error: 'Mesaj boş olamaz.' }, { status: 400 })
  }
  if (message.length > 2000) {
    return NextResponse.json({ success: false, error: 'Mesaj çok uzun (en fazla 2000 karakter).' }, { status: 400 })
  }

  const history: AssistantChatMessage[] = rawHistory
    .filter((item: unknown): item is { role: string; text: string } =>
      !!item && typeof item === 'object' && (item as { role?: unknown }).role !== undefined && typeof (item as { text?: unknown }).text === 'string')
    .map((item: { role: string; text: string }) => ({
      role: item.role === 'model' ? 'model' as const : 'user' as const,
      text: item.text,
    }))
    .slice(-20) // maliyet kontrolu - sadece son birkaç tur gonderilir

  try {
    const permissionSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = permissionSetting?.value as UserPermissionsById | undefined
    const permissionConfig = permissions?.[String(user.id)] ?? null

    if (!hasActionAccess(permissionConfig, 'asistan.report')) {
      return NextResponse.json(
        { success: false, error: 'Sosyal Asistan\'ı kullanma yetkiniz yok. Yöneticinizle görüşün (Ayarlar > Kullanıcı Yetkileri > Sosyal Asistan > "Rapor/Sorgu Alma").' },
        { status: 403 },
      )
    }

    const result = await runAssistantChat(message, history, permissionConfig, String(user.id), request.headers.get('cookie') || '')

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Asistan yanıt veremedi.' },
      { status: 500 },
    )
  }
}
