'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { isValidNewPassword, PASSWORD_POLICY_DESCRIPTION } from '@/lib/security/passwordPolicy'
import { InstallAppButton } from '@/components/pwa/InstallAppButton'

// "Beni Hatirla" SADECE kullanici adini localStorage'da saklar - SIFRE
// KESINLIKLE kaydedilmiyor/geri yuklenmiyor, kullanici her girişte sifreyi
// elle yazmak zorunda kalir (guvenlik geregi bilincli bir tercih).
const REMEMBERED_USERNAME_KEY = 'netsosyal:login:remembered-username'

export default function LoginPage() {
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)

  // Şifre alanlarında Caps Lock (büyük harf kilidi) açıksa kullanıcıyı uyar -
  // "şifrem doğru ama giremiyorum" vakalarının en yaygın sebebi. Şifre
  // BÜYÜK/küçük harf duyarlıdır (güvenlik gereği öyle kalır), sadece
  // kullanıcı durumu görsün diye görsel bir uyarı.
  const [capsLockOn, setCapsLockOn] = useState(false)
  const handleCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    try {
      setCapsLockOn(event.getModifierState('CapsLock'))
    } catch {
      // getModifierState desteklenmiyorsa sessizce yoksay
    }
  }
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Kullanici istegi: cok fazla basarisiz giris denemesinde devreye giren
  // kilitlenme suresi artik 1 dakika (bkz. app/api/auth/login/route.ts) -
  // bu sure boyunca kullanici adi/sifre alanlari ve Giriş Yap butonu
  // devre disi birakilip, saniye saniye azalan bir geri sayim gosterilir;
  // sure dolunca form otomatik olarak tekrar kullanilabilir hale gelir.
  const [lockoutSeconds, setLockoutSeconds] = useState<number | null>(null)

  useEffect(() => {
    if (lockoutSeconds === null) return
    if (lockoutSeconds <= 0) {
      setLockoutSeconds(null)
      setStatus('')
      return
    }
    const timer = window.setTimeout(() => {
      setLockoutSeconds((current) => (current === null ? null : current - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [lockoutSeconds])

  const isLockedOut = lockoutSeconds !== null && lockoutSeconds > 0

  // "123" ile (bilinen tek zayif/varsayilan sifre) basariyla giris
  // denendiginde login API'si oturum acmadan ONCE bunu true dondurur - form
  // asagida "Yeni Şifre Belirleyin" adimina geçer, oturum ancak sifre
  // GERCEKTEN degistirildiginde acilir (bkz. change-password/route.ts).
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')

  // Uzaktan / mobil giriş: sunucu şifre doğruysa oturum açmadan önce
  // kullanıcının kayıtlı cep telefonuna SMS ile 6 haneli kod gönderir (SADECE
  // uzaktan/dış girişlerde - yerel ağdan mobil de olsa sorulmaz). Telefonu
  // yoksa uzaktan giriş engellenir.
  // (bkz. app/api/auth/login/route.ts + verify-otp/route.ts). Kod bu ekranda
  // girilir; doğrulanınca oturum açılır.
  const [otpRequired, setOtpRequired] = useState(false)
  const [otpUserId, setOtpUserId] = useState<string | null>(null)
  const [otpTicket, setOtpTicket] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [otpPhoneHint, setOtpPhoneHint] = useState<string | null>(null)
  const [otpResendInfo, setOtpResendInfo] = useState('')

  // "Şifremi Unuttum" akışı: kullanıcı adını girer, sunucu (varsa) kayıtlı
  // WhatsApp numarasına tek kullanımlık geçici bir şifre gönderir - bkz.
  // app/api/auth/forgot-password/route.ts. Hesap var/yok, telefon tanımlı/
  // değil AYRIMI hiçbir zaman istemciye yansıtılmaz (bkz. o dosyadaki not),
  // bu yüzden burada da tek bir genel durum mesajı gösterilir.
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotUsername, setForgotUsername] = useState('')
  const [forgotStatus, setForgotStatus] = useState('')
  const [forgotSubmitting, setForgotSubmitting] = useState(false)
  const [forgotSubmitted, setForgotSubmitted] = useState(false)

  // Oturum hareketsizlik (180 dk) zaman asimi veya mutlak sure dolmasi
  // nedeniyle /login'e yonlendirilmisse kullaniciya nazik bir bilgi goster
  // (bkz. components/layout/IdleLogout.tsx).
  const sessionNotice = searchParams.get('timeout')
    ? '3 saat işlem yapılmadığı için güvenlik amacıyla oturumunuz kapatıldı. Lütfen tekrar giriş yapın.'
    : searchParams.get('expired')
      ? 'Oturum süreniz doldu. Lütfen tekrar giriş yapın.'
      : ''

  // Sayfa acilir acilmaz, daha once "Beni Hatirla" isaretlenerek kaydedilmis
  // bir kullanici adi varsa geri yukle ve kutucugu isaretli goster.
  useEffect(() => {
    try {
      const savedUsername = window.localStorage.getItem(REMEMBERED_USERNAME_KEY)
      if (savedUsername) {
        setUsername(savedUsername)
        setRememberMe(true)
      }
    } catch {
      // localStorage erisilemez olabilir (gizli sekme vb.) - sessizce yoksay
    }
  }, [])

  // Bu bilgisayarda veritabani/tablolar/ilk kullanici HENUZ olusturulmamissa
  // (bkz. lib/services/provisioning.service.ts) giris formu yerine ilk
  // kurulum ekranina yonlendirir. Mevcut (kurulu, veri dolu) sistemlerde bu
  // kontrol her zaman "ready" doner ve HICBIR SEY DEGISMEZ.
  useEffect(() => {
    let isCancelled = false

    fetch('/api/setup/status', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: { success: boolean; data?: { status: string } }) => {
        if (isCancelled) return
        if (payload.success && payload.data && payload.data.status !== 'ready') {
          window.location.replace('/kurulum')
        }
      })
      .catch(() => {
        // Durum sorgulanamazsa normal giris ekraninda kalinir - sessizce yoksay.
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const rememberUsernameIfNeeded = () => {
    try {
      if (rememberMe) {
        window.localStorage.setItem(REMEMBERED_USERNAME_KEY, username)
      } else {
        window.localStorage.removeItem(REMEMBERED_USERNAME_KEY)
      }
    } catch {
      // localStorage erisilemez olabilir - sessizce yoksay, giris akisini engellemez
    }
  }

  const goToNextPath = () => {
    // Kullanici istegi (14 Eylul 2026, 14. tur): "mobilden giris yaptigimda
    // hala Dosya Yönetimi varsayilan olarak acilmiyor, Yetkisiz Erisim
    // geliyor" - kok neden: bu fonksiyon eskiden "next" parametresi VARSA
    // (ör. "/login?next=%2Fdashboard") dogrudan O SAYFAYA gidiyordu -
    // app/page.tsx'teki dikkatli "Dosya Yönetimi varsayilani + yetki
    // dogrulamali fallback" mantigini TAMAMEN atlayip, kullanicinin o an
    // erisimi olmayan bir sayfaya (ör. eski bir yer imi/cerez'den kalma
    // "next=/dashboard") dogrudan dusurebiliyordu. proxy.ts ARTIK zaten
    // "next" parametresini hic URETMIYOR (bkz. proxy.ts 10. tur notu) -
    // yani bu deger sadece ESKI/yer imine kaydedilmis linklerden gelebilir.
    // Bu yuzden guvenilir tek hedef HER ZAMAN "/" - app/page.tsx zaten
    // doğru sayfayi (kisisel secim varsa VE erisimi varsa o, yoksa Dosya
    // Yönetimi, o da yoksa erisimi olan ilk sayfa) sunucu tarafinda karar verir.
    //
    // İSTİSNA (Ekim 2026): "/satis" - kasiyerlerin dogrudan paylasabilecegi,
    // giris yapinca Satis ekranina goturen kisa adres (bkz. proxy.ts -
    // SADECE bu yol icin, "/" ile AYNI sekilde, oturumsuz ziyaretci acikca
    // /login'e yonlendirilir). Orijinal hatanin nedeni (rastgele bir "next"
    // degerinin, erisim kontrolunu atlayip kullaniciyi yetkisi olmayan bir
    // sayfaya dusurebilmesiydi) burada gecerli DEGIL - sabit, TEK bir deger
    // kabul edilir ve hedef sayfanin kendisi (app/satis/page.tsx) zaten
    // proxy.ts'in KNOWN_INTERNAL_ROUTE_PREFIXES + getPermissionPath
    // eslemesi uzerinden "/muhasebe" yetkisiyle korunuyor - yani bu
    // whitelist rastgele bir yere dusurme riski tasimaz. Eskiden
    // "/hizli-satis" da kabul ediliyordu - kullanici istegiyle KALDIRILDI.
    const nextWhitelist = ['/satis']
    const nextValue = searchParams.get('next')
    if (nextValue && nextWhitelist.includes(nextValue)) {
      window.location.replace(nextValue)
      return
    }
    window.location.replace('/')
  }

  const submitLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('')
    setIsSubmitting(true)
    let isLockoutError = false

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        // Kullanici istegi: kilitlenme durumunda (429) kalan sureyi
        // sunucudan gelen deger uzerinden geri sayima baslat - JSON govdesi
        // (retryAfterSeconds) yoksa Retry-After header'ina geri dusulur.
        // Bu durumda ayrica statik bir hata metni GOSTERILMEZ - asagidaki
        // canli geri sayim kutusu zaten ayni bilgiyi (saniye saniye
        // guncellenerek) verir.
        if (response.status === 429) {
          isLockoutError = true
          const headerSeconds = Number(response.headers.get('Retry-After'))
          const retrySeconds = Number.isFinite(payload.retryAfterSeconds) && payload.retryAfterSeconds > 0
            ? payload.retryAfterSeconds
            : (Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds : 60)
          setLockoutSeconds(retrySeconds)
        }
        throw new Error(payload.error || 'Giris yapilamadi.')
      }

      if (payload.mustChangePassword) {
        setMustChangePassword(true)
        return
      }

      if (payload.otpRequired) {
        setOtpRequired(true)
        setOtpUserId(String(payload.data?.id ?? ''))
        setOtpTicket(payload.otpTicket ?? null)
        setOtpPhoneHint(payload.phoneHint ?? null)
        setOtpCode('')
        setOtpResendInfo('')
        return
      }

      rememberUsernameIfNeeded()
      goToNextPath()
    } catch (error) {
      if (!isLockoutError) {
        setStatus(error instanceof Error ? error.message : 'Giris yapilamadi.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const openForgotPassword = () => {
    setForgotUsername(username)
    setForgotStatus('')
    setForgotSubmitted(false)
    setShowForgotPassword(true)
  }

  const closeForgotPassword = () => {
    setShowForgotPassword(false)
    setForgotStatus('')
    setForgotSubmitted(false)
  }

  const submitForgotPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setForgotStatus('')
    setForgotSubmitting(true)

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'İşlem gerçekleştirilemedi.')
      }

      setForgotStatus(payload.message || 'İşlem tamamlandı.')
      setForgotSubmitted(true)
    } catch (error) {
      setForgotStatus(error instanceof Error ? error.message : 'İşlem gerçekleştirilemedi.')
    } finally {
      setForgotSubmitting(false)
    }
  }

  const submitPasswordChange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('')

    if (newPassword !== confirmNewPassword) {
      setStatus('Yeni şifreler birbiriyle uyuşmuyor.')
      return
    }

    if (!isValidNewPassword(newPassword)) {
      setStatus(`Yeni şifre kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}`)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, currentPassword: password, newPassword }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Şifre değiştirilemedi.')
      }

      if (payload.otpRequired) {
        setMustChangePassword(false)
        setOtpRequired(true)
        setOtpUserId(String(payload.data?.id ?? ''))
        setOtpTicket(payload.otpTicket ?? null)
        setOtpPhoneHint(payload.phoneHint ?? null)
        setOtpCode('')
        setOtpResendInfo('')
        return
      }

      rememberUsernameIfNeeded()
      goToNextPath()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Şifre değiştirilemedi.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('')
    setOtpResendInfo('')
    if (!otpUserId) return
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: otpUserId, code: otpCode.trim(), otpTicket }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kod doğrulanamadı.')
      }
      rememberUsernameIfNeeded()
      goToNextPath()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kod doğrulanamadı.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resendOtp = async () => {
    if (!otpUserId || isSubmitting) return
    setStatus('')
    setOtpResendInfo('')
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: otpUserId, resend: true, otpTicket }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Kod gönderilemedi.')
      }
      if (payload.otpTicket) setOtpTicket(payload.otpTicket)
      if (payload.phoneHint) setOtpPhoneHint(payload.phoneHint)
      setOtpResendInfo(payload.resent ? 'Yeni kod telefonunuza gönderildi.' : 'Kod gönderilemedi. Kayıtlı numaranızı kontrol edin.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kod gönderilemedi.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#003f82] via-[#075b9f] to-[#0f8fb8] px-4 py-8">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
        <div className="bg-[#003f82] px-6 py-6 text-white">
          <p className="text-xs font-black uppercase tracking-wide text-white/70">Sivas Belediyesi</p>
          <h1 className="mt-1 text-2xl font-black leading-tight">Sosyal Yardım Yönetim Sistemi</h1>
        </div>

        {otpRequired ? (
          <form onSubmit={submitOtp} className="space-y-4 px-6 py-6">
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm font-bold text-sky-800">
              Uzaktan giriş doğrulaması. Kayıtlı cep telefonunuza{otpPhoneHint ? ` (${otpPhoneHint})` : ''} SMS ile 6 haneli bir kod gönderildi. Kodu girerek girişi tamamlayın.
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-black uppercase text-slate-500">Doğrulama Kodu</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-center text-lg font-black tracking-[0.4em] text-slate-900 outline-none focus:border-[#0076b6] focus:bg-white"
                required
                autoFocus
              />
            </div>

            {otpResendInfo && (
              <p className="text-[12px] font-semibold text-emerald-700">{otpResendInfo}</p>
            )}
            {status && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-bold text-rose-700">{status}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || otpCode.length !== 6}
              className="w-full rounded-lg bg-[#003f82] px-4 py-2.5 text-sm font-black uppercase text-white transition hover:bg-[#00325f] disabled:opacity-50"
            >
              {isSubmitting ? 'Doğrulanıyor...' : 'Girişi Tamamla'}
            </button>

            <div className="flex items-center justify-between text-[12px] font-bold">
              <button type="button" onClick={resendOtp} disabled={isSubmitting} className="text-[#0076b6] hover:underline disabled:opacity-50">
                Kodu tekrar gönder
              </button>
              <button
                type="button"
                onClick={() => { setOtpRequired(false); setOtpCode(''); setOtpTicket(null); setStatus(''); setPassword('') }}
                className="text-slate-500 hover:underline"
              >
                Geri dön
              </button>
            </div>
          </form>
        ) : mustChangePassword ? (
          <form onSubmit={submitPasswordChange} className="space-y-4 px-6 py-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-800">
              Güvenliğiniz için varsayılan şifrenizi değiştirmeniz gerekiyor. Devam etmeden önce yeni bir şifre belirleyin.
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-black uppercase text-slate-500">Yeni Şifre</label>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                onKeyDown={handleCapsLock}
                onKeyUp={handleCapsLock}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6] focus:bg-white"
                required
                autoFocus
              />
              {capsLockOn && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-bold text-amber-600">
                  <span aria-hidden>⚠</span> Caps Lock açık — şifre büyük/küçük harfe duyarlıdır.
                </p>
              )}
              <p className="mt-1.5 text-[11px] font-semibold leading-snug text-slate-500">{PASSWORD_POLICY_DESCRIPTION}</p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-black uppercase text-slate-500">Yeni Şifre (Tekrar)</label>
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(event) => setConfirmNewPassword(event.target.value)}
                onKeyDown={handleCapsLock}
                onKeyUp={handleCapsLock}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6] focus:bg-white"
                required
              />
            </div>

            {status && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                {status}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-[#6fb744] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#5aa333] disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? 'Kaydediliyor...' : 'Şifreyi Değiştir ve Giriş Yap'}
            </button>
          </form>
        ) : showForgotPassword ? (
          <form onSubmit={submitForgotPassword} className="space-y-4 px-6 py-6">
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm font-bold text-sky-800">
              Kullanıcı adınızı girin, sistemde kayıtlı WhatsApp numaranıza tek kullanımlık geçici bir şifre gönderelim. Bu şifreyle giriş yaptıktan sonra yeni bir şifre belirlemeniz istenecektir.
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-black uppercase text-slate-500">Kullanici Adi</label>
              <input
                value={forgotUsername}
                onChange={(event) => setForgotUsername(event.target.value)}
                autoComplete="username"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6] focus:bg-white disabled:opacity-60"
                required
                autoFocus
                disabled={forgotSubmitted}
              />
            </div>

            {forgotStatus && (
              <div
                className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                  forgotSubmitted
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                {forgotStatus}
              </div>
            )}

            {!forgotSubmitted && (
              <button
                type="submit"
                disabled={forgotSubmitting}
                className="w-full rounded-lg bg-[#6fb744] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#5aa333] disabled:cursor-wait disabled:opacity-60"
              >
                {forgotSubmitting ? 'Gönderiliyor...' : 'Geçici Şifre Gönder'}
              </button>
            )}

            <button
              type="button"
              onClick={closeForgotPassword}
              className="w-full rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              Giriş Ekranına Dön
            </button>
          </form>
        ) : (
          <form onSubmit={submitLogin} className="space-y-4 px-6 py-6">
            {sessionNotice && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-800">
                {sessionNotice}
              </div>
            )}
            {isLockedOut && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-bold text-rose-700">
                Çok fazla başarısız giriş denemesi yapıldı. <span className="tabular-nums">{lockoutSeconds}</span> saniye sonra tekrar deneyebilirsiniz.
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-black uppercase text-slate-500">Kullanici Adi</label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                disabled={isLockedOut}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-black uppercase text-slate-500">Şifre</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={handleCapsLock}
                onKeyUp={handleCapsLock}
                autoComplete="current-password"
                disabled={isLockedOut}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                required
              />
              {capsLockOn && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-bold text-amber-600">
                  <span aria-hidden>⚠</span> Caps Lock (büyük harf kilidi) açık — şifre büyük/küçük harfe duyarlıdır.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <label className="flex select-none items-center gap-2 text-sm font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0076b6] outline-none focus:ring-2 focus:ring-[#0076b6]/30"
                />
                Beni Hatırla
              </label>
              <button
                type="button"
                onClick={openForgotPassword}
                className="text-xs font-bold text-[#0076b6] hover:underline"
              >
                Şifremi Unuttum?
              </button>
            </div>

            {status && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                {status}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || isLockedOut}
              className="w-full rounded-lg bg-[#6fb744] px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-[#5aa333] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLockedOut ? `${lockoutSeconds} saniye bekleyin...` : isSubmitting ? 'Giris yapiliyor...' : 'Giris Yap'}
            </button>
          </form>
        )}

        <div className="border-t border-slate-100 px-6 py-4">
          <InstallAppButton variant="prominent" />
          <p className="mt-2 text-center text-[11px] font-semibold leading-snug text-slate-400">
            Uygulamayı telefonunuza veya bilgisayarınıza ekleyin; her seferinde adres yazmadan simgeyle girin.
          </p>
        </div>
      </div>
    </main>
  )
}
