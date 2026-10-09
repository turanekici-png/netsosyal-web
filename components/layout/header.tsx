'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { DashboardReminder } from '@/app/(modules)/dashboard/DashboardReminder'
import { playAlertSound } from '@/lib/notificationSound'
import { isValidNewPassword, PASSWORD_POLICY_DESCRIPTION } from '@/lib/security/passwordPolicy'
import { ThemeToggle } from './ThemeToggle'
import { WorkstationSetupButton } from './WorkstationSetupButton'
import { InstallAppButton } from '@/components/pwa/InstallAppButton'
import { useDesignMode } from '@/lib/context/DesignModeContext'
import { useShellZoom, SHELL_ZOOM_MIN, SHELL_ZOOM_MAX } from '@/lib/context/ShellZoomContext'
import { useUiScale, UI_SCALE_OPTIONS } from '@/lib/context/UiScaleContext'
import { STARTUP_PAGE_OPTIONS, DEFAULT_STARTUP_PAGE } from '@/lib/constants/startupPages'
import type { UserPermissionConfig } from '@/lib/constants/userPermissions'
import { hasHizliSatisAccess } from '@/lib/constants/pageAccess'

interface CurrentUserInfo {
  id: string
  name: string
  username?: string
  email?: string
  department?: string
  phone?: string
  address?: string
}

interface DocumentNotification {
  id: string
  fileId: string | null
  fileNo: string
  ownerName: string
  documentTitle: string
  completedDate: string
}

interface CommunicationNotification {
  id: string
  type: 'mesaj' | 'duyuru'
  subject?: string | null
  content: string
  priority: number
  createdAt: string
}

interface ApprovalDecisionNotification {
  id: string
  dosyaId: string
  dosyaNo: string
  kayitTuru: string
  turAdi: string
  durum: number
  onaylayanAdi: string
  onayTarihi: string | null
  redAciklama: string | null
}

interface ApprovalAssignedNotification {
  id: string
  dosyaId: string
  dosyaNo: string | null
  kayitTuru: string
  kisiAdi: string | null
  miktar: string | null
  turAdi: string
  talepEdenAdi: string | null
  talepTarihi: string
  aciklama: string | null
}

// "yrd_*" turleri YAZDIRMA onayi, "tahkikat_raporu" ise bir raporla ilgili
// UYGUN GORUS talebidir - bildirim metinlerinde bu ayrima gore farkli
// fiil/isim kullanilir (bkz. asagidaki kullanim yerleri).
function approvalActionNoun(kayitTuru: string) {
  return kayitTuru === 'tahkikat_raporu' ? 'uygun görüş' : 'yazdırma'
}

const fallbackCurrentUser: CurrentUserInfo = {
  id: '',
  name: 'Kullanıcı',
  department: 'Sosyal Hizmetler Müdürlüğü',
}

const getInitials = (name?: string) => {
  const parts = (name || 'Kullanıcı')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '')
    .join('') || 'KU'
}

export function Header({
  onMenuClick,
  sidebarAutoHide = false,
  onToggleSidebarAutoHide,
  permissionConfig = null,
}: {
  onMenuClick?: () => void
  // Kullanici istegi (Eylul 2026): sol menuyu otomatik gizle ac/kapa
  // dugmesi sag ust kosede - bkz. AppShell.tsx / SidebarShell.tsx.
  sidebarAutoHide?: boolean
  onToggleSidebarAutoHide?: () => void
  // Kullanici istegi (14 Eylul 2026, 12. tur): "yetkisi kapali olan
  // sayfanin ... butonu ... gorunmesin" - "Başlangıç" acilir listesi
  // (asagida) bu yetkiye gore filtrelenir. AppShell zaten yukledigi icin
  // burada AYRI bir sorgu yapilmiyor.
  permissionConfig?: UserPermissionConfig | null
}) {
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo>(fallbackCurrentUser)
  const [notifications, setNotifications] = useState<DocumentNotification[]>([])
  const [communicationNotifications, setCommunicationNotifications] = useState<CommunicationNotification[]>([])
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  // "Onaya Gönder" ile gönderilen taleplerin SONUCUNU (onaylandı/reddedildi)
  // talep eden kullaniciya gosteren bildirimler - diger bildirim turleriyle
  // ayni "Gelen Bildirimler" panelinde listelenir (bkz. loadNotifications).
  const [approvalDecisionNotifications, setApprovalDecisionNotifications] = useState<ApprovalDecisionNotification[]>([])
  // "Onaya Gönder" penceresinde belirli bir Yetkili Personel secildiginde,
  // O KISIYE ozel olarak gosterilen "onay bekleyen isleminiz var" popup'i
  // icin (bkz. app/api/notifications/approval-assigned).
  const [assignedApprovalNotifications, setAssignedApprovalNotifications] = useState<ApprovalAssignedNotification[]>([])
  // Bir onceki poll'daki id kumeleri - YENI bir kisisel bildirim (once
  // gorulmemis bir id) geldiginde sesli uyari calmak icin (bkz.
  // lib/notificationSound.ts). Sadece SAYI artisina degil, id kumesine
  // bakilir - biri "gorundu" isaretlenip listeden dusup baskasi eklendiginde
  // toplam sayi ayni kalsa bile yeni bir uyari calinmasi gerekir.
  const seenAssignedIdsRef = useRef<Set<string> | null>(null)
  const seenDecisionIdsRef = useRef<Set<string> | null>(null)
  // Kurumun PAYLAŞILAN WhatsApp Web oturumunun (bkz.
  // lib/services/whatsappWeb.service.ts) canlı durumu - "Kurum İçi Mesaj"
  // butonunun solunda, sadece bu bilgiye erişimi olan (tam yetkili/admin)
  // kullanıcılara gösterilir. /api/whatsapp/status zaten sunucu tarafında
  // admin dışı kullanıcılara 401/403 döndüğü için, "hasWhatsappAccess"
  // sadece o cevaba göre belirlenir - yetkisiz kullanıcı ekranında hiç
  // görünmez.
  const [whatsappConnection, setWhatsappConnection] = useState<{
    status: string
    qrDataUrl: string | null
    connectedNumber: string | null
    connectedName: string | null
    lastError: string | null
    reconnectCooldownUntil: number | null
  } | null>(null)
  const [hasWhatsappAccess, setHasWhatsappAccess] = useState(false)
  const [isWhatsappConnecting, setIsWhatsappConnecting] = useState(false)
  // Kullanici istegi: "mesajları çok yavaş gönderiyor ve gönderim
  // sırasında ekranda açık olduğu için başka işlem yapamıyorum" - toplu
  // WhatsApp gonderimi ASLINDA zaten sunucuda arka planda calisiyordu
  // (bkz. lib/services/whatsappBulk.service.ts - is, tarayici sekmesinden
  // BAGIMSIZ bir sunucu belleginde tutulur), ama pencereyi kapatinca
  // ilerlemeyi bir DAHA GOREMIYORDU, bu yuzden kullanici pencereyi acik
  // tutmaya MECBUR hissediyordu. Artik ust menude - WhatsApp baglanti
  // gostergesinin yaninda - HANGI SAYFADA olursa olsun surekli goruntulenen
  // kucuk bir ilerleme rozeti var; kullanici gonderim penceresini
  // GUVENLE kapatip baska islem yapabilir, gonderim buradan takip edilir.
  const [bulkWhatsappJob, setBulkWhatsappJob] = useState<{
    status: 'idle' | 'running' | 'completed' | 'cancelled'
    total: number
    processed: number
  } | null>(null)
  // bkz. yukaridaki bulkWhatsappJob notu - toplu SMS gonderimi de AYNI
  // desende (sunucuda arka planda, sekmeden bagimsiz) calisir, bu yuzden
  // AYNI turden bir gosterge/rozet ihtiyaci var (bkz. lib/services/
  // smsBulk.service.ts).
  const [bulkSmsJob, setBulkSmsJob] = useState<{
    status: 'idle' | 'running' | 'completed' | 'cancelled'
    total: number
    processed: number
  } | null>(null)
  const [isPasswordOpen, setIsPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordStatus, setPasswordStatus] = useState('')
  const [isPasswordSaving, setIsPasswordSaving] = useState(false)
  // "Profilim" penceresindeki fotograf + kisisel bilgiler (telefon/adres)
  const [photoVersion, setPhotoVersion] = useState(0)
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false)
  const [isPhotoBusy, setIsPhotoBusy] = useState(false)
  const [profileForm, setProfileForm] = useState({ phone: '', address: '' })
  const [profileStatus, setProfileStatus] = useState('')
  const [isProfileSaving, setIsProfileSaving] = useState(false)
  const { addTab } = useTabs()
  // Kullanici istegi (28 Agustos 2026): MOBIL/dar ekranda ust menudeki
  // ikincil butonlar (Tasarım Modu, WhatsApp durumu, gündüz/gece, yazıcı
  // kurulumu) tek bir "hamburger" menu icinde toplanir - ekranda sadece
  // profil (kullanici adi) + Cikis + bildirim zili gorunur. Masaustunde
  // (md+) hepsi eskisi gibi yan yana.
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false)
  // Kullanici istegi (Ekim 2026): "Tasarım Modu" dugmesi sayfa icindeki
  // bilgi cubugundan ust menuye (kullanici adinin yanina) tasindi - sadece
  // tasarim-modu destekleyen bir sayfa (ör. Dosya Yonetimi) acikken gorunur.
  const designMode = useDesignMode()
  const shellZoom = useShellZoom()
  const shellZoomPct = Math.round(shellZoom.zoom * 100)
  // Kullanici istegi (Eylul 2026): kisi kendi "Arayuz Boyutu"nu secsin -
  // hesaba ozel (sunucuda), her bilgisayarda ayni. Ctrl +/- kabuk zoom'undan
  // AYRI (o tarayiciya ozel, hizli ince ayar). Bkz. UiScaleContext.
  const uiScaleCtx = useUiScale()
  const uiScaleMatch = UI_SCALE_OPTIONS.reduce((best, opt) =>
    Math.abs(opt.value - uiScaleCtx.uiScale) < Math.abs(best.value - uiScaleCtx.uiScale) ? opt : best,
    UI_SCALE_OPTIONS[0],
  )
  // Kullanici istegi (Eylul 2026): "program ilk acildiginda su sayfa acilsin,
  // isteyen baska bir sayfa secebilsin". Hesaba ozel (sunucuda saklanir);
  // "/" acilista bu sayfaya yonlenir (bkz. app/page.tsx). Bos = varsayilan
  // (Dosya Yonetimi).
  const [startupPage, setStartupPage] = useState('')
  useEffect(() => {
    let cancelled = false
    fetch('/api/user-startup-page', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => { if (!cancelled && payload?.success) setStartupPage(String(payload.data?.path || '')) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const saveStartupPage = (path: string) => {
    setStartupPage(path)
    void fetch('/api/user-startup-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {})
  }
  // Kullanici istegi (14 Eylul 2026, 12. tur): "yetkisi kapali olan sayfanin
  // ... butonu ... gorunmesin" - "Başlangıç sayfası" acilir listesi eskiden
  // TUM secenekleri (kullanicinin erisimi olmayanlar dahil) gosteriyordu.
  // AppShell.tsx'teki "hasPageAccess" ile BIREBIR ayni mantik (ayri bir
  // sorgu yapmadan, AppShell'in zaten yukledigi permissionConfig uzerinden).
  const canAccessStartupPath = (path: string) => {
    if (!permissionConfig || permissionConfig.isAdmin) return true
    if (permissionConfig.isActive === false) return false
    // Kullanici istegi (2026-10-07): "/communication" icin "HERKESE ACIK"
    // istisnasi kaldirildi (bkz. lib/constants/pageAccess.ts AYNI tarihli not).
    if (!permissionConfig.allowedPages?.length) return true

    return permissionConfig.allowedPages.some((allowedPath) => (
      path === allowedPath ||
      (path === '/dashboard' && allowedPath === '/') ||
      path.startsWith(`${allowedPath}/`) ||
      allowedPath.startsWith(`${path}/`)
    ))
  }
  // "/satis" (Hizli Satis) artik iki ayri yolla erisilebilir (bkz.
  // lib/constants/pageAccess.ts hasHizliSatisAccess - YENI bagimsiz
  // "/hizli-satis" yetkisi VEYA ESKI genel "/muhasebe" yetkisi) -
  // canAccessStartupPath ayri/basit bir reimplementasyon oldugundan bu
  // ozel durumu burada da elle uygulamak gerekiyor.
  const visibleStartupPageOptions = STARTUP_PAGE_OPTIONS.filter((opt) => (
    opt.path === '/satis' ? hasHizliSatisAccess(permissionConfig) : canAccessStartupPath(opt.path)
  ))

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('Dosya okunamadı.'))
    reader.readAsDataURL(file)
  })

  const uploadProfilePhoto = async (file: File) => {
    if (!currentUser.id) return
    setIsPhotoBusy(true)
    try {
      const imageData = await fileToDataUrl(file)
      const response = await fetch(`/api/users/${encodeURIComponent(currentUser.id)}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData }),
      })
      if (!response.ok) throw new Error()
      setAvatarLoadFailed(false)
      setPhotoVersion((v) => v + 1)
    } catch {
      window.alert('Fotoğraf kaydedilemedi.')
    } finally {
      setIsPhotoBusy(false)
    }
  }

  const removeProfilePhoto = async () => {
    if (!currentUser.id) return
    setIsPhotoBusy(true)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(currentUser.id)}/photo`, { method: 'DELETE' })
      if (!response.ok) throw new Error()
      setAvatarLoadFailed(true)
      setPhotoVersion((v) => v + 1)
    } catch {
      window.alert('Fotoğraf kaldırılamadı.')
    } finally {
      setIsPhotoBusy(false)
    }
  }

  const saveProfileInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfileStatus('')
    setIsProfileSaving(true)
    try {
      const response = await fetch('/api/users/current', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileForm),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Kişisel bilgiler kaydedilemedi.')

      setCurrentUser((prev) => ({ ...prev, phone: profileForm.phone, address: profileForm.address }))
      setProfileStatus('Kişisel bilgileriniz kaydedildi.')
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : 'Kişisel bilgiler kaydedilemedi.')
    } finally {
      setIsProfileSaving(false)
    }
  }

  const connectWhatsapp = async (force = false) => {
    setIsWhatsappConnecting(true)
    try {
      const response = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const payload = await response.json().catch(() => null)
      if (payload?.success) setWhatsappConnection(payload.data)
    } catch {
      // sessizce yut - durum bir sonraki periyodik kontrolde tekrar okunur
    } finally {
      setIsWhatsappConnecting(false)
    }
  }

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPasswordStatus('')
    if (newPassword !== confirmPassword) {
      setPasswordStatus('Yeni şifreler birbiriyle uyuşmuyor.')
      return
    }
    if (!isValidNewPassword(newPassword)) {
      setPasswordStatus(`Yeni şifre kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}`)
      return
    }

    setIsPasswordSaving(true)
    try {
      const response = await fetch('/api/users/current/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const responseText = await response.text()
      const payload = responseText ? JSON.parse(responseText) : { success: false, error: 'Sunucu boş yanıt verdi.' }
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Şifre değiştirilemedi.')

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordStatus(payload.message || 'Şifreniz başarıyla değiştirildi.')
    } catch (error) {
      setPasswordStatus(error instanceof Error ? error.message : 'Şifre değiştirilemedi.')
    } finally {
      setIsPasswordSaving(false)
    }
  }

  const loadNotifications = async () => {
    try {
      const [response, communicationResponse, decisionResponse, assignedResponse] = await Promise.all([
        fetch('/api/notifications/documents', { cache: 'no-store' }),
        fetch('/api/communication/summary', { cache: 'no-store' }),
        fetch('/api/notifications/approval-decisions', { cache: 'no-store' }),
        fetch('/api/notifications/approval-assigned', { cache: 'no-store' }),
      ])
      const [payload, communicationPayload] = await Promise.all([response.json(), communicationResponse.json()])

      if (response.ok && payload.success && Array.isArray(payload.data)) {
        setNotifications(payload.data)
      }
      if (communicationResponse.ok && communicationPayload.success && Array.isArray(communicationPayload.data?.messages)) {
        setCommunicationNotifications(communicationPayload.data.messages)
      }

      const decisionPayload = await decisionResponse.json().catch(() => null)
      if (decisionResponse.ok && decisionPayload?.success && Array.isArray(decisionPayload.data)) {
        const items = decisionPayload.data as ApprovalDecisionNotification[]
        // Ilk yuklemede (ref hala null) TUM mevcut bildirimler "zaten
        // biliniyor" sayilir - sayfa acilir acilmaz gecmis bildirimler icin
        // ses calmasin, sadece BUNDAN SONRA gelen YENI'ler icin calsin.
        if (seenDecisionIdsRef.current) {
          const hasNewItem = items.some((item) => !seenDecisionIdsRef.current!.has(item.id))
          if (hasNewItem) playAlertSound()
        }
        seenDecisionIdsRef.current = new Set(items.map((item) => item.id))
        setApprovalDecisionNotifications(items)
      }

      const assignedPayload = await assignedResponse.json().catch(() => null)
      if (assignedResponse.ok && assignedPayload?.success && Array.isArray(assignedPayload.data)) {
        const items = assignedPayload.data as ApprovalAssignedNotification[]
        if (seenAssignedIdsRef.current) {
          const hasNewItem = items.some((item) => !seenAssignedIdsRef.current!.has(item.id))
          if (hasNewItem) playAlertSound()
        }
        seenAssignedIdsRef.current = new Set(items.map((item) => item.id))
        setAssignedApprovalNotifications(items)
      }

      // Su an acik olan bir dosyada "Onay Bekliyor" (sari) gorunen bir kayit,
      // baska bir sekmede/kullanicida onaylanmis/reddedilmis olabilir - bu
      // periyodik kontrol (30sn) her calistiginda dosya sayfasina (varsa)
      // haber verir, o da acik dosyayi SESSIZCE yeniler (bkz.
      // app/(modules)/documents/page.tsx - "approval:updated" dinleyicisi).
      // Boylece kullanici manuel yenilemeden yazdir butonunun rengi guncellenir.
      window.dispatchEvent(new CustomEvent('approval:updated'))
    } catch {
      setNotifications([])
      setCommunicationNotifications([])
    }
  }

  useEffect(() => {
    let isCancelled = false

    const loadCurrentUser = async () => {
      try {
        const response = await fetch('/api/users/current')
        const payload = await response.json()
        const loadedUser = response.ok && payload.success ? payload.data : null

        if (!isCancelled && loadedUser) {
          setCurrentUser({
            id: String(loadedUser.id ?? ''),
            name: loadedUser.name || loadedUser.username || 'Kullanıcı',
            username: loadedUser.username,
            email: loadedUser.email,
            department: loadedUser.department || 'Sosyal Hizmetler Müdürlüğü',
            phone: loadedUser.phone || '',
            address: loadedUser.address || '',
          })
          setProfileForm({ phone: loadedUser.phone || '', address: loadedUser.address || '' })
        }
      } catch {
        if (!isCancelled) {
          setCurrentUser(fallbackCurrentUser)
        }
      }
    }

    loadCurrentUser()
    const initialNotificationTimeoutId = window.setTimeout(() => {
      void loadNotifications()
    }, 0)
    const intervalId = window.setInterval(() => {
      void loadNotifications()
    }, 15000)
    const handleCommunicationUpdate = () => void loadNotifications()
    window.addEventListener('communication:updated', handleCommunicationUpdate)

    // Tarayicilar, ARKA PLANDAKI (aktif/odakli olmayan) sekmelerde
    // setInterval'i AGRESIF sekilde YAVASLATIR (pil tasarrufu icin) - kimi
    // zaman 30 saniyelik kontrol dakikalarca gecikebiliyor, kullaniciya
    // "yenilemeden gelmiyor" gibi gorunuyor. Sekme/pencere TEKRAR odaklanir
    // odaklanmaz (kullanicinin bu ekrana DONDUGU an) aninda bir kontrol
    // tetiklenir - boylece manuel sayfa yenilemeye GEREK KALMAZ.
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') void loadNotifications()
    }
    window.addEventListener('focus', handleVisibilityOrFocus)
    document.addEventListener('visibilitychange', handleVisibilityOrFocus)

    // Service Worker'dan ("public/sw.js") gelen push bildirimi, sekme ACIK
    // (arka planda/simge durumunda bile) oldugunda burada da aninda sesli
    // uyari calsin diye bir mesaj gonderiyor - 15sn'lik pollingi beklemeden,
    // bildirim ekrana dusar dusmez ses de calmis olur. Ayrica listeyi hemen
    // tazeler (rozet/sayaç anında güncellensin diye).
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'netsosyal-push-sound') {
        playAlertSound()
        void loadNotifications()
      }
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage)
    }

    return () => {
      isCancelled = true
      window.clearTimeout(initialNotificationTimeoutId)
      window.clearInterval(intervalId)
      window.removeEventListener('communication:updated', handleCommunicationUpdate)
      window.removeEventListener('focus', handleVisibilityOrFocus)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage)
      }
    }
  }, [])

  // Kurumun PAYLAŞILAN WhatsApp Web oturumunun canlı durumunu üst menüde
  // SÜREKLİ gösterebilmek için, sayfa hangi ekranda olursa olsun (Ayarlar >
  // WhatsApp Web sekmesine gerek kalmadan) periyodik olarak sorgular.
  // Yetkisiz kullanıcılarda /api/whatsapp/status 401/403 döner - bu durumda
  // "hasWhatsappAccess" false kalır ve göstergenin kendisi hiç render
  // edilmez (poll da devam eder, yetki sonradan verilirse anında görünür).
  useEffect(() => {
    let isCancelled = false

    const loadWhatsappConnection = async () => {
      try {
        const response = await fetch('/api/whatsapp/status', { cache: 'no-store' })
        if (response.status === 401 || response.status === 403) {
          if (!isCancelled) {
            setHasWhatsappAccess(false)
            setWhatsappConnection(null)
          }
          return
        }
        const payload = await response.json().catch(() => null)
        if (!isCancelled && payload?.success) {
          setHasWhatsappAccess(true)
          setWhatsappConnection(payload.data)
        }
      } catch {
        // sessizce yut - bir sonraki periyodik kontrolde tekrar denenir
      }
    }

    void loadWhatsappConnection()
    const intervalId = window.setInterval(loadWhatsappConnection, 8000)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  // Kullanici istegi: toplu WhatsApp gonderiminin ilerlemesi HANGI SAYFADA
  // olunursa olsun (gonderim penceresi kapali olsa bile) burada takip
  // edilebilsin - bkz. yukaridaki bulkWhatsappJob notu. Yetkisiz
  // kullanicilarda /api/whatsapp/bulk-status 401/403 doner, bu durumda
  // gosterge hic render edilmez.
  useEffect(() => {
    let isCancelled = false

    const loadBulkJobStatus = async () => {
      try {
        const response = await fetch('/api/whatsapp/bulk-status', { cache: 'no-store' })
        if (response.status === 401 || response.status === 403) {
          if (!isCancelled) setBulkWhatsappJob(null)
          return
        }
        const payload = await response.json().catch(() => null)
        if (!isCancelled && payload?.success) {
          setBulkWhatsappJob({
            status: payload.data.status,
            total: payload.data.total,
            processed: payload.data.processed,
          })
        }
      } catch {
        // sessizce yut - bir sonraki periyodik kontrolde tekrar denenir
      }
    }

    void loadBulkJobStatus()
    const intervalId = window.setInterval(loadBulkJobStatus, 4000)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  // bkz. yukaridaki toplu WhatsApp gonderim gostergesi notu - toplu SMS
  // gonderimi icin AYNI takip mekanizmasi (bkz. lib/services/smsBulk.
  // service.ts, /api/sms/bulk-status).
  useEffect(() => {
    let isCancelled = false

    const loadSmsBulkJobStatus = async () => {
      try {
        const response = await fetch('/api/sms/bulk-status', { cache: 'no-store' })
        if (response.status === 401 || response.status === 403) {
          if (!isCancelled) setBulkSmsJob(null)
          return
        }
        const payload = await response.json().catch(() => null)
        if (!isCancelled && payload?.success) {
          setBulkSmsJob({
            status: payload.data.status,
            total: payload.data.total,
            processed: payload.data.processed,
          })
        }
      } catch {
        // sessizce yut - bir sonraki periyodik kontrolde tekrar denenir
      }
    }

    void loadSmsBulkJobStatus()
    const smsIntervalId = window.setInterval(loadSmsBulkJobStatus, 4000)

    return () => {
      isCancelled = true
      window.clearInterval(smsIntervalId)
    }
  }, [])

  // Kullanıcı isteği: "'Bağlan' butonu görünüyorsa buna kullanıcı elle
  // basmak ZORUNDA kalmasın - program bunu KENDİSİ yapsın." Sunucu
  // tarafındaki dakikalık otomatik sağlık kontrolüne (bkz.
  // lib/services/whatsappWeb.service.ts) EK bir güvence katmanı: üst
  // menüdeki gösterge "Bağlı Değil" durumunu gösterir göstermez, sanki
  // yetkili kullanıcı "Bağlan"a basmış gibi otomatik bir bağlanma denemesi
  // tetiklenir - QR gerekmeyen (kayıtlı oturumlu) bir kopmada bağlantı
  // kendiliğinden düzelir. Aynı kopukluk için art arda deneme yapılmasın
  // diye (bağlantı sağlanana ya da durum değişene kadar) tek seferlik
  // tetiklenir.
  const whatsappAutoReconnectAttemptedRef = useRef(false)
  useEffect(() => {
    if (!hasWhatsappAccess || !whatsappConnection) return

    const isDropped = whatsappConnection.status === 'disconnected' || whatsappConnection.status === 'auth_failure'
    if (!isDropped) {
      whatsappAutoReconnectAttemptedRef.current = false
      return
    }

    if (whatsappAutoReconnectAttemptedRef.current || isWhatsappConnecting) return
    whatsappAutoReconnectAttemptedRef.current = true
    void connectWhatsapp(false)
  }, [hasWhatsappAccess, whatsappConnection, isWhatsappConnecting])

  const openNotificationFile = (notification: DocumentNotification) => {
    const query = new URLSearchParams()
    if (notification.fileId) {
      query.set('fileId', notification.fileId)
    } else if (notification.fileNo && notification.fileNo !== '-') {
      query.set('search', notification.fileNo)
    }

    addTab({
      title: notification.fileNo && notification.fileNo !== '-' ? `Dosya ${notification.fileNo}` : 'Dosya Ara',
      path: query.toString() ? `/documents?${query.toString()}` : '/documents',
    })
    setIsNotificationsOpen(false)
    window.setTimeout(() => {
      void loadNotifications()
    }, 1600)
  }

  const openApprovalDecisionFile = async (notification: ApprovalDecisionNotification) => {
    await fetch(`/api/notifications/approval-decisions/${notification.id}`, { method: 'PATCH' }).catch(() => null)

    addTab({
      title: notification.dosyaNo !== '-' ? `Dosya ${notification.dosyaNo}` : 'Dosya Ara',
      path: notification.dosyaNo !== '-' ? `/documents?${new URLSearchParams({ search: notification.dosyaNo }).toString()}` : '/documents',
    })
    setIsNotificationsOpen(false)
    window.setTimeout(() => {
      void loadNotifications()
    }, 1600)
  }

  // "Kapat" - popup'taki TUM sonuclari tek seferde "gorundu" isaretler
  // (her biri icin ayni PATCH ucu cagirilir) - liste bosalinca popup
  // kendiliginden kapanir (asagidaki kosullu render, uzunluk 0 oldugunda
  // artik gorunmez).
  const dismissAllApprovalDecisions = async () => {
    await Promise.all(approvalDecisionNotifications.map((notification) => (
      fetch(`/api/notifications/approval-decisions/${notification.id}`, { method: 'PATCH' }).catch(() => null)
    )))
    setApprovalDecisionNotifications([])
  }

  // "Kapat" - popup'taki hedeflenen talepleri "gorundu" isaretler, sadece
  // pencereyi kapatir.
  const dismissAssignedApprovals = async () => {
    await Promise.all(assignedApprovalNotifications.map((notification) => (
      fetch(`/api/notifications/approval-assigned/${notification.id}`, { method: 'PATCH' }).catch(() => null)
    )))
    setAssignedApprovalNotifications([])
  }

  // "Tamam" - ayni sekilde "gorundu" isaretler AMA ayrica Onay Bekleyenler
  // sayfasina yonlendirir.
  const goToApprovalQueueFromAssigned = async () => {
    await dismissAssignedApprovals()
    addTab({ title: 'Onay Bekleyenler', path: '/approval-queue' })
  }

  // Kullanici istegi (Ekim 2026): "Profilim" ve "Takvim ve Hatırlatıcı"
  // tetikleyicileri ust menuden SOL SIDEBAR'a tasindi. Modallar/popup'lar
  // (isPasswordOpen / DashboardReminder) hala burada yasiyor; sidebar
  // butonlari bir olay yayinliyor, burasi onu yakalayip aciyor.
  useEffect(() => {
    const openProfile = () => { setPasswordStatus(''); setProfileStatus(''); setIsPasswordOpen(true) }
    const openReminders = () => setIsNotificationsOpen(true)
    window.addEventListener('netsosyal:open-profile', openProfile)
    window.addEventListener('netsosyal:open-reminders', openReminders)
    return () => {
      window.removeEventListener('netsosyal:open-profile', openProfile)
      window.removeEventListener('netsosyal:open-reminders', openReminders)
    }
  }, [])

  const openCommunication = async (notification?: CommunicationNotification) => {
    if (notification) {
      await fetch(`/api/communication/${notification.id}/read`, { method: 'PATCH' }).catch(() => null)
    }
    const query = new URLSearchParams({ communication: 'open', openAt: String(Date.now()) })
    if (notification?.id) query.set('messageId', notification.id)
    addTab({ title: 'Dosya Ara', path: `/documents?${query.toString()}` })
    setIsNotificationsOpen(false)
    void loadNotifications()
  }

  return (
    <header className="relative border-b border-[#E2E5DE] bg-white shadow-[0_1px_2px_rgba(16,30,43,0.04)] print:hidden">
      <div className="relative flex min-h-[3.25rem] flex-row items-center justify-between gap-2 px-3 py-1.5 sm:px-4 lg:min-h-[3.5rem] lg:gap-4 lg:px-6 lg:py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:w-auto lg:flex-none">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Menuyu ac"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E2E5DE] bg-white text-[#16232B] shadow-sm transition hover:bg-[#F1F3EF] lg:hidden"
          >
            <span className="grid gap-1.5">
              <span className="block h-0.5 w-5 rounded-full bg-current" />
              <span className="block h-0.5 w-5 rounded-full bg-current" />
              <span className="block h-0.5 w-5 rounded-full bg-current" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
          <h2 className="dy-id-name truncate text-base font-semibold text-[#16232B] sm:text-lg">Sosyal Yardım Yönetim Sistemi</h2>
          </div>
        </div>
        <div className="relative flex shrink-0 items-center justify-end gap-2">
          {isHeaderMenuOpen && (
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setIsHeaderMenuOpen(false)}
              className="fixed inset-0 z-[55] cursor-default"
            />
          )}
          {/* Kullanici istegi (Ekim 2026): ust menudeki TUM kontroller (WhatsApp
              durumu, toplu gonderim, Boyut, zoom, tema, yazici, Uygulamayi
              Yukle, Tasarim Modu, Cikis) HER ekran boyutunda tek "İşlemler"
              dugmesi altinda toplanir - baslik alani daralir. "Takvim ve
              Hatırlatıcı" ile "Profilim" SOL SIDEBAR'a tasindi (bkz.
              sidebar.tsx + yukaridaki olay dinleyicileri). */}
          <div
            className={
              isHeaderMenuOpen
                ? 'absolute right-0 top-full z-[60] mt-2 flex w-[17rem] flex-col items-stretch gap-2 rounded-xl border border-[#E2E5DE] bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900'
                : 'hidden'
            }
          >
          <div className="flex flex-col shrink-0 min-w-0 items-stretch gap-2">
            {hasWhatsappAccess && whatsappConnection && (
              <div
                className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-2 text-[11px] font-black sm:px-3 sm:text-sm ${
                  whatsappConnection.status === 'ready'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : whatsappConnection.status === 'disconnected' || whatsappConnection.status === 'auth_failure'
                      ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                }`}
                title="Kurumun paylaşımlı WhatsApp Web bağlantı durumu"
              >
                <span
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    whatsappConnection.status === 'ready'
                      ? 'bg-emerald-500'
                      : whatsappConnection.status === 'disconnected' || whatsappConnection.status === 'auth_failure'
                        ? 'bg-rose-500'
                        : 'animate-pulse bg-amber-500'
                  }`}
                />
                <span className="hidden sm:inline">
                  {whatsappConnection.status === 'ready'
                    ? 'WhatsApp Bağlı'
                    : whatsappConnection.status === 'qr'
                      ? 'WhatsApp: QR Bekleniyor'
                      : whatsappConnection.status === 'disconnected' || whatsappConnection.status === 'auth_failure'
                        ? 'WhatsApp: Bağlı Değil'
                        : 'WhatsApp: Bağlanıyor...'}
                </span>
                <span className="sm:hidden">WA</span>
                {whatsappConnection.status === 'qr' && (
                  <button
                    type="button"
                    onClick={() => addTab({ title: 'Sistem Ayarları', path: '/settings?tab=whatsapp' })}
                    className="rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-black text-amber-800 hover:bg-amber-100"
                  >
                    QR Okut
                  </button>
                )}
                {(whatsappConnection.status === 'disconnected' || whatsappConnection.status === 'auth_failure') && (
                  <button
                    type="button"
                    onClick={() => void connectWhatsapp(true)}
                    disabled={isWhatsappConnecting}
                    className="rounded-lg border border-rose-300 bg-white px-2 py-0.5 text-[10px] font-black text-rose-800 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isWhatsappConnecting ? 'Bağlanıyor...' : 'Bağlan'}
                  </button>
                )}
              </div>
            )}
            {bulkWhatsappJob && bulkWhatsappJob.status === 'running' && (
              <div
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] font-black text-sky-800 sm:px-3 sm:text-sm dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                title="Toplu WhatsApp gönderimi arka planda devam ediyor - bu pencereyi kapatıp diğer işlerinize devam edebilirsiniz"
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-sky-500" />
                <span className="hidden sm:inline">
                  Toplu Gönderim: {bulkWhatsappJob.processed}/{bulkWhatsappJob.total}
                </span>
                <span className="sm:hidden">{bulkWhatsappJob.processed}/{bulkWhatsappJob.total}</span>
                <button
                  type="button"
                  onClick={() => {
                    void fetch('/api/whatsapp/bulk-cancel', { method: 'POST' })
                  }}
                  title="Toplu gönderimi iptal et"
                  className="rounded-lg border border-sky-300 bg-white px-2 py-0.5 text-[10px] font-black text-sky-800 hover:bg-sky-100"
                >
                  İptal Et
                </button>
              </div>
            )}
            {bulkSmsJob && bulkSmsJob.status === 'running' && (
              <div
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#0076b6]/30 bg-[#eaf7fd] px-2.5 py-2 text-[11px] font-black text-[#0076b6] sm:px-3 sm:text-sm dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                title="Toplu SMS gönderimi arka planda devam ediyor - bu pencereyi kapatıp diğer işlerinize devam edebilirsiniz"
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#0076b6]" />
                <span className="hidden sm:inline">
                  Toplu SMS: {bulkSmsJob.processed}/{bulkSmsJob.total}
                </span>
                <span className="sm:hidden">{bulkSmsJob.processed}/{bulkSmsJob.total}</span>
                <button
                  type="button"
                  onClick={() => {
                    void fetch('/api/sms/bulk-cancel', { method: 'POST' })
                  }}
                  title="Toplu gönderimi iptal et"
                  className="rounded-lg border border-[#0076b6]/40 bg-white px-2 py-0.5 text-[10px] font-black text-[#0076b6] hover:bg-sky-100"
                >
                  İptal Et
                </button>
              </div>
            )}
            {/* "Takvim ve Hatırlatıcı" tetikleyicisi SOL SIDEBAR'a tasindi -
                popup (DashboardReminder) burada kaliyor, sidebar butonu
                'netsosyal:open-reminders' olayiyla aciyor. */}
            <DashboardReminder
              showTrigger={false}
              open={isNotificationsOpen}
              onOpenChange={setIsNotificationsOpen}
              notifications={
              <section className="overflow-hidden rounded-xl border border-sky-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
                  <h3 className="text-xs font-black uppercase text-slate-700">Gelen Bildirimler</h3>
                </div>
                {notifications.length === 0 && communicationNotifications.length === 0 && approvalDecisionNotifications.length === 0 ? (
                  <div className="px-3 py-5 text-center text-sm font-bold text-slate-400">
                    Yeni bildirim yok.
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {approvalDecisionNotifications.length > 0 && (
                      <div className="border-b border-slate-100 bg-violet-50 px-3 py-1.5 text-[10px] font-black uppercase text-violet-700">Onay Sonuçları</div>
                    )}
                    {approvalDecisionNotifications.map((notification) => (
                      <button
                        key={`approval-${notification.id}`}
                        type="button"
                        onClick={() => void openApprovalDecisionFile(notification)}
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-violet-50"
                      >
                        <span className={`block truncate text-sm font-black ${notification.durum === 1 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {notification.turAdi} {approvalActionNoun(notification.kayitTuru)} talebiniz {notification.durum === 1 ? 'onaylandı' : 'reddedildi'}
                        </span>
                        <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">
                          Dosya {notification.dosyaNo} - {notification.onaylayanAdi}
                        </span>
                        {notification.durum === 2 && notification.redAciklama && (
                          <span className="mt-0.5 block truncate text-xs font-semibold text-rose-500">{notification.redAciklama}</span>
                        )}
                      </button>
                    ))}
                    {communicationNotifications.length > 0 && (
                      <div className="border-b border-slate-100 bg-cyan-50 px-3 py-1.5 text-[10px] font-black uppercase text-cyan-700">Mesaj ve Duyurular</div>
                    )}
                    {communicationNotifications.map((notification) => (
                      <button
                        key={`communication-${notification.id}`}
                        type="button"
                        onClick={() => void openCommunication(notification)}
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-cyan-50"
                      >
                        <span className="block truncate text-sm font-black text-slate-900">{notification.subject || (notification.type === 'duyuru' ? 'Yeni duyuru' : 'Yeni personel mesajı')}</span>
                        <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">{notification.content}</span>
                      </button>
                    ))}
                    {notifications.length > 0 && (
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase text-slate-600">Evrak Bildirimleri</div>
                    )}
                    {notifications.map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => openNotificationFile(notification)}
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-sky-50"
                      >
                        <span className="block truncate text-sm font-black text-slate-900">{notification.documentTitle}</span>
                        <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">
                          Dosya {notification.fileNo} - {notification.ownerName}
                        </span>
                        <span className="mt-1 block text-[11px] font-black uppercase text-[#005f95]">{notification.completedDate}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              }
            />
            {/* Kullanici istegi (Eylul 2026): "herkeste farkli cozunurluk var,
                uygulama birinde cok buyuk birinde cok kucuk". Kisi kendi
                arayuz boyutunu secer - HESABA ozel (sunucuda), her
                bilgisayarda ayni. Ctrl +/- (asagidaki %NN) bundan AYRI: o
                tarayiciya ozel hizli ince ayar. Bkz. UiScaleContext. */}
            <label
              className="flex w-full shrink-0 items-center justify-between gap-1.5 rounded-lg border border-[#E2E5DE] bg-white px-2 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
              title="Arayüz boyutu - hesabınıza kaydedilir, hangi bilgisayardan girseniz aynı"
            >
              <span className="text-[10px] font-black uppercase tracking-wide text-[#93A0A6] dark:text-slate-400">Boyut</span>
              <select
                value={uiScaleMatch.value}
                onChange={(event) => uiScaleCtx.setUiScale(Number(event.target.value))}
                className="cursor-pointer rounded-md border-0 bg-transparent py-0.5 pr-5 text-[12px] font-black text-[#16232B] outline-none focus:ring-1 focus:ring-[#0076b6] dark:text-slate-200"
              >
                {UI_SCALE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            {/* Kullanici istegi (Eylul 2026): program ilk acildiginda hangi
                sayfanin acilacagini kisi kendi secer - hesaba kaydedilir.
                14 Eylul 2026, 12. tur: liste artik SADECE erisim yetkisi
                olan sayfalari gosterir (bkz. visibleStartupPageOptions). */}
            {visibleStartupPageOptions.length > 0 && (
              <label
                className="flex w-full shrink-0 items-center justify-between gap-1.5 rounded-lg border border-[#E2E5DE] bg-white px-2 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                title="Program ilk açıldığında bu sayfa açılır - hesabınıza kaydedilir"
              >
                <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-[#93A0A6] dark:text-slate-400">Başlangıç</span>
                <select
                  value={
                    visibleStartupPageOptions.some((opt) => opt.path === (startupPage || DEFAULT_STARTUP_PAGE))
                      ? (startupPage || DEFAULT_STARTUP_PAGE)
                      : visibleStartupPageOptions[0].path
                  }
                  onChange={(event) => saveStartupPage(event.target.value)}
                  className="min-w-0 cursor-pointer truncate rounded-md border-0 bg-transparent py-0.5 pr-5 text-[12px] font-black text-[#16232B] outline-none focus:ring-1 focus:ring-[#0076b6] dark:text-slate-200"
                >
                  {visibleStartupPageOptions.map((opt) => (
                    <option key={opt.path} value={opt.path}>{opt.label}</option>
                  ))}
                </select>
              </label>
            )}
            {/* Kullanici istegi (Eylul 2026): tarayici zoom'u (Ctrl +/-) kaba
                adimlarla ziplyordu ("%67'den %50'ye"). Bunun yerine uygulama
                ici, ince adimli (%2) kabuk yakinlastirma. Ayar bu tarayiciya
                ozel saklanir (bkz. ShellZoomContext). */}
            <div className="flex w-full shrink-0 items-center justify-center gap-0.5 rounded-lg border border-[#E2E5DE] bg-white px-1 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <button
                type="button"
                onClick={shellZoom.decrement}
                disabled={shellZoom.zoom <= SHELL_ZOOM_MIN + 0.001}
                title="Ekranı küçült"
                aria-label="Ekranı küçült"
                className="flex h-7 w-7 items-center justify-center rounded-md text-base font-black leading-none text-[#16232B] hover:bg-[#F1F3EF] disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                −
              </button>
              <button
                type="button"
                onClick={shellZoom.reset}
                title="Yakınlaştırmayı %100'e döndür"
                className="min-w-[3.1rem] rounded-md px-1 text-center font-mono text-[11px] font-black text-[#16232B] hover:bg-[#F1F3EF] dark:text-slate-200 dark:hover:bg-slate-700"
              >
                %{shellZoomPct}
              </button>
              <button
                type="button"
                onClick={shellZoom.increment}
                disabled={shellZoom.zoom >= SHELL_ZOOM_MAX - 0.001}
                title="Ekranı büyüt"
                aria-label="Ekranı büyüt"
                className="flex h-7 w-7 items-center justify-center rounded-md text-base font-black leading-none text-[#16232B] hover:bg-[#F1F3EF] disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                +
              </button>
            </div>
            {/* ThemeToggle (gündüz/gece) + WorkstationSetupButton (yazıcı
                durumu) kullanici istegiyle (Eylul 2026) bu menuden CIKARILDI -
                artik sag ustte, "Sol menüyü gizle" dugmesinin yaninda
                dogrudan gorunuyor (bkz. asagisi). */}
            <InstallAppButton variant="compact" />
          </div>
          {designMode.hostAvailable && (
            <button
              type="button"
              onClick={designMode.toggle}
              title="Sayfa düzenini sürükle-bırak ile değiştir"
              className={`min-h-10 shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-2 text-[11px] font-black uppercase tracking-wide shadow-sm transition sm:px-3 sm:text-xs ${
                designMode.active
                  ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                  : 'border-[#E2E5DE] bg-white text-[#16232B] hover:bg-[#F1F3EF] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {designMode.active ? 'Tasarım Modunu Kapat' : 'Tasarım Modu'}
            </button>
          )}
          </div>
          {/* Kullanici istegi (Eylul 2026): "İşlemler" menusunun icinden
              cikarilan gunduz/gece modu + yazici durum bilgisi - sag ustte,
              "Sol menüyü gizle" dugmesinin yaninda. Kullanici istegi
              (2026-10-08): mobilde (lg altinda) yazici/kamera/kart okuyucu
              kurulumu zaten anlamsiz (kiosk/kasa bilgisayarlarina ozel) -
              yerine sayfayi yenileyen bir buton konuldu, SADECE mobilde
              (masaustunde - lg+ - eskisi gibi yazici butonu kalir). */}
          <ThemeToggle variant="onLight" />
          <div className="hidden lg:block">
            <WorkstationSetupButton />
          </div>
          <button
            type="button"
            onClick={() => {
              // Kullanici istegi (2026-10-08, 2. tur): "uygulamayı ve
              // sayfayı tamamen yenilesin" - bazi mobil tarayicilar
              // window.location.reload()'u gercek bir ag istegi yerine
              // bfcache/gorsel-onbellekten geri getirebiliyor (ozellikle
              // Safari/iOS'ta "geri" gibi davranabiliyor). Adrese zaman
              // damgali bir sorgu parametresi ekleyip replace() ile
              // gidilince tarayici bunu HER ZAMAN YENI bir sayfa sayar,
              // sunucudan (no-store/no-cache basliklariyle, bkz. proxy.ts)
              // tamamen taze veri/HTML/JS ceker.
              const url = new URL(window.location.href)
              url.searchParams.set('_r', Date.now().toString())
              window.location.replace(url.toString())
            }}
            title="Sayfayı yenile"
            aria-label="Sayfayı yenile"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-[#0076b6] hover:text-[#0076b6] active:scale-95 lg:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-sky-600"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M21 12a9 9 0 11-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          {/* Kullanici istegi (Eylul 2026): sol menuyu otomatik gizle / sabitle
              (yalnizca masaustu - lg+). Kapaliyken menu tamamen gizlenir,
              ekran tam genislik acilir; fare ekranin sol kenarina gelince
              menu kayarak acilir. Acikken menu tekrar sabitlenir. */}
          {onToggleSidebarAutoHide && (
            <button
              type="button"
              onClick={() => onToggleSidebarAutoHide()}
              aria-pressed={sidebarAutoHide}
              title={sidebarAutoHide
                ? 'Sol menüyü sabitle (otomatik gizlemeyi kapat)'
                : 'Sol menüyü otomatik gizle — fareyi ekranın sol kenarına getirince açılır'}
              aria-label={sidebarAutoHide ? 'Sol menüyü sabitle' : 'Sol menüyü otomatik gizle'}
              className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-sm transition lg:flex ${
                sidebarAutoHide
                  ? 'border-[#0076b6] bg-[#0076b6] text-white'
                  : 'border-[#E2E5DE] bg-white text-[#16232B] hover:bg-[#F1F3EF] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              {sidebarAutoHide ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-[18px] w-[18px]" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path strokeLinecap="round" d="M9 4v16" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m13 9 3 3-3 3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-[18px] w-[18px]" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path strokeLinecap="round" d="M9 4v16" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m17 9-3 3 3 3" />
                </svg>
              )}
            </button>
          )}
          {/* Kullanici istegi (Ekim 2026): TUM ust menu kontrolleri - her ekran
              boyutunda - tek "İşlemler" dugmesi altinda. */}
          <button
            type="button"
            onClick={() => setIsHeaderMenuOpen((o) => !o)}
            aria-label="İşlemler menüsü"
            aria-expanded={isHeaderMenuOpen}
            className={`flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12px] font-black uppercase tracking-wide shadow-sm transition sm:px-3 ${
              isHeaderMenuOpen
                ? 'border-[#0076b6] bg-[#0076b6] text-white'
                : 'border-[#E2E5DE] bg-white text-[#16232B] hover:bg-[#F1F3EF] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            <span className="grid gap-1">
              <span className="block h-0.5 w-4 rounded-full bg-current" />
              <span className="block h-0.5 w-4 rounded-full bg-current" />
              <span className="block h-0.5 w-4 rounded-full bg-current" />
            </span>
            <span className="hidden sm:inline">İşlemler</span>
            <svg className={`h-3 w-3 transition-transform ${isHeaderMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </div>
      </div>
      {isPasswordOpen && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-slate-950/60 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsPasswordOpen(false) }}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-[#005f95] via-[#0076b6] to-emerald-600 px-4 py-3 text-white">
              <div>
                <p className="text-[14px] font-black uppercase tracking-[0.18em] text-sky-100">Hesabım</p>
                <h2 className="mt-0.5 text-[14px] font-black">Profilim</h2>
              </div>
              <button type="button" onClick={() => setIsPasswordOpen(false)} className="rounded-lg border border-white/30 bg-white/15 px-3 py-1.5 text-[14px] font-black hover:bg-white/25">Kapat</button>
            </div>
            <div className="space-y-3.5 overflow-y-auto bg-gradient-to-br from-sky-50/70 via-white to-emerald-50/60 p-3.5">
              {/* Profil fotografi */}
              <div className="flex items-center gap-3 rounded-xl border border-sky-100 bg-white p-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-slate-200 bg-slate-100 text-[14px] font-black text-slate-400">
                  {currentUser.id && !avatarLoadFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={photoVersion}
                      src={`/api/users/${encodeURIComponent(currentUser.id)}/photo?v=${photoVersion}`}
                      alt={currentUser.name}
                      className="h-full w-full object-cover"
                      onError={() => setAvatarLoadFailed(true)}
                    />
                  ) : getInitials(currentUser.name)}
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-[14px] font-black text-[#005f95]">{currentUser.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[14px] font-black text-slate-700 transition hover:bg-slate-50">
                      {isPhotoBusy ? 'Yükleniyor...' : 'Fotoğraf Seç'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={isPhotoBusy}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) void uploadProfilePhoto(file)
                          event.target.value = ''
                        }}
                      />
                    </label>
                    {!avatarLoadFailed && (
                      <button
                        type="button"
                        onClick={() => void removeProfilePhoto()}
                        disabled={isPhotoBusy}
                        className="inline-flex w-fit items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[14px] font-black text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                      >
                        Fotoğrafı Kaldır
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2">
                {/* Kisisel bilgiler */}
                <form onSubmit={saveProfileInfo} className="space-y-2.5 rounded-xl border border-sky-200 bg-white p-3 shadow-sm">
                  <p className="text-[14px] font-black uppercase text-slate-600">Kişisel Bilgiler</p>
                  <div className="grid gap-2.5">
                    <label className="grid gap-1 text-[14px] font-black uppercase text-slate-600">Telefon
                      <input type="tel" value={profileForm.phone} onChange={(event) => setProfileForm((prev) => ({ ...prev, phone: event.target.value }))} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[14px] font-bold normal-case text-slate-950 outline-none focus:border-[#0076b6]" />
                    </label>
                    <label className="grid gap-1 text-[14px] font-black uppercase text-slate-600">Adres
                      <input value={profileForm.address} onChange={(event) => setProfileForm((prev) => ({ ...prev, address: event.target.value }))} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[14px] font-bold normal-case text-slate-950 outline-none focus:border-[#0076b6]" />
                    </label>
                  </div>
                  {profileStatus && <div className={`rounded-lg border px-2.5 py-1.5 text-[14px] font-bold ${profileStatus.includes('kaydedildi') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{profileStatus}</div>}
                  <button disabled={isProfileSaving} className="min-h-9 w-full rounded-lg bg-[#0076b6] text-[14px] font-black text-white shadow-sm transition hover:bg-[#005f95] disabled:opacity-50">{isProfileSaving ? 'Kaydediliyor...' : 'Kişisel Bilgileri Kaydet'}</button>
                </form>

                {/* Sifre degistirme */}
                <form onSubmit={changePassword} className="space-y-2.5 rounded-xl border border-emerald-200 bg-white p-3 shadow-sm">
                  <p className="text-[14px] font-black uppercase text-slate-600">Şifremi Değiştir</p>
                  <label className="grid gap-1 text-[14px] font-black uppercase text-slate-600">Mevcut Şifre<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[14px] font-bold normal-case text-slate-950 outline-none focus:border-[#0076b6]" /></label>
                  <label className="grid gap-1 text-[14px] font-black uppercase text-slate-600">
                    Yeni Şifre
                    <input required minLength={6} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[14px] font-bold normal-case text-slate-950 outline-none focus:border-[#0076b6]" />
                    <span className="text-[14px] font-semibold normal-case leading-snug text-slate-500">{PASSWORD_POLICY_DESCRIPTION}</span>
                  </label>
                  <label className="grid gap-1 text-[14px] font-black uppercase text-slate-600">Yeni Şifre Tekrar<input required minLength={6} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[14px] font-bold normal-case text-slate-950 outline-none focus:border-[#0076b6]" /></label>
                  {passwordStatus && <div className={`rounded-lg border px-2.5 py-1.5 text-[14px] font-bold ${passwordStatus.includes('başarıyla') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{passwordStatus}</div>}
                  <button disabled={isPasswordSaving} className="min-h-9 w-full rounded-lg bg-gradient-to-r from-[#005f95] via-[#0076b6] to-emerald-600 text-[14px] font-black text-white shadow-md transition hover:brightness-105 disabled:opacity-50">{isPasswordSaving ? 'Değiştiriliyor...' : 'Şifreyi Değiştir'}</button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Onay Sonucu Popup - "Onaya Gönder" ile gonderilen bir talep
          onaylandiginda/reddedildiginde, talep eden kullaniciya sadece
          "Gelen Bildirimler" listesinde pasif bir satir olarak degil,
          ekranin ORTASINDA, renkli, KENDILIGINDEN acilan bir pencere
          olarak da gosterilir (kullanicinin acikca istegi). Liste
          bosaldiginda (hepsi "gorundu" isaretlenince) otomatik kapanir. */}
      {approvalDecisionNotifications.length > 0 && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl">
            <div className="flex items-center gap-3 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-5 py-4 text-white">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">✓</span>
              <div>
                <h3 className="text-lg font-black leading-tight">Onay Sonuçları</h3>
                <p className="text-xs font-bold text-white/85">Gönderdiğiniz taleplerden {approvalDecisionNotifications.length} tanesi karara bağlandı.</p>
              </div>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
              {approvalDecisionNotifications.map((notification) => {
                const isApproved = notification.durum === 1
                return (
                  <div
                    key={notification.id}
                    className={`overflow-hidden rounded-xl border-2 shadow-sm ${isApproved ? 'border-emerald-200 bg-emerald-50/60' : 'border-rose-200 bg-rose-50/60'}`}
                  >
                    <div className="flex items-start gap-3 p-4">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-black text-white ${isApproved ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                        {isApproved ? '✓' : '✕'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-black leading-tight ${isApproved ? 'text-emerald-800' : 'text-rose-800'}`}>
                          {notification.turAdi} {approvalActionNoun(notification.kayitTuru)} talebiniz {isApproved ? 'onaylandı' : 'reddedildi'}
                        </p>
                        <p className="mt-1 text-xs font-bold text-slate-600">
                          Dosya <span className="font-black text-slate-800">{notification.dosyaNo}</span> · {notification.onaylayanAdi}
                        </p>
                        {!isApproved && notification.redAciklama && (
                          <p className="mt-1 text-xs font-semibold text-rose-600">Gerekçe: {notification.redAciklama}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-white/60 bg-white/40 px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => void openApprovalDecisionFile(notification)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black text-white shadow-sm transition ${isApproved ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                      >
                        Dosyayı Aç
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => void dismissAllApprovalDecisions()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-black text-slate-600 shadow-sm hover:bg-slate-100"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onay Bekleyen İşlem Popup - "Onaya Gönder" penceresinde BELIRLI bir
          Yetkili Personel secildiginde, O KISIYE ekraninin ortasinda,
          "Onay bekleyen isleminiz var" uyarisi ile birlikte kendiliginden
          acilir. "Tamam" onay sayfasina goturur, "Kapat" sadece pencereyi
          kapatir - HER IKISI de bildirimi "gorundu" isaretler (tekrar
          cikmamasi icin), sadece "Tamam" ayrica sayfaya yonlendirir. */}
      {assignedApprovalNotifications.length > 0 && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl">
            <div className="flex items-center gap-3 bg-gradient-to-r from-amber-600 via-orange-500 to-amber-500 px-5 py-4 text-white">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">!</span>
              <div>
                <h3 className="text-lg font-black leading-tight">Onay Bekleyen İşleminiz Var</h3>
                <p className="text-xs font-bold text-white/85">Size yönlendirilen {assignedApprovalNotifications.length} talep onayınızı/görüşünüzü bekliyor.</p>
              </div>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
              {assignedApprovalNotifications.map((notification) => (
                <div key={notification.id} className="overflow-hidden rounded-xl border-2 border-amber-200 bg-amber-50/60 p-4 shadow-sm">
                  <p className="text-sm font-black leading-tight text-amber-900">
                    {notification.turAdi} {approvalActionNoun(notification.kayitTuru)} talebi
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-600">
                    Dosya <span className="font-black text-slate-800">{notification.dosyaNo || '-'}</span>
                    {notification.kisiAdi ? <> · {notification.kisiAdi}</> : null}
                    {notification.miktar ? <> · {notification.miktar}</> : null}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Talep eden: {notification.talepEdenAdi || '-'}</p>
                  {notification.aciklama && (
                    <p className="mt-1 text-xs font-semibold text-amber-700">Not: {notification.aciklama}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => void dismissAssignedApprovals()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-black text-slate-600 shadow-sm hover:bg-slate-100"
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={() => void goToApprovalQueueFromAssigned()}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-600 to-orange-500 px-5 py-2 text-sm font-black text-white shadow-sm hover:brightness-110"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
