import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { settingService } from '@/lib/services/settings.service'
import { resolveDosyaLocator } from '@/lib/services/aiAssistant.service'
import { hasActionAccess } from '@/lib/services/asistanSql.service'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/security/requestBody'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Kullanici istegi (2026-09-21): "Yeni Pencerede Ac" ile acilan Sosyal
// Asistan rapor penceresinde, listedeki bir satira cift tiklayinca ilgili
// dosyanin icine girebilmek icin - rapor tablosundaki "dosyano"/"dosyaid"
// gibi bir sutunun degerini GERCEK dosyalar.id'ye cevirir. Ayni
// yetki+sorgu mantigi asistanin kendi "open_dosya" aracinda zaten var
// (bkz. resolveDosyaLocator icindeki checkTablePermissions), burada
// TEKRARLANMADAN aynen kullaniliyor.
type ResolvePayload = { dosyano?: string; fileId?: string | number }

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const permissionSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = permissionSetting?.value as UserPermissionsById | undefined
    const permissionConfig = permissions?.[String(user.id)] ?? null

    if (!hasActionAccess(permissionConfig, 'asistan.report')) {
      return NextResponse.json({ success: false, error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })
    }

    const payload = await readLimitedJson<ResolvePayload>(request, 4096)
    const dosyano = typeof payload.dosyano === 'string' ? payload.dosyano : undefined
    const fileId = typeof payload.fileId === 'string' || typeof payload.fileId === 'number' ? payload.fileId : undefined

    const result = await resolveDosyaLocator({ dosyano, fileId }, permissionConfig)
    if ('error' in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { fileId: result.fileId, fileNo: result.fileNo } })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 413 })
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Dosya bulunamadı.' },
      { status: 500 },
    )
  }
}
