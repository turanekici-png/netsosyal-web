import { NextResponse } from 'next/server'
import { userService } from '@/lib/services'
import { checkRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'
import { withAuditedWrite, getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'
import { sendWhatsappMessage } from '@/lib/services/whatsappWeb.service'
import { logWhatsappSend } from '@/lib/services/whatsappLog.service'

export const dynamic = 'force-dynamic'

type ForgotPasswordPayload = {
  username?: string
}

// Hesap var/yok, telefon tanımlı/değil, WhatsApp gönderimi başarılı/
// başarısız - HER DURUMDA istemciye AYNI genel mesaj dönülür. Farklı
// mesajlar (ör. "kullanıcı bulunamadı") kullanıcı adı/telefon varlığını
// dışarıya sızdırır (enumeration) - bilinçli olarak tek, belirsiz mesaj.
const GENERIC_MESSAGE =
  'Bu kullanıcı adına sistemde kayıtlı bir WhatsApp numarası varsa, geçici şifreniz o numaraya gönderildi. ' +
  'Birkaç dakika içinde ulaşmazsa sistem yöneticinizle iletişime geçin.'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as ForgotPasswordPayload
    const username = String(body.username || '').trim()

    if (!username) {
      return NextResponse.json({ success: false, error: 'Kullanıcı adı zorunludur.' }, { status: 400 })
    }

    // Rate limit, kullanıcı adı METNİNE göre - var/yok kontrolünden ÖNCE,
    // login/route.ts'teki desenle birebir aynı mantıkla uygulanır ki 429
    // yanıtı bile hesabın var olup olmadığını sızdırmasın.
    const clientKey = `forgot-password:${getRequestClientKey(request)}:${username.toLocaleLowerCase('tr-TR')}`
    const accountKey = `forgot-password-account:${username.toLocaleLowerCase('tr-TR')}`
    const clientRateLimit = checkRateLimit(clientKey, { limit: 5, windowMs: 15 * 60 * 1000 })
    // Aynı hesabın telefonuna FARKLI IP'lerden bile olsa çok sık WhatsApp
    // mesajı gitmesin diye (spam/rahatsızlık + gereksiz geçici şifre
    // israfı) saatte en fazla 3 sıfırlama isteği kabul edilir.
    const accountRateLimit = checkRateLimit(accountKey, { limit: 3, windowMs: 60 * 60 * 1000 })
    if (!clientRateLimit.allowed || !accountRateLimit.allowed) {
      const retryAfterSeconds = Math.max(clientRateLimit.retryAfterSeconds, accountRateLimit.retryAfterSeconds)
      return NextResponse.json(
        { success: false, error: 'Çok fazla deneme yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      )
    }

    const user = await userService.findByUsername(username)
    const phone = user ? normalizeWhatsappPhoneNumber(user.phone) : null

    // Şifre SADECE gönderebileceğimiz geçerli bir telefon numarası varsa
    // sıfırlanır - önce sıfırlayıp WhatsApp gönderimi başarısız/telefon
    // yok diye kullanıcıyı hem eski hem yeni şifresiz bırakmamak için bu
    // sıra bilinçli (telefon kontrolü ÖNCE, sıfırlama SONRA).
    if (user && phone) {
      try {
        const temporaryPassword = await withAuditedWrite(
          (tx) => userService.resetPassword(user.id, tx),
          getAuditMetaFromRequest(request),
        )

        const message = [
          'Sosyal Yardım Yönetim Sistemi - Şifre Sıfırlama',
          '',
          `Merhaba ${user.name || user.username},`,
          '',
          `Geçici şifreniz: ${temporaryPassword}`,
          '',
          'Bu şifreyle giriş yaptıktan sonra sistem sizden yeni bir şifre belirlemenizi isteyecektir.',
          'Bu talebi siz yapmadıysanız lütfen sistem yöneticinizle iletişime geçin.',
        ].join('\n')

        const result = await sendWhatsappMessage(phone, message)
        // await: log satırı DB'ye yazılmadan istek bitip kaçırılmasın diye
        // (bkz. whatsappNotify.service.ts'teki aynı desen).
        await logWhatsappSend({
          telefon: phone,
          adisoyadi: user.name || null,
          mesaj: message,
          durum: result.ok ? 'gönderildi' : 'hata',
          cevap: result.ok ? null : (result.error || 'Bilinmeyen hata'),
          waMessageId: result.ok ? (result.messageId || null) : null,
          gonderimTipi: 'otomatik-bildirim',
          kullanici: 'Sistem (Şifremi Unuttum)',
        })

        if (!result.ok) {
          console.warn(
            `[sifremi-unuttum] Kullanici "${username}" (id=${user.id}) icin gecici sifre olusturuldu ama WhatsApp gonderimi basarisiz oldu: ${result.error}`,
          )
        }
      } catch (innerError) {
        console.error('Sifremi unuttum - sifre sifirlama/gonderim hatasi:', innerError)
      }
    } else if (user && !phone) {
      console.warn(
        `[sifremi-unuttum] Kullanici "${username}" (id=${user.id}) icin sistemde gecerli bir telefon numarasi kayitli degil - sifre sifirlanmadi.`,
      )
    }

    return NextResponse.json({ success: true, message: GENERIC_MESSAGE })
  } catch (error) {
    // Oturumsuz/herkese acik bu uc noktada ham hata mesaji istemciye
    // DONMEZ - sadece sunucu loguna yazilir (login/route.ts ile ayni ilke).
    console.error('Sifremi unuttum hatasi:', error)
    return NextResponse.json(
      { success: false, error: 'İşlem gerçekleştirilemedi.' },
      { status: 500 },
    )
  }
}
