import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess, requireAdminAccess } from '@/lib/apiAuth'
import { getRotationTrigger, setRotationTriggerConfig, nextTriggerAfter } from '../_lib/autoRotate'

export const dynamic = 'force-dynamic'

// GET - global rotasyon tetikleyicisi (gun 1-31, saat "HH:MM") + bir
// sonraki tetik zamani (bilgi amacli, "sıradaki değişim: ..." gosterimi
// icin). Herhangi bir /workflow/tahkikat erisimi olan kullanici gorebilir.
export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ page: '/workflow/tahkikat' })
    if (accessDenied) return accessDenied

    const trigger = await getRotationTrigger()
    const nextTrigger = nextTriggerAfter(
      trigger.sonTetikTarihi ? new Date(trigger.sonTetikTarihi) : new Date(),
      trigger.gun,
      trigger.saat,
    )

    return NextResponse.json({
      success: true,
      data: { ...trigger, sonrakiTetikTarihi: nextTrigger.toISOString() },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Rotasyon ayarı alınamadı.' },
      { status: 500 },
    )
  }
}

// POST - gun/saat ayarini degistirir (admin only). Kullanici istegi
// (2026-10-08, 6. tur): "dönüşüm için tek tarih ve saat ekleyelim, örneğin
// her ayın 1. günü gibi - o tarih geldiğinde sorumlu kullanıcılar yer
// değiştirsin".
export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireAdminAccess()
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const gun = Number(payload.gun)
    const saat = typeof payload.saat === 'string' ? payload.saat.trim() : ''

    if (!Number.isInteger(gun) || gun < 1 || gun > 31) {
      return NextResponse.json({ success: false, error: 'Gün 1-31 arasında olmalıdır.' }, { status: 400 })
    }
    if (!/^\d{2}:\d{2}$/.test(saat)) {
      return NextResponse.json({ success: false, error: 'Geçerli bir saat girin (SS:DD).' }, { status: 400 })
    }

    await setRotationTriggerConfig(gun, saat)
    const trigger = await getRotationTrigger()

    return NextResponse.json({ success: true, data: trigger })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Rotasyon ayarı kaydedilemedi.' },
      { status: 500 },
    )
  }
}
