'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { isValidNewPassword, PASSWORD_POLICY_DESCRIPTION } from '@/lib/security/passwordPolicy'
import { InstallAppButton } from '@/components/pwa/InstallAppButton'

// "Beni Hatirla" SADECE kullanici adini localStorage'da saklar - SIFRE
// KESINLIKLE kaydedilmiyor/geri yuklenmiyor, kullanici her girişte sifreyi
// elle yazmak zorunda kalir (guvenlik geregi bilincli bir tercih).
const REMEMBERED_USERNAME_KEY = 'netsosyal:login:remembered-username'

// 2026-10-15: kurumsal giris ekrani - ortak siniflar + sayfaya ozel zoom.
const LOGO_SRC = '/sivas-belediyesi-logo.png'
const LOGIN_ZOOM_KEY = 'netsosyal:login:zoom'
const LOGIN_ZOOM_MIN = 0.7
const LOGIN_ZOOM_MAX = 1.5
const LOGIN_ZOOM_STEP = 0.05
const clampLoginZoom = (value: number) => Math.min(LOGIN_ZOOM_MAX, Math.max(LOGIN_ZOOM_MIN, Math.round(value * 100) / 100))

const LABEL = 'mb-2 block text-[12.5px] font-bold uppercase tracking-[0.08em] text-slate-600'
const INPUT = 'h-12 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-[16px] font-semibold text-[#1E2A38] shadow-[inset_0_1px_2px_rgba(16,30,43,0.04)] outline-none transition placeholder:text-slate-400 focus:border-[#1E2A38] focus:ring-4 focus:ring-[#1E2A38]/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60'
const PRIMARY_BUTTON = 'flex h-12 w-full items-center justify-center rounded-lg border-b-[3px] border-b-[#D4B26A] bg-[#1E2A38] px-5 text-[16px] font-bold tracking-wide text-white shadow-[0_6px_16px_rgba(16,30,43,0.22)] transition hover:bg-[#2A3B4D] disabled:cursor-not-allowed disabled:opacity-55'
const SECONDARY_BUTTON = 'flex h-11 w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-5 text-[14.5px] font-bold text-[#1E2A38] transition hover:bg-[#F6F3EA]'
const LINK_BUTTON = 'text-[13.5px] font-bold text-[#1E2A38] underline-offset-4 hover:text-[#8A6D2B] hover:underline disabled:opacity-50'
const ALERT_BASE = 'rounded-lg border-l-4 px-3.5 py-3 text-[14px] font-semibold leading-snug'
const ALERT_INFO = `${ALERT_BASE} border-l-[#1E2A38] bg-[#EEF2F6] text-[#1E2A38]`
const ALERT_WARN = `${ALERT_BASE} border-l-amber-500 bg-amber-50 text-amber-900`
const ALERT_ERROR = `${ALERT_BASE} border-l-rose-500 bg-rose-50 text-rose-800`
const ALERT_SUCCESS = `${ALERT_BASE} border-l-emerald-500 bg-emerald-50 text-emerald-800`
const CAPS_NOTE = 'mt-2 flex items-center gap-1.5 text-[13px] font-bold text-amber-700'

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

  // 2026-10-15 kullanici istegi: giris sayfasinin KENDI yakinlastirmasi -
  // Ctrl + tekerlek / Ctrl +/- ve sag alttaki dugmeler. Uygulama icindeki
  // kabuk zoom'undan AYRI saklanir (orada %68 kullanan biri giris ekranini
  // minicik gormesin). Bkz. ShellZoomContext (/login'de devre disi).
  const [loginZoom, setLoginZoom] = useState(1)
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(LOGIN_ZOOM_KEY))
      if (Number.isFinite(stored) && stored > 0) setLoginZoom(clampLoginZoom(stored))
    } catch {
      // localStorage erisilemez - varsayilan %100
    }
  }, [])
  const changeLoginZoom = (next: number) => {
    const value = clampLoginZoom(next)
    setLoginZoom(value)
    try {
      window.localStorage.setItem(LOGIN_ZOOM_KEY, String(value))
    } catch {
      // yoksay
    }
  }
  const loginZoomRef = useRef(loginZoom)
  useEffect(() => { loginZoomRef.current = loginZoom }, [loginZoom])
  useEffect(() => {
    const apply = (direction: 1 | -1) => {
      const value = clampLoginZoom(loginZoomRef.current + direction * LOGIN_ZOOM_STEP)
      setLoginZoom(value)
      try { window.localStorage.setItem(LOGIN_ZOOM_KEY, String(value)) } catch { /* yoksay */ }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') { event.preventDefault(); apply(1) }
      else if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') { event.preventDefault(); apply(-1) }
      else if (event.key === '0' || event.code === 'Numpad0') {
        event.preventDefault()
        setLoginZoom(1)
        try { window.localStorage.setItem(LOGIN_ZOOM_KEY, '1') } catch { /* yoksay */ }
      }
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      apply(event.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  const [showPassword, setShowPassword] = useState(false)

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#EEF1F4] text-[#1E2A38]">
      <div
        className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
        style={{ zoom: loginZoom, minHeight: `calc(100dvh / ${loginZoom})` }}
      >
        {/* SOL: kurumsal tanitim paneli (yalniz genis ekran) */}
        <section className="relative hidden overflow-hidden bg-[#1E2A38] text-white lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12 xl:px-20">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(212,178,106,0.16),transparent_55%),radial-gradient(90%_70%_at_100%_100%,rgba(14,124,134,0.28),transparent_60%)]" />
          <svg aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[28rem] w-[28rem] text-white/[0.04]" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="1">
            {[90, 75, 60, 45, 30].map((r) => <circle key={r} cx="100" cy="100" r={r} />)}
          </svg>

          <div className="relative flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.25)] ring-2 ring-[#D4B26A]/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO_SRC} alt="Sivas Belediyesi logosu" className="h-full w-full rounded-full object-contain" />
            </span>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-[#D4B26A]">T.C. Sivas Belediyesi</p>
              <p className="mt-0.5 text-[17px] font-semibold text-white/90">Sosyal Hizmetler Müdürlüğü</p>
            </div>
          </div>

          <div className="relative max-w-xl py-10">
            <h1 className="text-[clamp(2rem,3.1vw,3rem)] font-bold leading-[1.12] tracking-tight">
              Sosyal Yardım<br />Yönetim Sistemi
            </h1>
            <div className="mt-6 h-1 w-20 rounded-full bg-[#D4B26A]" />
            <p className="mt-6 text-[17px] font-medium leading-relaxed text-white/75">
              Müracaat, hane, yardım ve iş akışı süreçlerinin tek merkezden, kayıt altında ve güvenle yürütüldüğü kurumsal yönetim platformu.
            </p>
            <ul className="mt-8 space-y-3.5">
              {[
                'Dosya, hane ve birey kayıtları',
                'Yardım, ödeme ve iş akışı takibi',
                'Yetkiye dayalı, kayıt altında erişim',
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-[16px] font-semibold text-white/90">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#D4B26A]/50 bg-[#D4B26A]/15 text-[#D4B26A]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-[13px] font-medium text-white/50">
            © {new Date().getFullYear()} Sivas Belediyesi · Sosyal Hizmetler Müdürlüğü
          </p>
        </section>

        {/* SAG: giris formu */}
        <section className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[460px]">
            {/* Dar ekranda kurum basligi (sol panel gizli) */}
            <div className="mb-7 flex items-center gap-3.5 lg:hidden">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white p-1 shadow-md ring-2 ring-[#D4B26A]/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LOGO_SRC} alt="Sivas Belediyesi logosu" className="h-full w-full rounded-full object-contain" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#8A6D2B]">T.C. Sivas Belediyesi</p>
                <p className="text-[19px] font-bold leading-tight text-[#1E2A38]">Sosyal Yardım Yönetim Sistemi</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#D5DDE2] bg-white shadow-[0_1px_2px_rgba(16,30,43,0.06),0_24px_60px_rgba(16,30,43,0.12)]">
              <div className="border-b-[3px] border-b-[#D4B26A] bg-[#1E2A38] px-7 py-5 text-white">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#D4B26A]">
                  {otpRequired ? 'Güvenlik Doğrulaması' : mustChangePassword ? 'Şifre Yenileme' : showForgotPassword ? 'Şifre Kurtarma' : 'Personel Girişi'}
                </p>
                <h2 className="mt-1 text-[22px] font-bold tracking-wide">
                  {otpRequired ? 'Doğrulama Kodu' : mustChangePassword ? 'Yeni Şifre Belirleyin' : showForgotPassword ? 'Şifremi Unuttum' : 'Oturum Açın'}
                </h2>
              </div>

              {otpRequired ? (
                <form onSubmit={submitOtp} className="space-y-5 px-7 py-7">
                  <div className={ALERT_INFO}>
                    Uzaktan giriş doğrulaması. Kayıtlı cep telefonunuza{otpPhoneHint ? ` (${otpPhoneHint})` : ''} SMS ile 6 haneli bir kod gönderildi. Kodu girerek girişi tamamlayın.
                  </div>

                  <div>
                    <label className={LABEL}>Doğrulama Kodu</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={otpCode}
                      onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      className={`${INPUT} text-center text-[22px] tracking-[0.5em]`}
                      required
                      autoFocus
                    />
                  </div>

                  {otpResendInfo && (
                    <p className="text-[13px] font-semibold text-emerald-700">{otpResendInfo}</p>
                  )}
                  {status && <div className={ALERT_ERROR}>{status}</div>}

                  <button type="submit" disabled={isSubmitting || otpCode.length !== 6} className={PRIMARY_BUTTON}>
                    {isSubmitting ? 'Doğrulanıyor...' : 'Girişi Tamamla'}
                  </button>

                  <div className="flex items-center justify-between text-[13.5px] font-bold">
                    <button type="button" onClick={resendOtp} disabled={isSubmitting} className={LINK_BUTTON}>
                      Kodu tekrar gönder
                    </button>
                    <button
                      type="button"
                      onClick={() => { setOtpRequired(false); setOtpCode(''); setOtpTicket(null); setStatus(''); setPassword('') }}
                      className="text-slate-500 hover:text-[#1E2A38] hover:underline"
                    >
                      Geri dön
                    </button>
                  </div>
                </form>
              ) : mustChangePassword ? (
                <form onSubmit={submitPasswordChange} className="space-y-5 px-7 py-7">
                  <div className={ALERT_WARN}>
                    Güvenliğiniz için varsayılan şifrenizi değiştirmeniz gerekiyor. Devam etmeden önce yeni bir şifre belirleyin.
                  </div>

                  <div>
                    <label className={LABEL}>Yeni Şifre</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      onKeyDown={handleCapsLock}
                      onKeyUp={handleCapsLock}
                      autoComplete="new-password"
                      className={INPUT}
                      required
                      autoFocus
                    />
                    {capsLockOn && <p className={CAPS_NOTE}><span aria-hidden>⚠</span> Caps Lock açık — şifre büyük/küçük harfe duyarlıdır.</p>}
                    <p className="mt-2 text-[12.5px] font-semibold leading-snug text-slate-500">{PASSWORD_POLICY_DESCRIPTION}</p>
                  </div>

                  <div>
                    <label className={LABEL}>Yeni Şifre (Tekrar)</label>
                    <input
                      type="password"
                      value={confirmNewPassword}
                      onChange={(event) => setConfirmNewPassword(event.target.value)}
                      onKeyDown={handleCapsLock}
                      onKeyUp={handleCapsLock}
                      autoComplete="new-password"
                      className={INPUT}
                      required
                    />
                  </div>

                  {status && <div className={ALERT_ERROR}>{status}</div>}

                  <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON}>
                    {isSubmitting ? 'Kaydediliyor...' : 'Şifreyi Değiştir ve Giriş Yap'}
                  </button>
                </form>
              ) : showForgotPassword ? (
                <form onSubmit={submitForgotPassword} className="space-y-5 px-7 py-7">
                  <div className={ALERT_INFO}>
                    Kullanıcı adınızı girin, sistemde kayıtlı WhatsApp numaranıza tek kullanımlık geçici bir şifre gönderelim. Bu şifreyle giriş yaptıktan sonra yeni bir şifre belirlemeniz istenecektir.
                  </div>

                  <div>
                    <label className={LABEL}>Kullanıcı Adı</label>
                    <input
                      value={forgotUsername}
                      onChange={(event) => setForgotUsername(event.target.value)}
                      autoComplete="username"
                      className={INPUT}
                      required
                      autoFocus
                      disabled={forgotSubmitted}
                    />
                  </div>

                  {forgotStatus && (
                    <div className={forgotSubmitted ? ALERT_SUCCESS : ALERT_ERROR}>{forgotStatus}</div>
                  )}

                  {!forgotSubmitted && (
                    <button type="submit" disabled={forgotSubmitting} className={PRIMARY_BUTTON}>
                      {forgotSubmitting ? 'Gönderiliyor...' : 'Geçici Şifre Gönder'}
                    </button>
                  )}

                  <button type="button" onClick={closeForgotPassword} className={SECONDARY_BUTTON}>
                    Giriş Ekranına Dön
                  </button>
                </form>
              ) : (
                <form onSubmit={submitLogin} className="space-y-5 px-7 py-7">
                  {sessionNotice && <div className={ALERT_WARN}>{sessionNotice}</div>}
                  {isLockedOut && (
                    <div className={ALERT_ERROR}>
                      Çok fazla başarısız giriş denemesi yapıldı. <span className="tabular-nums">{lockoutSeconds}</span> saniye sonra tekrar deneyebilirsiniz.
                    </div>
                  )}

                  <div>
                    <label className={LABEL}>Kullanıcı Adı</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>
                      </span>
                      <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        autoComplete="username"
                        disabled={isLockedOut}
                        className={`${INPUT} pl-11`}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className={LABEL}>Şifre</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                      </span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        onKeyDown={handleCapsLock}
                        onKeyUp={handleCapsLock}
                        autoComplete="current-password"
                        disabled={isLockedOut}
                        className={`${INPUT} pl-11 pr-20`}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute inset-y-0 right-2 my-auto h-8 rounded-md px-2.5 text-[12.5px] font-bold text-[#1E2A38] hover:bg-slate-100"
                        aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                      >
                        {showPassword ? 'Gizle' : 'Göster'}
                      </button>
                    </div>
                    {capsLockOn && <p className={CAPS_NOTE}><span aria-hidden>⚠</span> Caps Lock (büyük harf kilidi) açık — şifre büyük/küçük harfe duyarlıdır.</p>}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <label className="flex select-none items-center gap-2.5 text-[14.5px] font-semibold text-slate-600">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(event) => setRememberMe(event.target.checked)}
                        className="h-[18px] w-[18px] rounded border-slate-300 accent-[#1E2A38]"
                      />
                      Beni hatırla
                    </label>
                    <button type="button" onClick={openForgotPassword} className={LINK_BUTTON}>
                      Şifremi unuttum
                    </button>
                  </div>

                  {status && <div className={ALERT_ERROR}>{status}</div>}

                  <button type="submit" disabled={isSubmitting || isLockedOut} className={PRIMARY_BUTTON}>
                    {isLockedOut ? `${lockoutSeconds} saniye bekleyin...` : isSubmitting ? 'Giriş yapılıyor...' : 'Giriş Yap'}
                  </button>
                </form>
              )}

              <div className="border-t border-slate-100 bg-[#FAFBFC] px-7 py-5">
                <InstallAppButton variant="prominent" />
                <p className="mt-2.5 text-center text-[12.5px] font-medium leading-snug text-slate-500">
                  Uygulamayı bilgisayarınıza veya telefonunuza ekleyin; adres yazmadan simgeyle girin.
                </p>
              </div>
            </div>

            <p className="mt-5 flex items-start justify-center gap-2 text-center text-[12.5px] font-medium leading-snug text-slate-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-px h-4 w-4 shrink-0 text-[#8A6D2B]" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              Bu sistem yalnızca yetkili personelin kullanımı içindir. Tüm işlemler kayıt altına alınır.
            </p>
          </div>
        </section>
      </div>

      {/* Gorunum boyutu (giris sayfasina ozel; Ctrl + tekerlek / Ctrl +/- / Ctrl 0 ile de) */}
      <div className="fixed bottom-4 right-4 z-50 flex items-center overflow-hidden rounded-lg border border-[#D5DDE2] bg-white/95 shadow-[0_4px_14px_rgba(16,30,43,0.12)] backdrop-blur" title="Görünüm boyutu — Ctrl + fare tekerleği ile de değiştirilebilir">
        <button
          type="button"
          onClick={() => changeLoginZoom(loginZoom - LOGIN_ZOOM_STEP)}
          disabled={loginZoom <= LOGIN_ZOOM_MIN + 0.001}
          aria-label="Küçült"
          className="flex h-9 w-9 items-center justify-center text-[18px] font-bold text-[#1E2A38] hover:bg-[#F6F3EA] disabled:opacity-35"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => changeLoginZoom(1)}
          aria-label="Görünümü %100'e döndür"
          className="h-9 min-w-[3.6rem] border-x border-slate-200 px-1 font-mono text-[13px] font-bold text-[#1E2A38] hover:bg-[#F6F3EA]"
        >
          %{Math.round(loginZoom * 100)}
        </button>
        <button
          type="button"
          onClick={() => changeLoginZoom(loginZoom + LOGIN_ZOOM_STEP)}
          disabled={loginZoom >= LOGIN_ZOOM_MAX - 0.001}
          aria-label="Büyüt"
          className="flex h-9 w-9 items-center justify-center text-[18px] font-bold text-[#1E2A38] hover:bg-[#F6F3EA] disabled:opacity-35"
        >
          +
        </button>
      </div>
    </main>
  )
}
