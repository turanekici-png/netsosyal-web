import { NextResponse } from 'next/server'
import { requireApiAccess, getSessionUser } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { upsertSetting } from '@/lib/db/upsertSetting'

export const dynamic = 'force-dynamic'

// Kullanici istegi (29 Agustos 2026): Dosya Yonetimi'nde "Hızlı İşlemler"
// paneli - her kullanici en cok kullandigi dosya islemi butonlarini
// buraya ekleyip oradan kullanir. Secim HER KULLANICI HESABINA OZEL
// app_settings tablosunda saklanir (dashboard-layout ile ayni desen).
function keyFor(userId: string) {
  return `documents-quick-actions_${userId}`
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((v) => String(v ?? '').trim())
        // Dosya islemi kisayollari: "belgeler" gibi. Sayfa kisayollari
        // (kullanici istegi, Eylul 2026): "nav:/assistance/nakit/muracaatlar"
        // gibi - "nav:" + guvenli bir uygulama-ici yol.
        .filter((v) => /^[a-z0-9-]{1,40}$/.test(v) || /^nav:\/[a-z0-9/-]{1,120}$/.test(v)),
    ),
  ).slice(0, 30)
}

export async function GET() {
  const accessDenied = await requireApiAccess({ page: '/documents' })
  if (accessDenied) return accessDenied

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })

  try {
    const setting = await prisma.setting.findUnique({ where: { key: keyFor(String(user.id)) } })
    const raw = setting?.value as { ids?: unknown } | null | undefined
    return NextResponse.json({ success: true, data: { ids: normalizeIds(raw?.ids) } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Okunamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ page: '/documents' })
  if (accessDenied) return accessDenied

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ success: false, error: 'Oturum bulunamadi.' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const ids = normalizeIds((body as { ids?: unknown })?.ids)
    await upsertSetting(keyFor(String(user.id)), { ids })
    return NextResponse.json({ success: true, data: { ids } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kaydedilemedi.' },
      { status: 500 },
    )
  }
}
