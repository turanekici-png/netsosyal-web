'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { MODULES_CONFIG } from '../../lib/constants/modules'
import {
  USER_PERMISSIONS_SETTING_KEY,
  type UserPermissionConfig,
  type UserPermissionsById,
} from '../../lib/constants/userPermissions'
import { hasHizliSatisAccess } from '../../lib/constants/pageAccess'
import { AUTHORIZED_PERSONNEL_SETTING_KEY, type AuthorizedPersonnelEntry } from '../../lib/constants/authorizedPersonnel'
import { useTabs } from '../../lib/context/TabContext'

type GeneralSettings = {
  institutionName?: string
  departmentName?: string
  address?: string
  phone1?: string
  phone2?: string
  email?: string
  website?: string
  logoDataUrl?: string
}

const GENERAL_SETTINGS_KEY = 'general_settings'

const defaultGeneralSettings: Required<GeneralSettings> = {
  institutionName: 'Sivas Belediyesi',
  departmentName: 'Sosyal Hizmetler Müdürlüğü',
  address: 'Sivas Belediyesi Sosyal Hizmetler Müdürlüğü',
  phone1: '',
  phone2: '',
  email: '',
  website: '',
  logoDataUrl: '/sivas-belediyesi-logo.png',
}

const moduleIconLabels: Record<string, string> = {
  message: 'İL',
  users: 'BI',
  file: 'DA',
  folder: 'DO',
  edit: 'MR',
  gift: 'YD',
  'users-cog': 'KU',
  'bar-chart': 'RP',
  workflow: 'IA',
  settings: 'AY',
  map: 'YH',
  calculator: 'HR',
}

// Kullanici istegi (Ekim 2026): "dosya-yonetimi-redesign" referans
// gorseline uygun sade sidebar - eskiden her modul FARKLI bir gokkusagi
// rengiyle (cyan/mavi/amber/yesil/kirmizi/mor...) parlak degrade rozete
// sahipti; referans tasarim TEK tip duz gri ikon kullaniyor. Ayirt edici
// olsun diye tamamen tek renge indirmek yerine, TUM modulleri ayni notr
// "kagit" zemin + teal ikon rengiyle sadelestirdik (aktif oldugunda zaten
// yukaridaki [&_...] override'lari teal'e donusuyor).
const moduleIconColors: Record<string, string> = {
  message: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  users: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  file: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  folder: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  edit: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  gift: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  'users-cog': 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  'bar-chart': 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  workflow: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  settings: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  map: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
  calculator: 'bg-[#F1F3EF] text-[#24384A] border-[#E2E5DE]',
}

// Sidebar butonlarindaki iki harfli metin rozetlerinin (AS, DO, BI ...)
// yerini alan, sinif adina gore secilen kucuk anahat (outline) SVG ikonlar.
// Ayri bir ikon kutuphanesi (lucide-react vb.) projede kurulu olmadigi icin
// mevcut dosyadaki (ör. acilir menu oku) stroke tabanli SVG uslubuyla ayni
// sekilde, elle yazilmis Heroicons-tarzi yollar kullanildi.
const moduleIconPaths: Record<string, string[]> = {
  home: ['M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25'],
  file: ['M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z'],
  folder: ['M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932h11.732a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776'],
  users: ['M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.106c0-1.114-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'],
  gift: ['M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H4.5a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18.375c.621 0 1.125-.504 1.125-1.125v-2.25c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v2.25c0 .621.504 1.125 1.125 1.125z'],
  'bar-chart': ['M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z'],
  'credit-card': ['M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a1.5 1.5 0 001.5-1.5V6.75a1.5 1.5 0 00-1.5-1.5h-15a1.5 1.5 0 00-1.5 1.5v10.5a1.5 1.5 0 001.5 1.5z'],
  inbox: ['M12 16.5V9.75m0 0l-3 3m3-3l3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z'],
  workflow: ['M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99'],
  settings: [
    'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.752.43.992l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a7.712 7.712 0 010-.255c.007-.378-.138-.752-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z',
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  ],
  calculator: ['M15.75 15.75V18M8.25 18v-.008M12 18v-.008M8.25 15v-.008M12 15v-.008M12 12v-.008M8.25 12v-.008M15.75 9V6.75A2.25 2.25 0 0013.5 4.5h-3a2.25 2.25 0 00-2.25 2.25V9m7.5 0h-7.5m7.5 0a2.25 2.25 0 012.25 2.25v6.75a2.25 2.25 0 01-2.25 2.25h-7.5a2.25 2.25 0 01-2.25-2.25v-6.75A2.25 2.25 0 018.25 9'],
  database: ['M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125'],
  map: ['M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.752a1.125 1.125 0 00-1.006 0L3.622 6.189C3.24 6.38 3 6.77 3 7.195v11.485c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z'],
  message: ['M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155'],
  'users-cog': ['M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.964 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z'],
  'badge-check': ['M9 12.75l2.25 2.25L15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z'],
}

function ModuleIcon({ icon, className }: { icon: string; className?: string }) {
  const paths = moduleIconPaths[icon] ?? moduleIconPaths.file
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden="true">
      {paths.map((d) => (
        <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
      ))}
    </svg>
  )
}

const reportSectionAssistancePaths = ['/assistance/periyodik', '/assistance/map']
const gulkartMovementsPath = '/reports/yardim-hareketleri'

function isReportSectionPath(path: string) {
  return (path.startsWith('/reports') && path !== gulkartMovementsPath && !path.startsWith(`${gulkartMovementsPath}/`)) || reportSectionAssistancePaths.some((reportPath) => (
    path === reportPath || path.startsWith(`${reportPath}/`)
  ))
}

function isGulkartSectionPath(path: string) {
  return path.startsWith('/gulkart') || path === gulkartMovementsPath || path.startsWith(`${gulkartMovementsPath}/`)
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { addTab } = useTabs()

  const [permissionConfig, setPermissionConfig] = useState<UserPermissionConfig | null>(null)
  const [accessBlockedMessage, setAccessBlockedMessage] = useState('')
  const [generalSettings, setGeneralSettings] = useState(defaultGeneralSettings)
  // Kullanici istegi (Ekim 2026): "Profilim" tetikleyicisi ust menuden BURAYA
  // (sidebar en alti) tasindi - modal hala header.tsx'te, buradaki buton
  // 'netsosyal:open-profile' olayiyla aciyor.
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; department: string } | null>(null)
  const [avatarFailed, setAvatarFailed] = useState(false)
  // Kullanici istegi (2026-10-08): "Çıkış" butonu sag ustteki "İşlemler"
  // menusunden kaldirilip, sol alt kosedeki kullanici bilgisinin yanina
  // KUCUK bir buton olarak tasindi - header.tsx'teki "logout" fonksiyonunun
  // AYNISI (orasindan KALDIRILDI, bkz. header.tsx).
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Cikis yapilamadi.')
      window.location.replace('/login')
    } catch {
      setIsLoggingOut(false)
      window.alert('Cikis yapilamadi. Lutfen tekrar deneyin.')
    }
  }
  // "Onay Bekleyenler" linki sadece sistem yoneticilerine ve "Ayarlar >
  // Yetkili Personeller" listesindeki kullanicilara gosterilir (bkz.
  // lib/apiAuth.ts - requireAuthorizedPersonnelOrAdmin, ayni kural sunucu
  // tarafinda da uygulaniyor - bu sadece linkin GORUNURLUGU icin).
  const [isAuthorizedPersonnelOrAdmin, setIsAuthorizedPersonnelOrAdmin] = useState(false)
  // "Onay Bekleyenler" butonu, dosya ekranından "Onaya Gönder" ile
  // gönderilmiş ve henüz karara bağlanmamış belge/yazdırma talepleri
  // varken RENKLENIP uyarı versin diye - üst menüdeki (header.tsx) ile
  // AYNI uç nokta burada da periyodik olarak sorgulanır.
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0)
  // "Kurum İçi Mesaj" butonu - okunmamış mesaj/duyuru sayısını rozet
  // olarak gösterir (bkz. header.tsx'teki eski karşılığı, aynı uç nokta).
  const [communicationUnreadCount, setCommunicationUnreadCount] = useState(0)
  const [openMenus, setOpenMenus] = useState({
    yardimlar: pathname.startsWith('/assistance') && !isReportSectionPath(pathname),
    digerYardimlar: pathname.startsWith('/assistance/aceze'),
    raporlar: isReportSectionPath(pathname),
    ayarlar: pathname.startsWith('/settings') || pathname.startsWith('/users') || pathname.startsWith('/logs') || pathname.startsWith('/sql-monitor') || pathname.startsWith('/scheduled-tasks') || pathname.startsWith('/asistan'),
    gulkart: isGulkartSectionPath(pathname),
    workflow: pathname.startsWith('/workflow'),
    muhasebe: pathname.startsWith('/muhasebe'),
    logs: pathname.startsWith('/logs'),
  })

  useEffect(() => {
    setOpenMenus({
      yardimlar: pathname.startsWith('/assistance') && !isReportSectionPath(pathname),
      digerYardimlar: pathname.startsWith('/assistance/aceze'),
      raporlar: isReportSectionPath(pathname),
      ayarlar: pathname.startsWith('/settings') || pathname.startsWith('/users') || pathname.startsWith('/logs') || pathname.startsWith('/sql-monitor') || pathname.startsWith('/scheduled-tasks') || pathname.startsWith('/asistan'),
      gulkart: isGulkartSectionPath(pathname),
      workflow: pathname.startsWith('/workflow'),
      muhasebe: pathname.startsWith('/muhasebe'),
      logs: pathname.startsWith('/logs'),
    })
  }, [pathname])

  useEffect(() => {
    let isCancelled = false

    const loadCurrentUserAndPermissions = async () => {
      try {
        const generalSettingsResponse = await fetch(`/api/settings/${GENERAL_SETTINGS_KEY}`)
        if (generalSettingsResponse.ok) {
          const generalSettingsPayload = await generalSettingsResponse.json()
          const value = generalSettingsPayload?.data?.value as GeneralSettings | undefined
          if (!isCancelled && value) {
            setGeneralSettings({
              ...defaultGeneralSettings,
              ...value,
            })
          }
        }

        const userResponse = await fetch('/api/users/current')
        const userPayload = await userResponse.json()
        if (userResponse.status === 403) {
          if (!isCancelled) {
            setAccessBlockedMessage(userPayload.error || 'Kullanıcı pasif durumda.')
          }
          return
        }
        const loadedUser = userResponse.ok && userPayload.success ? userPayload.data : null

        const userId = String(loadedUser?.id ?? '')
        if (!userId) return

        if (!isCancelled && loadedUser) {
          setCurrentUser({
            id: userId,
            name: loadedUser.name || loadedUser.username || 'Kullanıcı',
            department: loadedUser.department || defaultGeneralSettings.departmentName,
          })
        }

        const permissionResponse = await fetch(`/api/settings/${USER_PERMISSIONS_SETTING_KEY}`)
        let userPermissionConfig: UserPermissionConfig | undefined

        if (permissionResponse.status !== 404) {
          const permissionPayload = await permissionResponse.json()
          const permissions = permissionPayload?.data?.value as UserPermissionsById | undefined
          userPermissionConfig = permissions?.[userId]

          if (!isCancelled && userPermissionConfig) {
            setPermissionConfig(userPermissionConfig)
            if (userPermissionConfig.isActive === false) {
              setAccessBlockedMessage('Kullanıcı pasif durumda. Uygulama erişimi kapalı.')
            }
          }
        }

        const isAdmin = !userPermissionConfig || userPermissionConfig.isAdmin
        if (isAdmin) {
          if (!isCancelled) setIsAuthorizedPersonnelOrAdmin(true)
        } else {
          const authorizedResponse = await fetch(`/api/settings/${AUTHORIZED_PERSONNEL_SETTING_KEY}`)
          if (authorizedResponse.status !== 404) {
            const authorizedPayload = await authorizedResponse.json()
            const authorizedList = authorizedPayload?.data?.value as AuthorizedPersonnelEntry[] | undefined
            if (!isCancelled) {
              setIsAuthorizedPersonnelOrAdmin(Boolean(authorizedList?.some((entry) => entry.userId === userId)))
            }
          }
        }
      } catch {
        if (!isCancelled) {
          setPermissionConfig(null)
        }
      }
    }

    loadCurrentUserAndPermissions()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isAuthorizedPersonnelOrAdmin) {
      setPendingApprovalCount(0)
      return
    }

    let isCancelled = false

    const loadPendingApprovalCount = async () => {
      try {
        const response = await fetch('/api/documents/approval-requests?status=pending', { cache: 'no-store' })
        if (response.status === 401 || response.status === 403) {
          if (!isCancelled) setPendingApprovalCount(0)
          return
        }
        const payload = await response.json().catch(() => null)
        if (!isCancelled && payload?.success && Array.isArray(payload.data)) {
          setPendingApprovalCount(payload.data.length)
        }
      } catch {
        // sessizce yut - bir sonraki periyodik kontrolde tekrar denenir
      }
    }

    void loadPendingApprovalCount()
    const intervalId = window.setInterval(loadPendingApprovalCount, 30000)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [isAuthorizedPersonnelOrAdmin])

  useEffect(() => {
    let isCancelled = false

    const loadCommunicationUnreadCount = async () => {
      try {
        const response = await fetch('/api/communication/summary', { cache: 'no-store' })
        if (response.status === 401 || response.status === 403) {
          if (!isCancelled) setCommunicationUnreadCount(0)
          return
        }
        const payload = await response.json().catch(() => null)
        if (!isCancelled && payload?.success && Array.isArray(payload.data?.messages)) {
          setCommunicationUnreadCount(payload.data.messages.length)
        }
      } catch {
        // sessizce yut - bir sonraki periyodik kontrolde tekrar denenir
      }
    }

    void loadCommunicationUnreadCount()
    const intervalId = window.setInterval(loadCommunicationUnreadCount, 30000)
    // Baska bir ekranda (ör. dosya sayfasindaki mesaj panelinde) bir mesaj
    // "okundu" isaretlendiginde bu olay yayinlanir - rozet 15sn'yi
    // beklemeden aninda guncellensin diye.
    const handleCommunicationUpdate = () => void loadCommunicationUnreadCount()
    window.addEventListener('communication:updated', handleCommunicationUpdate)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('communication:updated', handleCommunicationUpdate)
    }
  }, [])

  const openCommunication = () => {
    const query = new URLSearchParams({ communication: 'open', openAt: String(Date.now()) })
    addTab({ title: 'Dosya Ara', path: `/documents?${query.toString()}` })
  }

  const canViewPath = (path: string) => {
    if (accessBlockedMessage || permissionConfig?.isActive === false) return false
    // Kullanici istegi (2026-10-07): "/communication" ve "/asistan" icin
    // "HERKESE ACIK" istisnasi kaldirildi (bkz. lib/constants/pageAccess.ts
    // AYNI tarihli not) - artik diger sayfalar gibi allowedPages'te acikca
    // belirtilmedikce gorunmezler.
    if (!permissionConfig || permissionConfig.isAdmin) return true
    if (!permissionConfig.allowedPages?.length) return true

    return permissionConfig.allowedPages.some((allowedPath) => (
      path === allowedPath || path.startsWith(`${allowedPath}/`) || allowedPath.startsWith(`${path}/`)
    ))
  }

  const canViewExactPath = (path: string) => {
    if (accessBlockedMessage || permissionConfig?.isActive === false) return false
    if (!permissionConfig || permissionConfig.isAdmin) return true
    if (!permissionConfig.allowedPages?.length) return true

    return permissionConfig.allowedPages.includes(path)
  }

  const canViewAnyPath = (paths: string[]) => paths.some((path) => canViewPath(path))
  const isUserPermissionPage = pathname === '/settings' && searchParams.get('tab') === 'userPermissions'
  const isOnlineFormsPage = pathname === '/settings' && searchParams.get('tab') === 'online'
  const isSystemSettingsPage = (pathname === '/settings' || pathname === '/settings/') && !isUserPermissionPage && !isOnlineFormsPage
  // Kullanici istegi (15 Eylul 2026, 32. tur): "sosyal asistan butonunu
  // ayarlar butonu icine alalim" - artik ust duzey (flat) bir sidebar
  // ogesi degil, "Ayarlar" acilir menusunun icinde bir alt-oge.
  const isAsistanPage = pathname === '/asistan' || pathname?.startsWith('/asistan/')

  const fileModule = canViewPath('/documents')
    ? MODULES_CONFIG.find((moduleConfig) => moduleConfig.path === '/documents')
    : undefined
  
  const modules = MODULES_CONFIG
    .filter((moduleConfig) => moduleConfig.path !== '/documents' && canViewPath(moduleConfig.path))
    .map((moduleConfig) => ({
      label: moduleConfig.name,
      path: moduleConfig.path,
      icon: moduleConfig.icon,
      iconLabel: moduleIconLabels[moduleConfig.icon] ?? 'MD',
      colorClass: moduleIconColors[moduleConfig.icon] ?? 'bg-gradient-to-br from-sky-500 to-blue-600 text-white border-sky-500',
    }))

  const digerYardimlarModules = modules.filter((m) => m.path === '/assistance/aceze').slice(0, 0)
  const yardimlarModules = modules.filter(
    (m) => m.path.startsWith('/assistance') && !isReportSectionPath(m.path)
  )
  const raporlarModules = modules.filter(
    (m) => (
      (m.path.startsWith('/reports') && m.path !== '/reports/ekmek' && m.path !== '/reports/genel' && m.path !== gulkartMovementsPath) ||
      reportSectionAssistancePaths.includes(m.path)
    )
  )
  const ayarlarModules = modules.filter((m) => m.path.startsWith('/settings'))
  const kullanicilarModules = modules.filter((m) => m.path.startsWith('/users'))
  const bireylerModule = modules.find((m) => m.path === '/beneficiary' || m.path.startsWith('/beneficiary/'))
  const dosyalarModule = modules.find((m) => m.path === '/documents/all' || m.path.startsWith('/documents/all/'))
  const otherModules = modules.filter(
    (m) =>
      !m.path.startsWith('/requests') &&
      !(m.path.startsWith('/assistance') && !isReportSectionPath(m.path)) &&
      !m.path.startsWith('/reports') &&
      !isReportSectionPath(m.path) &&
      !m.path.startsWith('/settings') &&
      !m.path.startsWith('/users') &&
      !m.path.startsWith('/gulkart') &&
      !m.path.startsWith('/online') &&
      !m.path.startsWith('/workflow') &&
      !m.path.startsWith('/muhasebe') &&
      !m.path.startsWith('/dernek') &&
      !m.path.startsWith('/beneficiary') &&
      !m.path.startsWith('/documents/all') &&
      !m.path.startsWith('/logs') &&
      !m.path.startsWith('/sql-monitor') &&
      !m.path.startsWith('/scheduled-tasks')
  )

  return (
    <aside
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) onNavigate?.()
      }}
      className="dy-sidebar relative flex h-full w-full shrink-0 flex-col overflow-hidden border-r border-[#101E2B]/10 bg-white text-slate-950 shadow-[10px_0_35px_rgba(16,30,43,0.08)] print:hidden dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100"
    >
      {/* Kullanici istegi (Ekim 2026): "dosya-yonetimi-redesign" referans
          gorseline uygun koyu "ink" marka basligi - eski mavi/yesil kurumsal
          degrade yerine sade koyu lacivert zemin + tek renk (teal) logo
          kutusu. Alttaki nav govdesi (okunurluk/kontrast riski dusuk
          tutmak icin) acik zeminde kaliyor, sadece vurgu renkleri
          (asagidaki [&_...] override'lari) teal/bronz'a cevrildi. */}
      <div className="relative overflow-hidden border-b border-[#1B2E3F] bg-[#101E2B] px-4 py-4">
        <div className="relative flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white p-2 shadow-md">
            <img
              src={generalSettings.logoDataUrl || defaultGeneralSettings.logoDataUrl}
              alt={`${generalSettings.institutionName || defaultGeneralSettings.institutionName} logosu`}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0 text-left">
            <h1 className="dy-id-name truncate text-[16px] font-semibold leading-tight text-white">{generalSettings.institutionName || defaultGeneralSettings.institutionName}</h1>
            <p className="mt-1 truncate text-[12px] font-medium leading-tight text-[#8FA0AA]">{generalSettings.departmentName || defaultGeneralSettings.departmentName}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto bg-white px-3 py-3 [scrollbar-color:#B98A34_transparent] [scrollbar-width:thin] [&_.bg-sky-50]:!border-[#E2E5DE] [&_.bg-sky-50]:!bg-[#F1F3EF] [&_.bg-sky-50]:!bg-none [&_.bg-sky-50]:shadow-none [&_.bg-sky-600]:!bg-[#0E7C86] [&_.from-sky-500]:!from-[#0E7C86] [&_.to-blue-700]:!to-[#0A5F67] [&_.border-sky-600]:!border-[#0A5F67] [&_a]:!py-0.5 [&_a:hover]:bg-[#F1F3EF] [&_button]:!py-0.5 [&_button:hover]:bg-[#F1F3EF] [&_summary]:!py-0.5 [&_summary:hover]:bg-[#F1F3EF] [&_details>div]:!mt-0 [&_details>div]:!pb-0 dark:[&_.bg-sky-50]:!border-sky-800 dark:[&_.bg-sky-50]:!from-sky-950 dark:[&_.bg-sky-50]:!via-slate-900 dark:[&_.bg-sky-50]:!to-emerald-950 dark:[&_.text-slate-600]:!text-slate-300 dark:[&_.text-slate-500]:!text-slate-400 dark:[&_.text-slate-700]:!text-slate-200 dark:[&_a]:!border-slate-700/60 dark:[&_button]:!border-slate-700/60 dark:[&_summary]:!border-slate-700/60 dark:[&_.bg-white]:!bg-slate-900 dark:[&_.bg-slate-50]:!bg-slate-800/70">
        <p className="mb-2 rounded-lg bg-[#101E2B] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white shadow-sm">Genel</p>
        
        {canViewPath('/') && (() => {
          // Kullanici istegi (Eylul 2026): "/" artik Dosya Yonetimi'ne
          // yonleniyor (bkz. app/page.tsx) - "Ana Sayfa" GERCEK dashboard
          // sayfasina (/dashboard) gitmeli, yoksa tiklayinca Dosya
          // Yonetimi'ne geri sekiyordu.
          const homeActive = pathname === '/' || pathname === '/dashboard'
          return (
        <Link
          href="/dashboard"
          className={`group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ${
            homeActive
              ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          {homeActive && (
            <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
          )}
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
              homeActive
                ? 'bg-gradient-to-br from-sky-500 to-blue-700 text-white border-sky-600'
                : 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white border-indigo-500'
            }`}
          >
            <ModuleIcon icon="home" className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-extrabold">Ana Sayfa</span>
          <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
            homeActive
              ? 'bg-[#B98A34] opacity-100'
              : 'bg-slate-300 opacity-0 group-hover:opacity-100'
          }`} />
        </Link>
          )
        })()}

        {fileModule && (
          <Link
            href={fileModule.path}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ${
              pathname === fileModule.path || pathname.startsWith(`${fileModule.path}/`)
                ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {pathname === fileModule.path && (
              <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
            )}
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                pathname === fileModule.path || pathname.startsWith(`${fileModule.path}/`)
                  ? 'bg-gradient-to-br from-sky-500 to-blue-700 text-white border-sky-600'
                  : moduleIconColors[fileModule.icon]
              }`}
            >
              <ModuleIcon icon={fileModule.icon} className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-extrabold">{fileModule.name}</span>
            <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
              pathname === fileModule.path || pathname.startsWith(`${fileModule.path}/`)
                ? 'bg-[#B98A34] opacity-100'
                : 'bg-slate-300 opacity-0 group-hover:opacity-100'
            }`} />
          </Link>
        )}

        {/* Onay Bekleyenler Sabit Butonu - "Dosya Yönetimi"nin hemen
            altında, Ana Sayfa/Dosya Yönetimi ile AYNI seviyede bağımsız bir
            buton (bir dropdown'un alt öğesi DEĞİL). Hem "Yetkili Personel"
            (ya da admin) OLMASI hem de "Kullanıcı Yetkileri"nden bu sayfaya
            erisim izni verilmis olmasi GEREKIR - boylece kisitli bir
            kullaniciya, Yetkili Personel listesinde olsa bile, bu sayfa
            Kullanıcı Yetkileri'nden ayrica kapatilabilir. Onay bekleyen
            (dosyadan "Onaya Gönder" ile gelen) kayıt varken buton kırmızı
            renkle nabız gibi atıp sayıyı rozet olarak gösterir - kullanıcı
            sekmeyi açmadan bile fark eder.
            (bkz. header.tsx - üst menüdeki AYNI amaçlı gösterge) */}
        {isAuthorizedPersonnelOrAdmin && canViewPath('/approval-queue') && (
        <Link
          href="/approval-queue"
          className={`group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ${
            pendingApprovalCount > 0
              ? 'animate-pulse border-2 border-red-400 bg-red-50 text-red-800 shadow-[0_0_0_3px_rgba(220,38,38,0.15)]'
              : pathname.startsWith('/approval-queue')
                ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          {pathname.startsWith('/approval-queue') && pendingApprovalCount === 0 && (
            <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
          )}
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
              pendingApprovalCount > 0
                ? 'bg-gradient-to-br from-red-500 to-rose-700 text-white border-red-600'
                : pathname.startsWith('/approval-queue')
                  ? 'bg-gradient-to-br from-violet-500 to-purple-700 text-white border-violet-600'
                  : 'bg-gradient-to-br from-violet-500 to-purple-600 text-white border-violet-500'
            }`}
          >
            <ModuleIcon icon="badge-check" className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-extrabold flex-1 text-left">Onay Bekleyenler</span>
          {pendingApprovalCount > 0 ? (
            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-black text-white">
              {pendingApprovalCount}
            </span>
          ) : (
            <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
              pathname.startsWith('/approval-queue')
                ? 'bg-[#B98A34] opacity-100'
                : 'bg-slate-300 opacity-0 group-hover:opacity-100'
            }`} />
          )}
        </Link>
        )}

        {/* Kurum İçi Mesaj Sabit Butonu - "Onay Bekleyenler"in hemen
            altında, Ana Sayfa/Dosya Yönetimi/Onay Bekleyenler ile AYNI
            seviyede bağımsız bir buton. Önceden üst menüde (header.tsx)
            duran bu buton buraya taşındı - okunmamış mesaj/duyuru varken
            kırmızı rozetle sayı gösterir.
            Kullanici istegi (2026-10-07): artik HERKESE ACIK degil - canViewPath
            ile ayni "/communication" yetkisine tabi (bkz. yukaridaki not). */}
        {canViewPath('/communication') && (
        <Link
          href="#"
          onClick={(event) => {
            event.preventDefault()
            openCommunication()
          }}
          className={`group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ${
            communicationUnreadCount > 0
              ? 'animate-pulse border-2 border-red-400 bg-red-50 text-red-800 shadow-[0_0_0_3px_rgba(220,38,38,0.15)]'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
              communicationUnreadCount > 0
                ? 'bg-gradient-to-br from-red-500 to-rose-700 text-white border-red-600'
                : 'bg-gradient-to-br from-cyan-500 to-sky-600 text-white border-cyan-500'
            }`}
          >
            <ModuleIcon icon="message" className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-extrabold flex-1 text-left">Kurum İçi Mesaj</span>
          {communicationUnreadCount > 0 ? (
            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-black text-white">
              {communicationUnreadCount}
            </span>
          ) : (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-slate-300 opacity-0 transition-all group-hover:opacity-100" />
          )}
        </Link>
        )}

        {/* Kullanici istegi (Ekim 2026): "Takvim ve Hatırlatıcı" tetikleyicisi
            ust menuden BURAYA (Kurum İçi Mesaj'in altina) tasindi. Popup
            (DashboardReminder) hala header.tsx'te; bu buton
            'netsosyal:open-reminders' olayiyla aciyor.
            Kullanici istegi (2026-10-07): daha once HICBIR yetki kontrolu
            yoktu (herkese daima acikti) - artik "/takvim-hatirlatici" sanal
            sayfa yetkisine tabi (bkz. app/(modules)/settings/page.tsx
            fixedPermissionPages). */}
        {canViewPath('/takvim-hatirlatici') && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('netsosyal:open-reminders'))}
          className="group relative flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-slate-600 transition-all duration-200 hover:bg-slate-50"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-500 bg-gradient-to-br from-amber-400 to-orange-500 text-white transition-transform group-hover:scale-110">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
              <rect x="3" y="4.5" width="18" height="16" rx="2" />
              <path strokeLinecap="round" d="M3 9h18M8 2.5v4M16 2.5v4" />
              <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="text-[15px] font-extrabold flex-1 text-left">Takvim ve Hatırlatıcı</span>
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-slate-300 opacity-0 transition-all group-hover:opacity-100" />
        </button>
        )}

        <p className="mb-2 mt-5 rounded-lg bg-[#0A5F67] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white shadow-sm">Modüller</p>
        <div className="space-y-0.5">

          {/* Dosyalar Sabit Butonu */}
          {dosyalarModule && (
            <Link
              href={dosyalarModule.path}
              className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                pathname.startsWith(dosyalarModule.path)
                  ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {pathname.startsWith(dosyalarModule.path) && (
                <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
              )}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                  pathname.startsWith(dosyalarModule.path) ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white border-amber-600' : dosyalarModule.colorClass
                }`}
              >
                <ModuleIcon icon={dosyalarModule.icon} className="h-4 w-4" />
              </span>
              <span className="text-[15px] font-extrabold flex-1 text-left">{dosyalarModule.label}</span>
              <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                pathname.startsWith(dosyalarModule.path)
                  ? 'bg-[#B98A34] opacity-100'
                  : 'bg-slate-300 opacity-0 group-hover:opacity-100'
              }`} />
            </Link>
          )}

          {/* Bireyler Sabit Butonu */}
          {bireylerModule && (
            <Link
              href={bireylerModule.path}
              className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                pathname.startsWith(bireylerModule.path)
                  ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {pathname.startsWith(bireylerModule.path) && (
                <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
              )}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                  pathname.startsWith(bireylerModule.path) ? 'bg-gradient-to-br from-blue-500 to-sky-700 text-white border-blue-600' : bireylerModule.colorClass
                }`}
              >
                <ModuleIcon icon={bireylerModule.icon} className="h-4 w-4" />
              </span>
              <span className="text-[15px] font-extrabold flex-1 text-left">{bireylerModule.label}</span>
              <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                pathname.startsWith(bireylerModule.path)
                  ? 'bg-[#B98A34] opacity-100'
                  : 'bg-slate-300 opacity-0 group-hover:opacity-100'
              }`} />
            </Link>
          )}

          {/* Yardımlar Ana Başlığı (Açılır/Kapanır) */}
          {yardimlarModules.length > 0 && (
            <details
              className="group"
              open={openMenus.yardimlar}
              onToggle={(e) => {
                const isOpen = e.currentTarget.open
                setOpenMenus((prev) => ({ ...prev, yardimlar: isOpen }))
              }}
            >
              <summary
                className={`list-none outline-none cursor-pointer [&::-webkit-details-marker]:hidden relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname.startsWith('/assistance')
                    ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {pathname.startsWith('/assistance') && (
                  <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
                )}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                    pathname.startsWith('/assistance') ? 'bg-gradient-to-br from-sky-500 to-blue-700 text-white border-sky-600' : 'bg-gradient-to-br from-rose-500 to-red-600 text-white border-rose-500'
                  }`}
                >
                  <ModuleIcon icon="gift" className="h-4 w-4" />
                </span>
                <span className="text-[15px] font-extrabold flex-1 text-left">Yardımlar</span>
                <svg
                  className="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>

              {/* Yardımlar Alt Menüsü */}
              <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-1.5 pb-1">
                  {yardimlarModules.map((moduleItem) => {
                    const isActive = moduleItem.path === '/reports'
                      ? pathname === moduleItem.path
                      : pathname === moduleItem.path || pathname.startsWith(`${moduleItem.path}/`)

                    return (
                      <button
                        key={moduleItem.path}
                        onClick={() => addTab({
                          title: moduleItem.path === '/assistance/aceze' ? 'Aceze Yardımı' : `${moduleItem.label} Listesi`,
                          path: moduleItem.path === '/assistance/aceze' ? `${moduleItem.path}?add=1` : moduleItem.path,
                        })}
                        className={`group relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                          isActive
                            ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {isActive && (
                          <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                        )}
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                            isActive ? 'bg-gradient-to-br from-sky-500 to-blue-700 text-white border-sky-600' : moduleItem.colorClass
                          }`}
                        >
                          {moduleItem.iconLabel || 'MD'}
                        </span>
                        <span title={moduleItem.path === '/assistance/aceze' ? 'Aceze Yardımı' : moduleItem.label} className="truncate text-[14px] font-extrabold">{moduleItem.path === '/assistance/aceze' ? 'Aceze Yardımı' : moduleItem.label}</span>
                        <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                          isActive
                            ? 'bg-[#B98A34] opacity-100'
                            : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                        }`} />
                      </button>
                    )
                  })}
              </div>
            </details>
          )}

          {/* Diğer Yardımlar Ana Başlığı (Açılır/Kapanır) */}
          {digerYardimlarModules.length > 0 && (
            <details
              className="group"
              open={openMenus.digerYardimlar}
              onToggle={(e) => {
                const isOpen = e.currentTarget.open
                setOpenMenus((prev) => ({ ...prev, digerYardimlar: isOpen }))
              }}
            >
              <summary
                className={`list-none outline-none cursor-pointer [&::-webkit-details-marker]:hidden relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname.startsWith('/assistance/aceze')
                    ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {pathname.startsWith('/assistance/aceze') && (
                  <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
                )}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                    pathname.startsWith('/assistance/aceze') ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white border-amber-600' : 'bg-gradient-to-br from-amber-500 to-orange-500 text-white border-amber-500'
                  }`}
                >
                  DY
                </span>
                <span className="text-[15px] font-extrabold flex-1 text-left">Diğer Yardımlar</span>
                <svg
                  className="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>

              <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-1.5 pb-1">
                {digerYardimlarModules.map((moduleItem) => {
                  const isActive = pathname === moduleItem.path || pathname.startsWith(`${moduleItem.path}/`)

                  return (
                    <div key={moduleItem.path} className="space-y-0.5">
                      <button
                        onClick={() => addTab({ title: 'Aceze', path: `${moduleItem.path}?add=1` })}
                        className={`group relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                          isActive
                            ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {isActive && (
                          <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                        )}
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                            isActive ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white border-amber-600' : moduleItem.colorClass
                          }`}
                        >
                          {moduleItem.iconLabel || 'AY'}
                        </span>
                        <span title="Aceze" className="truncate text-[14px] font-extrabold">Aceze</span>
                        <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                          isActive
                            ? 'bg-[#B98A34] opacity-100'
                            : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                        }`} />
                      </button>

                    </div>
                  )
                })}
              </div>
            </details>
          )}

          {/* Raporlar Ana Başlığı (Açılır/Kapanır) */}
          {raporlarModules.length > 0 && (
            <details
              className="group"
              open={openMenus.raporlar}
              onToggle={(e) => {
                const isOpen = e.currentTarget.open
                setOpenMenus((prev) => ({ ...prev, raporlar: isOpen }))
              }}
            >
              <summary
                className={`list-none outline-none cursor-pointer [&::-webkit-details-marker]:hidden relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  isReportSectionPath(pathname)
                    ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {isReportSectionPath(pathname) && (
                  <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
                )}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                    isReportSectionPath(pathname) ? 'bg-gradient-to-br from-violet-500 to-purple-700 text-white border-violet-600' : 'bg-gradient-to-br from-violet-500 to-purple-600 text-white border-violet-500'
                  }`}
                >
                  <ModuleIcon icon="bar-chart" className="h-4 w-4" />
                </span>
                <span className="text-[15px] font-extrabold flex-1 text-left">Raporlar</span>
                <svg
                  className="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>

              {/* Raporlar Alt Menüsü */}
              <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-1.5 pb-1">
                  {raporlarModules.map((moduleItem) => {
                    const isActive = pathname === moduleItem.path || pathname.startsWith(`${moduleItem.path}/`)

                    return (
                      <button
                        key={moduleItem.path}
                        onClick={() => addTab({ title: moduleItem.label, path: moduleItem.path })}
                        className={`group relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                          isActive
                            ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {isActive && (
                          <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                        )}
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                            isActive ? 'bg-gradient-to-br from-sky-500 to-blue-700 text-white border-sky-600' : moduleItem.colorClass
                          }`}
                        >
                          {moduleItem.iconLabel || 'MD'}
                        </span>
                        <span title={moduleItem.label} className="truncate text-[14px] font-extrabold">{moduleItem.label}</span>
                        <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                          isActive
                            ? 'bg-[#B98A34] opacity-100'
                            : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                        }`} />
                      </button>
                    )
                  })}
              </div>
            </details>
          )}

          {/* Gülkart İşlemleri Ana Başlığı (Açılır/Kapanır) */}
          {canViewAnyPath(['/gulkart/liste', '/gulkart/rezerv', gulkartMovementsPath]) && (
          <details
            className="group"
            open={openMenus.gulkart}
            onToggle={(e) => {
              const isOpen = e.currentTarget.open
              setOpenMenus((prev) => ({ ...prev, gulkart: isOpen }))
            }}
          >
            <summary
              className={`list-none outline-none cursor-pointer [&::-webkit-details-marker]:hidden relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                isGulkartSectionPath(pathname)
                  ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {isGulkartSectionPath(pathname) && (
                <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
              )}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                  isGulkartSectionPath(pathname) ? 'bg-gradient-to-br from-pink-500 to-rose-700 text-white border-pink-600' : 'bg-gradient-to-br from-pink-500 to-rose-600 text-white border-pink-500'
                }`}
              >
                <ModuleIcon icon="credit-card" className="h-4 w-4" />
              </span>
              <span className="text-[15px] font-extrabold flex-1 text-left">Gülkart İşlemleri</span>
              <svg
                className="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>

            {/* Gülkart Alt Menüsü */}
            <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-1.5 pb-1">
              <Link
                href="/gulkart/liste"
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname === '/gulkart/liste' || pathname.startsWith('/gulkart/liste/')
                    ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {(pathname === '/gulkart/liste' || pathname.startsWith('/gulkart/liste/')) && (
                  <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                )}
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                    pathname === '/gulkart/liste' || pathname.startsWith('/gulkart/liste/') ? 'bg-gradient-to-br from-pink-500 to-rose-700 text-white border-pink-600' : 'bg-pink-50 text-pink-600 border-pink-200'
                  }`}
                >
                  GL
                </span>
                <span title="Gülkart Listesi" className="truncate text-[14px] font-extrabold">Gülkart Listesi</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  pathname === '/gulkart/liste' || pathname.startsWith('/gulkart/liste/')
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>

              <Link
                href="/gulkart/rezerv"
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname === '/gulkart/rezerv' || pathname.startsWith('/gulkart/rezerv/')
                    ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {(pathname === '/gulkart/rezerv' || pathname.startsWith('/gulkart/rezerv/')) && (
                  <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                )}
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                    pathname === '/gulkart/rezerv' || pathname.startsWith('/gulkart/rezerv/') ? 'bg-gradient-to-br from-pink-500 to-rose-700 text-white border-pink-600' : 'bg-pink-50 text-pink-600 border-pink-200'
                  }`}
                >
                  GR
                </span>
                <span title="Gülkart Rezerv" className="truncate text-[14px] font-extrabold">Gülkart Rezerv</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  pathname === '/gulkart/rezerv' || pathname.startsWith('/gulkart/rezerv/')
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>

              {canViewPath(gulkartMovementsPath) && (
              <Link
                href={gulkartMovementsPath}
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname === gulkartMovementsPath || pathname.startsWith(`${gulkartMovementsPath}/`)
                    ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {(pathname === gulkartMovementsPath || pathname.startsWith(`${gulkartMovementsPath}/`)) && (
                  <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                )}
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-[10px] transition-transform group-hover:scale-110 ${
                    pathname === gulkartMovementsPath || pathname.startsWith(`${gulkartMovementsPath}/`) ? 'border-pink-600 bg-pink-600 text-white' : 'border-pink-200 bg-pink-50 text-pink-600'
                  }`}
                >
                  GH
                </span>
                <span title="Gülkart Hareketleri" className="truncate text-[14px] font-extrabold">Gülkart Hareketleri</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  pathname === gulkartMovementsPath || pathname.startsWith(`${gulkartMovementsPath}/`)
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>
              )}
            </div>
          </details>
          )}

          {/* Online Başvurular Sabit Butonu */}
          {canViewPath('/online') && (
          <Link
            href="/online"
            className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
              pathname.startsWith('/online')
                ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {pathname.startsWith('/online') && (
              <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
            )}
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                pathname.startsWith('/online') ? 'bg-gradient-to-br from-orange-500 to-amber-600 text-white border-orange-600' : 'bg-gradient-to-br from-orange-500 to-amber-500 text-white border-orange-500'
              }`}
            >
              <ModuleIcon icon="inbox" className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-extrabold flex-1 text-left">Online Başvurular</span>
            <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
              pathname.startsWith('/online')
                ? 'bg-[#B98A34] opacity-100'
                : 'bg-slate-300 opacity-0 group-hover:opacity-100'
            }`} />
          </Link>
          )}

          {/* İş Akışı Ana Başlığı (Açılır/Kapanır) */}
          {canViewAnyPath(['/workflow/on-inceleme', '/workflow/tahkikat', '/workflow/guncelleme', '/workflow/sonuc', '/workflow/mahalle-gruplari']) && (
          <details
            className="group"
            open={openMenus.workflow}
            onToggle={(e) => {
              const isOpen = e.currentTarget.open
              setOpenMenus((prev) => ({ ...prev, workflow: isOpen }))
            }}
          >
            <summary
              className={`list-none outline-none cursor-pointer [&::-webkit-details-marker]:hidden relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                pathname.startsWith('/workflow')
                  ? 'bg-emerald-50 text-emerald-800 shadow-sm'
                  : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-800'
              }`}
            >
              {pathname.startsWith('/workflow') && (
                <span className="absolute left-0 h-6 w-1 rounded-r-full bg-emerald-600" />
              )}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                  pathname.startsWith('/workflow') ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-200 bg-emerald-100 text-emerald-700'
                }`}
              >
                <ModuleIcon icon="workflow" className="h-4 w-4" />
              </span>
              <span className="text-[15px] font-extrabold flex-1 text-left">İş Akışı</span>
              <svg
                className="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>

            {/* İş Akışı Alt Menüsü */}
            <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-1.5 pb-1">
              {canViewPath('/workflow/on-inceleme') && (
              <Link
                href="/workflow/on-inceleme"
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname === '/workflow/on-inceleme' || pathname.startsWith('/workflow/on-inceleme/')
                    ? 'bg-yellow-100 text-yellow-950 shadow-sm'
                    : 'text-slate-600 hover:bg-yellow-50 hover:text-yellow-900'
                }`}
              >
                {(pathname === '/workflow/on-inceleme' || pathname.startsWith('/workflow/on-inceleme/')) && (
                  <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-yellow-400" />
                )}
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-[10px] transition-transform group-hover:scale-110 ${
                    pathname === '/workflow/on-inceleme' || pathname.startsWith('/workflow/on-inceleme/')
                      ? 'border-yellow-400 bg-yellow-400 text-yellow-950'
                      : 'border-yellow-200 bg-yellow-100 text-yellow-800'
                  }`}
                >
                  Öİ
                </span>
                <span title="Ön İnceleme" className="truncate text-[14px] font-extrabold">Ön İnceleme</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  pathname === '/workflow/on-inceleme' || pathname.startsWith('/workflow/on-inceleme/')
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>
              )}

              <Link
                href="/workflow/tahkikat"
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname === '/workflow/tahkikat' || pathname.startsWith('/workflow/tahkikat/')
                    ? 'bg-orange-100 text-orange-900 shadow-sm'
                    : 'text-slate-600 hover:bg-orange-50 hover:text-orange-800'
                }`}
              >
                {(pathname === '/workflow/tahkikat' || pathname.startsWith('/workflow/tahkikat/')) && (
                  <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-orange-500" />
                )}
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                    pathname === '/workflow/tahkikat' || pathname.startsWith('/workflow/tahkikat/') ? 'bg-gradient-to-br from-orange-500 to-amber-600 text-white border-orange-600' : 'bg-orange-50 text-orange-600 border-orange-200'
                  }`}
                >
                  TH
                </span>
                <span title="Tahkikat" className="truncate text-[14px] font-extrabold">Tahkikat</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  pathname === '/workflow/tahkikat' || pathname.startsWith('/workflow/tahkikat/')
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>

              <Link
                href="/workflow/guncelleme"
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname === '/workflow/guncelleme' || pathname.startsWith('/workflow/guncelleme/')
                    ? 'bg-blue-100 text-blue-900 shadow-sm'
                    : 'text-slate-600 hover:bg-blue-50 hover:text-blue-800'
                }`}
              >
                {(pathname === '/workflow/guncelleme' || pathname.startsWith('/workflow/guncelleme/')) && (
                  <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-blue-600" />
                )}
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                    pathname === '/workflow/guncelleme' || pathname.startsWith('/workflow/guncelleme/') ? 'border-blue-600 bg-blue-600 text-white' : 'border-blue-200 bg-blue-50 text-blue-700'
                  }`}
                >
                  GN
                </span>
                <span title="Sonuç Bekleyen" className="truncate text-[14px] font-extrabold">Sonuç Bekleyen</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  pathname === '/workflow/guncelleme' || pathname.startsWith('/workflow/guncelleme/')
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>

              <Link
                href="/workflow/sonuc"
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname === '/workflow/sonuc' || pathname.startsWith('/workflow/sonuc/')
                    ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {(pathname === '/workflow/sonuc' || pathname.startsWith('/workflow/sonuc/')) && (
                  <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                )}
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                    pathname === '/workflow/sonuc' || pathname.startsWith('/workflow/sonuc/') ? 'bg-gradient-to-br from-orange-500 to-amber-600 text-white border-orange-600' : 'bg-orange-50 text-orange-600 border-orange-200'
                  }`}
                >
                  SN
                </span>
                <span title="İnceleme Formları" className="truncate text-[14px] font-extrabold">İnceleme Formları</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  pathname === '/workflow/sonuc' || pathname.startsWith('/workflow/sonuc/')
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>

              {/* Kullanici istegi (2026-10-08): "iş akışı içine Mahalle
                  Grupları adında bir buton ekleyelim, yetkili personel
                  buradan mahalleleri gruplasın ve ilgili personellere bu
                  grupları ve çalışma sürelerini tanımlasın" - tahkikat
                  dosyalarinin mahalleye gore paketlenip personele aylik
                  rotasyonla dagitildigi yonetim sayfasi. */}
              {canViewPath('/workflow/mahalle-gruplari') && (
              <Link
                href="/workflow/mahalle-gruplari"
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  pathname === '/workflow/mahalle-gruplari' || pathname.startsWith('/workflow/mahalle-gruplari/')
                    ? 'bg-indigo-100 text-indigo-900 shadow-sm'
                    : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-800'
                }`}
              >
                {(pathname === '/workflow/mahalle-gruplari' || pathname.startsWith('/workflow/mahalle-gruplari/')) && (
                  <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-indigo-500" />
                )}
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                    pathname === '/workflow/mahalle-gruplari' || pathname.startsWith('/workflow/mahalle-gruplari/') ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-600 border-indigo-200'
                  }`}
                >
                  MG
                </span>
                <span title="Mahalle Grupları" className="truncate text-[14px] font-extrabold">Mahalle Grupları</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  pathname === '/workflow/mahalle-gruplari' || pathname.startsWith('/workflow/mahalle-gruplari/')
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>
              )}
            </div>
          </details>
          )}

          {/* Muhasebe Ana Başlığı (Açılır/Kapanır) - Kullanici istegi
              (2026-10-07, 3. tur): "/hizli-satis" KENDI BAGIMSIZ yetkisi de
              bu basligi gorunur kilar (bkz. lib/constants/pageAccess.ts
              hasHizliSatisAccess) - yoksa SADECE Hizli Satis'a yetkili
              (genel "/muhasebe" yetkisi OLMAYAN) bir kullanici "Muhasebe"
              basligini hic goremezdi. */}
          {hasHizliSatisAccess(permissionConfig) && (
          <details
            className="group"
            open={openMenus.muhasebe}
            onToggle={(e) => {
              const isOpen = e.currentTarget.open
              setOpenMenus((prev) => ({ ...prev, muhasebe: isOpen }))
            }}
          >
            <summary
              className={`list-none outline-none cursor-pointer [&::-webkit-details-marker]:hidden relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                pathname.startsWith('/muhasebe')
                  ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {pathname.startsWith('/muhasebe') && (
                <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
              )}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                  pathname.startsWith('/muhasebe') ? 'bg-gradient-to-br from-indigo-500 to-blue-700 text-white border-indigo-600' : 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white border-indigo-500'
                }`}
              >
                <ModuleIcon icon="calculator" className="h-4 w-4" />
              </span>
              <span className="text-[15px] font-extrabold flex-1 text-left">Muhasebe</span>
              <svg
                className="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>

            {/* Muhasebe Alt Menüsü */}
            <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-1.5 pb-1">
              {hasHizliSatisAccess(permissionConfig) && (
              <a
                href="/wolvox/hizli-satis"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 transition-all duration-200 hover:bg-indigo-50 hover:text-indigo-800"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-[10px] text-indigo-600 transition-transform group-hover:scale-110">
                  HS
                </span>
                <span title="Satış" className="truncate text-[14px] font-extrabold">Satış</span>
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-slate-300 opacity-0 transition-all group-hover:opacity-100" />
              </a>
              )}
            </div>
          </details>
          )}

          {/* Dernek İşlemleri Sabit Butonu - duz <a> (Link DEGIL) kullanilir:
              "/dernek" artik DOGRUDAN proxy'nin kendisi (bkz. app/dernek/
              [[...path]]/route.ts - eskiden ayri bir "/dernek-app" + bir
              "/dernek" yonlendirme sayfasi vardi, kullanici istegiyle
              birlestirildi). Yine de Next.js'in Link bileseni yerine duz <a>
              tercih edilir - MODULES_CONFIG'e kayitli "/dernek" yolu,
              TabContext'in bu pencerede fazladan bir sekme acmasina yol
              acabilirdi, duz <a> bu etkilesimi tamamen devre disi birakir. */}
          {canViewPath('/dernek') && (
          <a
            href="/dernek"
            target="_blank"
            rel="noopener noreferrer"
            className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
              pathname.startsWith('/dernek')
                ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {pathname.startsWith('/dernek') && (
              <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
            )}
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                pathname.startsWith('/dernek') ? 'bg-gradient-to-br from-teal-500 to-emerald-700 text-white border-teal-600' : 'bg-gradient-to-br from-teal-500 to-emerald-600 text-white border-teal-500'
              }`}
            >
              <ModuleIcon icon="badge-check" className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-extrabold flex-1 text-left">Dernek İşlemleri</span>
            <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
              pathname.startsWith('/dernek')
                ? 'bg-[#B98A34] opacity-100'
                : 'bg-slate-300 opacity-0 group-hover:opacity-100'
            }`} />
          </a>
          )}

          {/* Ayarlar Ana Başlığı (Açılır/Kapanır) */}
          {/* Kullanici istegi (Agustos 2026): SADECE "Ayarlar" butonu, sidebarin
              geri kalaninin teal temasindan MUAF - kendi notr gri gorunumunu
              korur (bkz. globals.css .dy-sidebar [data-sidebar-settings]). */}
          {canViewAnyPath(['/settings', '/users', '/logs/history', '/logs/trash', '/sql-monitor', '/scheduled-tasks', '/asistan']) && (
          <details
            data-sidebar-settings=""
            className="group"
            open={openMenus.ayarlar}
            onToggle={(e) => {
              const isOpen = e.currentTarget.open
              setOpenMenus((prev) => ({ ...prev, ayarlar: isOpen }))
            }}
          >
            <summary
              className={`list-none outline-none cursor-pointer [&::-webkit-details-marker]:hidden relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                pathname.startsWith('/settings') || pathname.startsWith('/users') || pathname.startsWith('/logs') || pathname.startsWith('/sql-monitor') || pathname.startsWith('/scheduled-tasks') || isAsistanPage
                  ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {(pathname.startsWith('/settings') || pathname.startsWith('/users') || pathname.startsWith('/logs') || pathname.startsWith('/sql-monitor') || pathname.startsWith('/scheduled-tasks') || isAsistanPage) && (
                <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
              )}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                  pathname.startsWith('/settings') || pathname.startsWith('/users') || pathname.startsWith('/logs') || pathname.startsWith('/sql-monitor') || pathname.startsWith('/scheduled-tasks') || isAsistanPage ? 'bg-gradient-to-br from-slate-500 to-slate-700 text-white border-slate-600' : 'bg-gradient-to-br from-slate-500 to-slate-600 text-white border-slate-500'
                }`}
              >
                <ModuleIcon icon="settings" className="h-4 w-4" />
              </span>
              <span className="text-[15px] font-extrabold flex-1 text-left">Ayarlar</span>
              <svg
                className="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>

            {/* Ayarlar Alt Menüsü */}
            <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-1.5 pb-1">
                {/* Sosyal Asistan (Kullanici istegi, 15 Eylul 2026, 32. tur):
                    herkese acik oldugu icin ozel bir yetki kontrolu YOK -
                    /asistan zaten canViewPath icinde herkese acik. */}
                <Link
                  href="/asistan"
                  className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                    isAsistanPage
                      ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {isAsistanPage && (
                    <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                  )}
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                      isAsistanPage ? 'bg-gradient-to-br from-sky-500 to-blue-700 text-white border-sky-600' : 'bg-gradient-to-br from-sky-500 to-blue-600 text-white border-sky-500'
                    }`}
                  >
                    🤖
                  </span>
                  <span title="Sosyal Asistan" className="truncate text-[14px] font-extrabold">Sosyal Asistan</span>
                  <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                    isAsistanPage
                      ? 'bg-[#B98A34] opacity-100'
                      : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                  }`} />
                </Link>

                {/* Sistem Ayarları Sabit Alt Menüsü */}
                {canViewExactPath('/settings') && (
                <Link
                  href="/settings"
                  className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                    isSystemSettingsPage
                      ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {isSystemSettingsPage && (
                    <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                  )}
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                      isSystemSettingsPage ? 'bg-gradient-to-br from-slate-500 to-slate-700 text-white border-slate-600' : 'bg-gradient-to-br from-slate-500 to-slate-600 text-white border-slate-500'
                    }`}
                  >
                    SA
                  </span>
                  <span title="Sistem Ayarları" className="truncate text-[14px] font-extrabold">Sistem Ayarları</span>
                  <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                    isSystemSettingsPage
                      ? 'bg-[#B98A34] opacity-100'
                      : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                  }`} />
                </Link>
                )}

                {canViewPath('/settings/online') && (
                <Link
                  href="/settings?tab=online"
                  className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                    isOnlineFormsPage
                      ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {isOnlineFormsPage && (
                    <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                  )}
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                      isOnlineFormsPage ? 'bg-gradient-to-br from-sky-500 to-blue-700 text-white border-sky-600' : 'bg-gradient-to-br from-sky-500 to-blue-600 text-white border-sky-500'
                    }`}
                  >
                    OB
                  </span>
                  <span title="Online Başvuru Formları" className="truncate text-[14px] font-extrabold">Online Başvuru Formları</span>
                  <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                    isOnlineFormsPage
                      ? 'bg-[#B98A34] opacity-100'
                      : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                  }`} />
                </Link>
                )}

                {ayarlarModules.map((moduleItem) => {
                  const isActive = pathname === moduleItem.path || pathname.startsWith(`${moduleItem.path}/`)

                  return (
                    <Link
                      key={moduleItem.path}
                      href={moduleItem.path}
                      className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                        isActive
                          ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                      )}
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                          isActive ? 'bg-gradient-to-br from-slate-500 to-slate-700 text-white border-slate-600' : moduleItem.colorClass
                        }`}
                      >
                        {moduleItem.iconLabel || 'MD'}
                      </span>
                      <span title={moduleItem.label} className="truncate text-[14px] font-extrabold">{moduleItem.label}</span>
                      <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                        isActive
                          ? 'bg-[#B98A34] opacity-100'
                          : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                      }`} />
                    </Link>
                  )
                })}

                {/* Kullanıcılar Alt Menüsü */}
                {canViewAnyPath(['/users', '/settings/user-permissions']) && (
                <div className="space-y-0.5">
                  {canViewPath('/users') && (
                    <Link
                      href="/users"
                      className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                        pathname.startsWith('/users') || isUserPermissionPage
                          ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {(pathname.startsWith('/users') || isUserPermissionPage) && (
                        <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                      )}
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                          pathname.startsWith('/users') || isUserPermissionPage ? 'bg-gradient-to-br from-indigo-500 to-blue-700 text-white border-indigo-600' : 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white border-indigo-500'
                        }`}
                      >
                        KU
                      </span>
                      <span title="Kullanıcılar" className="truncate text-[14px] font-extrabold">Kullanıcılar</span>
                      <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                        pathname.startsWith('/users') || isUserPermissionPage
                          ? 'bg-[#B98A34] opacity-100'
                          : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                      }`} />
                    </Link>
                  )}

                  {canViewPath('/settings/user-permissions') && (
                    <Link
                      href="/settings?tab=userPermissions"
                      className={`group relative ml-9 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-extrabold transition-all duration-200 ${
                        isUserPermissionPage
                          ? 'bg-indigo-50 text-indigo-700 shadow-sm'
                          : 'text-slate-500 hover:bg-slate-50 hover:text-indigo-700'
                      }`}
                    >
                      {isUserPermissionPage && (
                        <span className="absolute -left-[10px] h-5 w-1 rounded-r-full bg-indigo-600" />
                      )}
                      <span className={`h-1.5 w-1.5 rounded-full ${isUserPermissionPage ? 'bg-indigo-600' : 'bg-slate-300'}`} />
                      <span className="truncate">Kullanıcı Yetki</span>
                    </Link>
                  )}
                </div>
                )}

                {/* SQL Monitör Alt Menüsü */}
                {canViewPath('/sql-monitor') && (
                <Link
                  href="/sql-monitor"
                  className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                    pathname.startsWith('/sql-monitor')
                      ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {pathname.startsWith('/sql-monitor') && (
                    <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                  )}
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                      pathname.startsWith('/sql-monitor') ? 'bg-gradient-to-br from-cyan-500 to-sky-700 text-white border-cyan-600' : 'bg-gradient-to-br from-cyan-500 to-sky-600 text-white border-cyan-500'
                    }`}
                  >
                    SM
                  </span>
                  <span title="SQL Monitör" className="truncate text-[14px] font-extrabold">SQL Monitör</span>
                  <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                    pathname.startsWith('/sql-monitor')
                      ? 'bg-[#B98A34] opacity-100'
                      : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                  }`} />
                </Link>
                )}

                {/* Log Kayıtları İç Açılır Menüsü */}
                {canViewAnyPath(['/logs/history', '/logs/trash']) && (
                <details
                  className="group/logs"
                  open={openMenus.logs}
                  onToggle={(e) => {
                    const isOpen = e.currentTarget.open
                    setOpenMenus((prev) => ({ ...prev, logs: isOpen }))
                  }}
                >
                  <summary
                    className={`list-none outline-none cursor-pointer [&::-webkit-details-marker]:hidden relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                      pathname.startsWith('/logs')
                        ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {pathname.startsWith('/logs') && (
                      <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                    )}
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                        pathname.startsWith('/logs') ? 'bg-gradient-to-br from-slate-500 to-slate-700 text-white border-slate-600' : 'bg-gradient-to-br from-slate-500 to-slate-600 text-white border-slate-500'
                      }`}
                    >
                      LG
                    </span>
                    <span title="Log Kayıtları" className="truncate text-[14px] font-extrabold flex-1 text-left">Log Kayıtları</span>
                    <svg
                      className="w-4 h-4 transition-transform duration-200 group-open/logs:rotate-180"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>

                  <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-1.5 pb-1">
                    {/* Log Kayıtları - İşlem Geçmişi */}
                    {canViewPath('/logs/history') && (
                    <Link
                      href="/logs/history"
                      className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                        pathname === '/logs/history' || pathname.startsWith('/logs/history/')
                          ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {(pathname === '/logs/history' || pathname.startsWith('/logs/history/')) && (
                        <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                      )}
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                          pathname === '/logs/history' || pathname.startsWith('/logs/history/') ? 'bg-gradient-to-br from-slate-500 to-slate-700 text-white border-slate-600' : 'bg-gradient-to-br from-slate-500 to-slate-600 text-white border-slate-500'
                        }`}
                      >
                        İG
                      </span>
                      <span title="İşlem Geçmişi" className="truncate text-[14px] font-extrabold">İşlem Geçmişi</span>
                      <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                        pathname === '/logs/history' || pathname.startsWith('/logs/history/')
                          ? 'bg-[#B98A34] opacity-100'
                          : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                      }`} />
                    </Link>
                    )}

                    {/* Log Kayıtları - Çöp Kutusu */}
                    {canViewPath('/logs/trash') && (
                    <Link
                      href="/logs/trash"
                      className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                        pathname === '/logs/trash' || pathname.startsWith('/logs/trash/')
                          ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {(pathname === '/logs/trash' || pathname.startsWith('/logs/trash/')) && (
                        <span className="absolute -left-[10px] h-6 w-1 rounded-r-full bg-sky-600" />
                      )}
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 text-[10px] ${
                          pathname === '/logs/trash' || pathname.startsWith('/logs/trash/') ? 'bg-gradient-to-br from-slate-500 to-slate-700 text-white border-slate-600' : 'bg-gradient-to-br from-slate-500 to-slate-600 text-white border-slate-500'
                        }`}
                      >
                        ÇK
                      </span>
                      <span title="Çöp Kutusu / Geri Al" className="truncate text-[14px] font-extrabold">Çöp Kutusu / Geri Al</span>
                      <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                        pathname === '/logs/trash' || pathname.startsWith('/logs/trash/')
                          ? 'bg-[#B98A34] opacity-100'
                          : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                      }`} />
                    </Link>
                    )}
                  </div>
                </details>
                )}
            </div>
          </details>
          )}

          {/* Diğer Modüller */}
          {otherModules.map((moduleItem) => {
            const isActive = pathname === moduleItem.path || pathname.startsWith(`${moduleItem.path}/`)

            return (
              <Link
                key={moduleItem.path}
                href={moduleItem.path}
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  isActive
                    ? 'bg-sky-50 text-[#0A5F67] shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 h-6 w-1 rounded-r-full bg-sky-600" />
                )}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-transform group-hover:scale-110 ${
                    isActive ? 'bg-gradient-to-br from-sky-500 to-blue-700 text-white border-sky-600' : moduleItem.colorClass
                  }`}
                >
                  <ModuleIcon icon={moduleItem.icon} className="h-4 w-4" />
                </span>
                <span title={moduleItem.label} className="truncate text-[15px] font-extrabold">{moduleItem.label}</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full transition-all ${
                  isActive
                    ? 'bg-[#B98A34] opacity-100'
                    : 'bg-slate-300 opacity-0 group-hover:opacity-100'
                }`} />
              </Link>
            )
          })}
        </div>
      </nav>

      {accessBlockedMessage && (
        <div className="border-t border-slate-100 bg-slate-50/50 p-4">
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold leading-5 text-rose-700">
            {accessBlockedMessage}
          </div>
        </div>
      )}

      {/* Kullanici istegi (Ekim 2026): kullanici bilgisi/"Profilim" ust menuden
          sidebar'in EN ALTINA tasindi. Tiklayinca header.tsx'teki Profilim
          modalini 'netsosyal:open-profile' olayiyla acar. */}
      {currentUser && (
        <div className="flex w-full shrink-0 items-center gap-1.5 border-t border-[#E2E5DE] bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('netsosyal:open-profile'))}
            title="Profilim"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-[#F1F3EF] dark:hover:bg-slate-800"
          >
            {currentUser.id && !avatarFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/users/${encodeURIComponent(currentUser.id)}/photo`}
                alt={currentUser.name}
                className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover shadow-sm dark:border-slate-600"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0E7C86] text-sm font-black text-white shadow-sm">
                {(currentUser.name || 'KU').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toLocaleUpperCase('tr-TR') ?? '').join('') || 'KU'}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-black text-[#16232B] dark:text-sky-300">{currentUser.name}</span>
              <span className="block truncate text-[11px] font-bold text-[#5B6B74] dark:text-slate-400">{currentUser.department}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            title={isLoggingOut ? 'Çıkılıyor...' : 'Çıkış Yap'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 disabled:cursor-wait disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-900/40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M18 12H9m9 0l-3-3m3 3l-3 3" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  )
}

