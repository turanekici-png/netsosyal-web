import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { userService } from '@/lib/services'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'
import { sendSmsMessage } from '@/lib/services/smsProvider.service'
import { maskPhone } from '@/lib/auth/remoteLoginOtp'
import { prisma } from '@/lib/db/prisma'

export const dynamic = "force-dynamic"

type Params = {
  id: string
}

// GET user by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'users.manage', page: '/users' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const user = await userService.getById(id)

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Kullanıcı bulunamadı' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: user })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// UPDATE user
export async function PUT(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'users.manage', page: '/users' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const body = await request.json()
    const user = await withAuditedWrite(
      (tx) => userService.update(id, body, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({ success: true, data: user })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// RESET user password to a one-time, randomly generated temporary password.
// delivery: 'show'  -> gecici sifre yanitta doner (admin ekranda gorur) [varsayilan]
// delivery: 'sms'   -> gecici sifre SADECE kullanicinin kayitli cep telefonuna
//                      SMS ile gonderilir; yanitta DONMEZ (admin goremez).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'users.manage', page: '/users' })
    if (accessDenied) return accessDenied

    const { id } = await params
    const user = await userService.getById(id)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Kullanıcı bulunamadı.' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({})) as { delivery?: string }
    const viaSms = body.delivery === 'sms'

    const userName = user.name || user.username || 'Kullanıcı'
    const phone = viaSms ? normalizeWhatsappPhoneNumber(user.phone || '') : null

    if (viaSms && !phone) {
      return NextResponse.json(
        { success: false, error: 'Bu kullanıcının sisteme kayıtlı geçerli bir cep telefonu numarası yok. Önce "Düzenle" ile telefon numarasını kaydedin.' },
        { status: 400 },
      )
    }

    const temporaryPassword = await withAuditedWrite(
      (tx) => userService.resetPassword(id, tx),
      getAuditMetaFromRequest(request),
    )

    if (viaSms && phone) {
      const message = `Sosyal Yardim Yonetim Sistemi - gecici sifreniz: ${temporaryPassword} . Bu sifre ile giris yaptiktan sonra sistem yeni bir sifre belirlemenizi isteyecektir.`
      const smsResult = await sendSmsMessage(phone, message)

      await prisma.sms_gonderim_log.create({
        data: {
          telefon: phone,
          adisoyadi: user.name || null,
          mesaj: message,
          durum: smsResult.ok ? 'gönderildi' : 'hata',
          cevap: smsResult.ok ? null : (smsResult.error || smsResult.raw || 'Bilinmeyen hata'),
          sms_tipi: 'otomatik',
          kanal: 'sms',
          kullanici: 'Sistem (Yönetici Şifre Sıfırlama)',
        },
      }).catch(() => { /* loglama best-effort */ })

      if (!smsResult.ok) {
        // Sifre ZATEN sifirlandi ama SMS gitmedi - admin sifreyi bilmiyor,
        // kullanici da alamadi. Admin tekrar denemeli (yeni sifre uretilir).
        return NextResponse.json(
          {
            success: false,
            error: `Yeni geçici şifre oluşturuldu ancak SMS gönderilemedi (${smsResult.error || 'SMS servisi yanıt vermiyor'}). Lütfen tekrar deneyin.`,
          },
          { status: 502 },
        )
      }

      return NextResponse.json({
        success: true,
        message: `${userName} için yeni geçici şifre, kayıtlı telefon numarasına (${maskPhone(phone)}) SMS ile gönderildi.`,
        phoneHint: maskPhone(phone),
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Kullanici sifresi gecici bir sifreyle sifirlandi.',
      temporaryPassword,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Şifre sıfırlanamadı.' },
      { status: 500 }
    )
  }
}

// DELETE user
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  try {
    const accessDenied = await requireApiAccess({ action: 'users.manage', page: '/users' })
    if (accessDenied) return accessDenied

    const { id } = await params
    await withAuditedWrite(
      (tx) => userService.delete(id, tx),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      message: 'Kullanıcı silindi',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}
