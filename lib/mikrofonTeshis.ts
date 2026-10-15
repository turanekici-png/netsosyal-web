'use client'

// 2026-10-15 kullanici sikayeti: "web'de mikrofonu kullanmak istedigimizde
// 'Mikrofon izni verilmedi' uyarisi geliyor". Sunucu basliklari dogru
// (Permissions-Policy: microphone=(self)); 'not-allowed' hatasi tarayicinin
// ya da Windows'un engelinden gelir ve nedeni farklidir. Bu yardimci, hata
// ALINDIKTAN SONRA (dinleme baslamadan once mikrofonu mesgul etmemek icin)
// nedeni teshis edip kullaniciya dogru talimati verir.

const localhostMu = () => ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

export async function mikrofonHataMesaji(): Promise<string> {
  if (typeof window === 'undefined') return 'Mikrofon kullanılamıyor.'

  if (!window.isSecureContext && !localhostMu()) {
    return `Mikrofon yalnızca güvenli (HTTPS) adreste çalışır. Lütfen https://netsosyal.sivas.bel.tr adresinden girin (şu anki adres: ${window.location.origin}).`
  }

  // 1) Site izni tarayicida "Engelle" olarak kaydedilmis mi?
  let izinDurumu = ''
  try {
    const sonuc = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
    izinDurumu = sonuc?.state ?? ''
  } catch { /* bazi tarayicilar desteklemez */ }

  if (izinDurumu === 'denied') {
    return `Bu site (${window.location.host}) için mikrofon tarayıcıda ENGELLENMİŞ. Adres çubuğunun solundaki simgeye (kilit / ayar) tıklayın → Mikrofon → "İzin ver" seçin, ardından sayfayı yenileyin.`
  }

  // 2) Mikrofonu kisa sureligine acip kesin nedeni ogren (hemen kapatilir)
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Bu tarayıcı mikrofona erişim vermiyor. Güncel Chrome veya Edge kullanın.'
  }
  try {
    const akis = await navigator.mediaDevices.getUserMedia({ audio: true })
    akis.getTracks().forEach((iz) => iz.stop())
    return 'Mikrofon izni şimdi verildi. Mikrofon düğmesine tekrar basın.'
  } catch (hata) {
    const ad = (hata as { name?: string })?.name || ''
    const mesaj = String((hata as { message?: string })?.message || '')
    if (ad === 'NotFoundError' || ad === 'DevicesNotFoundError') {
      return 'Bu bilgisayarda mikrofon bulunamadı. Mikrofonun takılı olduğunu ve Windows Ses ayarlarında (Ayarlar → Sistem → Ses → Giriş) etkin olduğunu kontrol edin.'
    }
    if (ad === 'NotReadableError' || ad === 'TrackStartError') {
      return 'Mikrofon başka bir program tarafından kullanılıyor (Zoom, Teams, WhatsApp vb.). O programı kapatıp tekrar deneyin.'
    }
    if (ad === 'NotAllowedError') {
      if (/system/i.test(mesaj) || izinDurumu === 'granted') {
        return 'Mikrofon Windows tarafından engelleniyor. Windows Ayarlar → Gizlilik ve güvenlik → Mikrofon: "Mikrofon erişimi" ve "Masaüstü uygulamalarının mikrofonunuza erişmesine izin verin" AÇIK olmalı. Sonra tarayıcıyı kapatıp açın.'
      }
      return `Mikrofon izni verilmedi. Adres çubuğunun solundaki simgeye (kilit / ayar) tıklayın → Mikrofon → "İzin ver" seçin ve sayfayı yenileyin (${window.location.host}).`
    }
    return `Mikrofon açılamadı${ad ? ` (${ad})` : ''}. Sayfayı yenileyip tekrar deneyin.`
  }
}
