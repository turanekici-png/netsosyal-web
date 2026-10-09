import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { userService } from '@/lib/services'
import { hashPassword } from '@/lib/security/password'
import { isValidNewPassword, PASSWORD_POLICY_DESCRIPTION } from '@/lib/security/passwordPolicy'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type PasswordPayload = {
  currentPassword?: string
  newPassword?: string
}

export async function PATCH(request: Request) {
  try {
    const cookieStore = await cookies()
    const userId = parseSessionValue(readSessionCookie(cookieStore))
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({})) as PasswordPayload
    const currentPassword = String(body.currentPassword || '').trim()
    const newPassword = String(body.newPassword || '').trim()

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ success: false, error: 'Mevcut ve yeni şifre zorunludur.' }, { status: 400 })
    }
    if (!isValidNewPassword(newPassword)) {
      return NextResponse.json(
        { success: false, error: `Yeni şifre kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}` },
        { status: 400 },
      )
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ success: false, error: 'Yeni şifre mevcut şifreden farklı olmalıdır.' }, { status: 400 })
    }

    const user = await userService.getById(userId)
    if (!user?.username || !(await userService.authenticate(user.username, currentPassword))) {
      return NextResponse.json({ success: false, error: 'Mevcut şifre hatalı.' }, { status: 400 })
    }

    const passwordHash = await hashPassword(newPassword)
    await withAuditedWrite((tx) => tx.user.update({
      where: { id: BigInt(userId) },
      data: { password: passwordHash, islemtarihi: new Date() },
    }), getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, message: 'Şifreniz başarıyla değiştirildi.' })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Şifre değiştirilemedi.' },
      { status: 500 },
    )
  }
}
