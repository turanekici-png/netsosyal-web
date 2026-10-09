import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { upsertSetting } from '@/lib/db/upsertSetting'

export const dynamic = 'force-dynamic'

// Kullanici istegi (Eylul 2026): "herkeste farkli cozunurluk var; uygulama
// birinde cok buyuk birinde cok kucuk. Ayarlardan kisi kendi arayuz boyutunu
// secebilsin". Bu carpan (0.85 - 1.30 arasi), KATMAN 0 otomatik olceklemenin
// (bkz. ScaledArea / useViewportScale) ve ELLE kabuk zoom'un (ShellZoomContext)
// USTUNE bir carpan olarak uygulanir:  efektif zoom = otoOlcek * elleZoom * arayuzBoyutu
//
// Tarayiciya ozel elle zoom'dan (localStorage) FARKLI olarak bu ayar KULLANICI
// HESABINA ozeldir - hangi bilgisayardan girilirse girilsin ayni hesap ayni
// arayuz boyutunu gorur. app_settings tablosunda tutulur
// (bkz. app/api/documents/text-scale/route.ts - AYNI desen).

const MIN_SCALE = 0.85
const MAX_SCALE = 1.3
const DEFAULT_SCALE = 1

function settingKeyFor(userId: string) {
  return `user_ui_scale_${userId}`
}

function clampScale(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return DEFAULT_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(num * 100) / 100))
}

export async function GET() {
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
      { success: false, error: error instanceof Error ? error.message : 'Arayuz boyutu okunamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
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
      { success: false, error: error instanceof Error ? error.message : 'Arayuz boyutu kaydedilemedi.' },
      { status: 500 },
    )
  }
}
