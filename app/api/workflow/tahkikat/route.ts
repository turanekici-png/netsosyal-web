import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { getAnnotatedTahkikatFiles } from './_lib/files'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-10-08): "mahalle gruplarini tahkikat personeline
// tanimlayalim, bu paketler her ay otomatik degissin, bir tahkikat
// personeli digerinin dosyalarini gormesin - hangi mahalle hangi tahkikat
// görevlisinde ise o mahalle sadece o kullanıcının listesinde görünsün".
// Gercek liste + fiili sahiplik hesabi app/api/workflow/tahkikat/_lib/
// files.ts'te (getAnnotatedTahkikatFiles) - personel sekmesi sayaci (bkz.
// personnel/route.ts) AYNI fonksiyonu kullanir, boylece ikisi birbirini
// tutar.
export async function GET() {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = (permissionsSetting?.value as UserPermissionsById | undefined) ?? {}
    const currentPermissionConfig = permissions[String(sessionUser.id)] ?? null
    const isAdmin = !currentPermissionConfig || currentPermissionConfig.isAdmin === true

    const allRows = await getAnnotatedTahkikatFiles()

    // Admin olmayan (ör. tahkikat1/tahkikat2 hesabi) SADECE kendisine
    // dusen dosyalari gorur - manuel atama veya o ayki paket rotasyonu
    // uzerinden. Admin HER ZAMAN tumunu gorur (+ manuel "Ata" ile istisna
    // tanimlayabilir).
    const visibleRows = isAdmin
      ? allRows
      : allRows.filter((row) => row.effectiveOwnerId === String(sessionUser.id))

    return NextResponse.json({
      success: true,
      data: visibleRows,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Tahkikat dosyalari alinamadi.' },
      { status: 500 },
    )
  }
}
