import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { upsertSetting } from '@/lib/db/upsertSetting'

export const dynamic = 'force-dynamic'

// Kullanici istegi (Eylul 2026): "ekrani buyutunce gorunum bozuluyor - onun
// yerine yazi fontunu buyutelim, Tasarim Modu'nda kullanici yuzdeyle secsin".
// Dosya Yonetimi sayfasindaki TUM metin, ".dy-base-16" taban kurallarina
// (bkz. app/globals.css) eklenen "--dy-fs" CSS degiskeniyle olceklenir; bu
// uc nokta o carpani (0.9 - 1.7 arasi) app_settings tablosunda (bkz.
// app/api/dashboard-layout/route.ts'teki AYNI desen) KULLANICI HESABINA ozel
// saklar - hangi bilgisayardan girilirse girilsin ayni hesap ayni boyutu gorur.
const MIN_SCALE = 0.8
const MAX_SCALE = 1.8
const DEFAULT_SCALE = 1

function settingKeyFor(userId: string) {
  return `documents_text_scale_${userId}`
}

function clampScale(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return DEFAULT_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, num))
}

export async function GET() {
  const accessDenied = await requireApiAccess({ page: '/documents' })
  if (accessDenied) return accessDenied

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })
  }

  try {
    const setting = await prisma.setting.findUnique({ where: { key: settingKeyFor(String(user.id)) } })
    const raw = setting?.value as Record<string, unknown> | null | undefined
    const scale = raw && typeof raw === 'object' && 'scale' in raw ? clampScale(raw.scale) : DEFAULT_SCALE
    return NextResponse.json({ success: true, data: { scale } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Yazi boyutu okunamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ page: '/documents' })
  if (accessDenied) return accessDenied

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || !('scale' in body)) {
    return NextResponse.json({ success: false, error: 'Gecersiz deger.' }, { status: 400 })
  }

  try {
    const scale = clampScale((body as Record<string, unknown>).scale)
    await upsertSetting(settingKeyFor(String(user.id)), { scale })
    return NextResponse.json({ success: true, data: { scale } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Yazi boyutu kaydedilemedi.' },
      { status: 500 },
    )
  }
}
