import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { upsertSetting } from '@/lib/db/upsertSetting'
import { normalizeStartupPage } from '@/lib/constants/startupPages'

export const dynamic = 'force-dynamic'

// Kullanici istegi (Eylul 2026): kisi programi ilk actiginda hangi sayfanin
// acilacagini kendi secer - hesaba ozel (app_settings, dashboard-layout ile
// ayni desen). Herhangi bir AKTIF oturum bu ayari kendi hesabi icin
// degistirebilir (sayfa/islem yetkisi gerektirmez - kendi tercihi).
function keyFor(userId: string) {
  return `user-startup-page_${userId}`
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })
  if (user.status === 0) return NextResponse.json({ success: false, error: 'Kullanici pasif.' }, { status: 403 })

  try {
    const setting = await prisma.setting.findUnique({ where: { key: keyFor(String(user.id)) } })
    const raw = (setting?.value as { path?: unknown } | null | undefined)?.path
    return NextResponse.json({ success: true, data: { path: normalizeStartupPage(raw) } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Okunamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })
  if (user.status === 0) return NextResponse.json({ success: false, error: 'Kullanici pasif.' }, { status: 403 })

  try {
    const body = await request.json().catch(() => ({}))
    const path = normalizeStartupPage((body as { path?: unknown })?.path)
    await upsertSetting(keyFor(String(user.id)), { path })
    return NextResponse.json({ success: true, data: { path } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kaydedilemedi.' },
      { status: 500 },
    )
  }
}
