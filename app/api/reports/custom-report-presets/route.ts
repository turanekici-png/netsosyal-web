import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'
import { CUSTOM_REPORT_PRESETS_SETTING_KEY, type CustomReportPreset } from '@/lib/constants/customReportPresets'

export const dynamic = 'force-dynamic'

async function loadPresets(): Promise<CustomReportPreset[]> {
  const setting = await settingService.getByKey(CUSTOM_REPORT_PRESETS_SETTING_KEY)
  const value = setting?.value as CustomReportPreset[] | undefined
  return Array.isArray(value) ? value : []
}

// GET - "Özel Rapor Oluştur" ekranındaki kayıtlı rapor şablonlarının listesi.
// Tüm kullanıcılar arasında PAYLAŞILIR (Ayarlar sayfasındaki diğer paylaşımlı
// listeler - Yetkili Personel vb. - ile aynı yaklaşım) - bir kullanıcının
// kurduğu faydalı bir rapor tasarımını herkes kullanabilsin diye.
export async function GET() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const presets = await loadPresets()
  return NextResponse.json({ success: true, data: presets })
}

// POST - yeni bir rapor şablonu kaydeder. Gövde: { name, queryString }.
export async function POST(request: Request) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const queryString = typeof body?.queryString === 'string' ? body.queryString : ''

  if (!name) {
    return NextResponse.json({ success: false, error: 'Şablon adı boş olamaz.' }, { status: 400 })
  }

  const presets = await loadPresets()
  const preset: CustomReportPreset = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: new Date().toISOString(),
    createdByUserId: sessionUser.id,
    createdByUserName: sessionUser.name || null,
    queryString,
  }

  const nextPresets = [preset, ...presets]
  await settingService.set(CUSTOM_REPORT_PRESETS_SETTING_KEY, nextPresets, 'json')

  return NextResponse.json({ success: true, data: preset }, { status: 201 })
}

// DELETE - bir rapor şablonunu siler. Gövde: { id }.
export async function DELETE(request: Request) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) {
    return NextResponse.json({ success: false, error: 'Şablon kimliği gerekli.' }, { status: 400 })
  }

  const presets = await loadPresets()
  const nextPresets = presets.filter((preset) => preset.id !== id)
  await settingService.set(CUSTOM_REPORT_PRESETS_SETTING_KEY, nextPresets, 'json')

  return NextResponse.json({ success: true })
}
