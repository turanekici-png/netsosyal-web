import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { databaseBackupService } from '@/lib/services/databaseBackup.service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

databaseBackupService.startScheduler()

export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    databaseBackupService.startScheduler()
    const [settings, backups, databaseOptions] = await Promise.all([
      databaseBackupService.getSettings(),
      databaseBackupService.listBackups(),
      databaseBackupService.listDatabaseOptions(),
    ])

    return NextResponse.json({
      success: true,
      data: { settings, backups, databaseOptions },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    databaseBackupService.startScheduler()
    const body = await request.json()
    const action = String(body.action || '')

    if (action === 'save-settings') {
      const settings = await databaseBackupService.saveSettings(body.settings || {})
      const [backups, databaseOptions] = await Promise.all([
        databaseBackupService.listBackups(),
        databaseBackupService.listDatabaseOptions(),
      ])

      return NextResponse.json({
        success: true,
        data: { settings, backups, databaseOptions },
        message: 'Veritabani yedekleme ayarlari kaydedildi.',
      })
    }

    if (action === 'backup-now') {
      const backupsCreated = await databaseBackupService.createBackups()
      const [settings, backups, databaseOptions] = await Promise.all([
        databaseBackupService.getSettings(),
        databaseBackupService.listBackups(),
        databaseBackupService.listDatabaseOptions(),
      ])

      return NextResponse.json({
        success: true,
        data: { settings, backups, databaseOptions, backupsCreated },
        message: 'Secili veritabanlarinin yedegi alindi.',
      })
    }

    if (action === 'restore') {
      const fileName = String(body.fileName || '')
      if (!fileName) {
        return NextResponse.json(
          { success: false, error: 'Geri yuklenecek yedek dosyasi zorunludur.' },
          { status: 400 }
        )
      }

      const restored = await databaseBackupService.restoreBackup(fileName)
      const [settings, backups, databaseOptions] = await Promise.all([
        databaseBackupService.getSettings(),
        databaseBackupService.listBackups(),
        databaseBackupService.listDatabaseOptions(),
      ])

      return NextResponse.json({
        success: true,
        data: { settings, backups, databaseOptions, restored },
        message: 'Veritabani yedegi geri yuklendi.',
      })
    }

    return NextResponse.json(
      { success: false, error: 'Gecersiz islem.' },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
