import { NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { settingService, userService } from '@/lib/services'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { ekipHesabiMi, ekipUyeleriniGetir, ekipUyeleriniKaydet, type EkipUyeleri } from '@/lib/auth/tahkikatEkip'
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
    if (!/^\d+$/.test(String(id))) {
      return NextResponse.json({ success: false, error: 'Geçersiz kullanıcı.' }, { status: 400 })
    }

    // 2026-10-15 kullanici istegi: "kullanici silebilelim". Guvenlik:
    // (1) kisi kendini silemez, (2) tablolarin cogu (dosyalar, yrd_*, ...)
    // kullaniciid'yi FK OLMADAN tutuyor - islem yapmis bir kullanici
    // silinirse gecmis kayitlarda "kim yapti" bilgisi kaybolur. Bu yuzden
    // SADECE hic islem kaydi olmayan hesap silinir; olan icin "Pasif yap"
    // onerilir (pasif kullanici giris yapamaz, gecmisi korunur).
    const sessionUser = await getSessionUser()
    if (sessionUser && String(sessionUser.id) === String(id)) {
      return NextResponse.json({ success: false, error: 'Kendi hesabınızı silemezsiniz.' }, { status: 400 })
    }

    // Sistem/paylasilan hesaplar: yonetici, Hizli Satis kasa hesaplari
    // (satislar AYRI sistemde kullanici adiyla tutulur - NetSosyal
    // tablolarinda kayit gorunmez) ve sabit tahkikat ekip hesaplari.
    const hedef = await userService.getById(String(id))
    if (!hedef) {
      return NextResponse.json({ success: false, error: 'Kullanıcı bulunamadı.' }, { status: 404 })
    }
    const yetkiAyari = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const hedefYetki = (yetkiAyari?.value as UserPermissionsById | undefined)?.[String(id)] ?? null
    // Bos allowedPages "her yere erisir" sayildigi icin hasHizliSatisAccess
    // burada kullanilmaz - SADECE acikca verilmis Hizli Satis/Muhasebe yetkisi.
    const acikKasaYetkisi = (hedefYetki?.allowedPages ?? []).some((p) => /^\/(hizli-satis|muhasebe|satis)(\/|$)/.test(p))
    const korumaSebebi =
      hedefYetki?.isAdmin === true ? 'tam yetkili (yönetici) bir hesap'
        : ekipHesabiMi(hedef.username) ? 'sabit tahkikat ekip hesabı'
          : /^(kasa\d*|cari|muhasebe)$/i.test(hedef.username || '') || acikKasaYetkisi ? 'Hızlı Satış / kasa hesabı'
            : null
    if (korumaSebebi) {
      return NextResponse.json(
        { success: false, error: `Bu ${korumaSebebi} olduğu için silinemez. Gerekirse Düzenle'den Pasif yapın.`, code: 'PROTECTED' },
        { status: 409 },
      )
    }

    const kullanim = await kullaniciKayitlariniBul(String(id))
    if (kullanim.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Bu kullanıcının geçmiş işlem kayıtları var (${kullanim.slice(0, 4).join(', ')}${kullanim.length > 4 ? '...' : ''}). Kayıtların "kim yaptı" bilgisi bozulmasın diye silinemez - bunun yerine Düzenle'den durumunu Pasif yapın; pasif kullanıcı giriş yapamaz.`,
          code: 'HAS_RECORDS',
        },
        { status: 409 },
      )
    }

    try {
      await withAuditedWrite(
        (tx) => userService.delete(id, tx),
        getAuditMetaFromRequest(request),
      )
    } catch (error) {
      // Kurum ici mesajlar gibi FK'li tablolar (RESTRICT) - mesaj gecmisi var.
      if (/foreign key|violates|P2003/i.test(String((error as Error).message))) {
        return NextResponse.json(
          { success: false, error: 'Bu kullanıcının kurum içi mesaj geçmişi var, silinemez. Bunun yerine Pasif yapın.', code: 'HAS_RECORDS' },
          { status: 409 },
        )
      }
      throw error
    }

    // Artik var olmayan kullanicinin yetki ayari ve tahkikat ekip uyeligi
    // temizlenir (basarisiz olsa da silme gecerlidir).
    await yetkiVeEkipKayitlariniTemizle(String(id)).catch(() => {})

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

// Kullaniciya isaret eden (FK'siz) kolonlarda en az bir kayit olan
// tablolarin adlarini dondurur. Her tablo icin EXISTS - ilk eslesmede durur.
async function kullaniciKayitlariniBul(userId: string): Promise<string[]> {
  const kolonlar = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
    `
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
        AND c.column_name IN ('kullaniciid', 'ilkkullaniciid', 'kullanici_id')
        AND c.table_name NOT IN ('kullanicilar', 'app_kullanici_yetkileri')
      ORDER BY c.table_name
    `,
  )

  const bulunan = new Set<string>()
  for (const { table_name: tablo, column_name: kolon } of kolonlar) {
    if (bulunan.has(tablo)) continue
    const sonuc = await prisma.$queryRawUnsafe<Array<{ var: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM public."${tablo.replace(/"/g, '')}" WHERE "${kolon.replace(/"/g, '')}"::text = $1) AS var`,
      userId,
    )
    if (sonuc[0]?.var) bulunan.add(tablo)
  }
  return [...bulunan]
}

async function yetkiVeEkipKayitlariniTemizle(userId: string) {
  const yetkiAyari = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
  const yetkiler = yetkiAyari?.value as Record<string, unknown> | undefined
  if (yetkiler && typeof yetkiler === 'object' && userId in yetkiler) {
    const { [userId]: _silinen, ...kalan } = yetkiler
    void _silinen
    await settingService.set(USER_PERMISSIONS_SETTING_KEY, kalan, 'json')
  }

  const ekipler = await ekipUyeleriniGetir()
  let degisti = false
  const yeni: EkipUyeleri = {}
  for (const [ekipId, uyeler] of Object.entries(ekipler)) {
    if (ekipId === userId) { degisti = true; continue }
    const temiz = uyeler.filter((u) => u !== userId)
    if (temiz.length !== uyeler.length) degisti = true
    if (temiz.length > 0) yeni[ekipId] = temiz
  }
  if (degisti) await ekipUyeleriniKaydet(yeni)
}
