'use client'

import { Suspense } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Header } from './header'
import { Sidebar } from './sidebar'
import { SidebarShell } from './SidebarShell'
import { WorkspaceTabs } from './WorkspaceTabs'
import { ScaledArea } from './ScaledArea'
import { ReminderDueNotifier } from './ReminderDueNotifier'
import { IdleLogout } from './IdleLogout'
import { F2SaveShortcut } from './F2SaveShortcut'
import { AsistanBubble } from './AsistanBubble'
import {
  USER_PERMISSIONS_SETTING_KEY,
  type UserPermissionConfig,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'
import { hasPageAccess, getPermissionPath, isKnownInternalPath, hasHizliSatisAccess } from '@/lib/constants/pageAccess'

// "/online" (form parametresiz) BILEREK KNOWN_INTERNAL_ROUTE_PREFIXES'te
// (bkz. lib/constants/pageAccess.ts) - o, ic yonetimdeki "Vatandaş Başvuru
// Listesi" raporudur (oturum gerektirir). "/online?form=..." ve
// "/onlinebasvuru" ayri, kendi "isPublicOnlineForm" kuraliyla HER ZAMAN
// bagimsiz render edilir - bu listeye eklenmelerine gerek yok/eklenmemeli.

function AccessDenied({ message }: { message: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center">
      <div className="max-w-lg rounded-xl border border-amber-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-lg font-black text-amber-700">
          !
        </div>
        <h1 className="mt-4 text-xl font-black text-slate-950">Yetkisiz Erişim</h1>
        <p className="mt-2 text-sm font-semibold text-slate-600">{message}</p>
      </div>
    </div>
  )
}

export function AppShell({
  children,
  forceStandalone = false,
}: {
  children: React.ReactNode
  /**
   * app/layout.tsx (sunucu bileseni) tarafindan, proxy.ts'in bu istegi
   * oturumsuz oldugu icin sessizce "Sayfa bulunamadı"ya cevirdigini
   * (rewrite) `headers()` ile okuyup ilettigi acik bayrak. true ise
   * asagidaki pathname tabanli mantigin TAMAMI atlanir ve sidebar/header
   * KESIN olarak gizlenir - "usePathname() rewrite hedefini degil
   * orijinal adresi dondurur" belirsizligine bagli KALMADAN.
   */
  forceStandalone?: boolean
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  // Kullanici istegi (Eylul 2026): masaustunde sol menu otomatik gizlensin,
  // ekran tam acilsin; fare sol kenara gelince menu acilsin. Tercih
  // tarayiciya ozel (localStorage) - ergonomik/cihaza bagli bir ayar.
  const [sidebarAutoHide, setSidebarAutoHide] = useState(false)
  const [sidebarRevealed, setSidebarRevealed] = useState(false)
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    try { setSidebarAutoHide(localStorage.getItem('netsosyal:sidebar-autohide') === '1') } catch { /* yoksay */ }
  }, [])
  const toggleSidebarAutoHide = useCallback(() => {
    setSidebarAutoHide((prev) => {
      const next = !prev
      try { localStorage.setItem('netsosyal:sidebar-autohide', next ? '1' : '0') } catch { /* yoksay */ }
      if (!next) setSidebarRevealed(false)
      return next
    })
  }, [])
  const openSidebarReveal = useCallback(() => {
    if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null }
    setSidebarRevealed(true)
  }, [])
  const closeSidebarReveal = useCallback(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    revealTimerRef.current = setTimeout(() => setSidebarRevealed(false), 200)
  }, [])
  useEffect(() => () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current) }, [])
  const [permissionConfig, setPermissionConfig] = useState<UserPermissionConfig | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<'loading' | 'ready'>('loading')
  const [accessBlockedMessage, setAccessBlockedMessage] = useState('')
  // Kullanici istegi (14 Eylul 2026, 3. tur -> 9. tur): "/onlinebasvuru"
  // bagimsiz, uygulamanin sidebar/header'i OLMADAN acilan bir sayfa olmali -
  // "/online" ile baslayan (form parametresiz TAM "/online" haric - o ic
  // yonetimdeki "Vatandaş Başvuru Listesi") HERHANGI bir alt yol/yazim
  // hatasi bu kapsamda.
  const isPublicOnlineForm =
    (pathname === '/online' && Boolean(searchParams.get('form'))) ||
    (pathname.toLowerCase().startsWith('/online') && pathname !== '/online')
  const isLoginPage = pathname === '/login'
  // 9. turda bulunan ek sorun: adres KISALTILARAK yazildiginda (ör. sadece
  // "/on") yukaridaki kural kacıyordu, cunku "/online ile BASLAYAN" kontrolu
  // sadece UZUN/fazladan yazim hatalarini yakalar. Kullanicinin net istegi:
  // "isimler tam uyusmuyorsa sayfa bulunamiyor desin ve acilmasin" - yani
  // DENYLIST yerine ALLOWLIST: SADECE gercekten var olan bir sayfa
  // yoluysa ic kabuk (sidebar/header) gosterilsin, geri kalan HER SEY -
  // ne kadar kisa/uzun/farkli yazilirsa yazilsin - bagimsiz "Sayfa
  // bulunamadı" olarak acilsin (bkz. KNOWN_INTERNAL_ROUTE_PREFIXES).
  const isUnrecognizedPath = !isPublicOnlineForm && !isLoginPage && !isKnownInternalPath(pathname)
  // 10. tur: oturumsuz istek proxy.ts tarafindan sessizce "Sayfa
  // bulunamadı"ya cevrilmisse (forceStandalone), pathname bilinen bir ic
  // sayfaya (ör. "/dashboard") esit olsa BILE sidebar KESIN olarak
  // gizlenir - bkz. app/layout.tsx.
  const renderStandalone = forceStandalone || isPublicOnlineForm || isLoginPage || isUnrecognizedPath
  const permissionPath = getPermissionPath(pathname, searchParams)
  // Kullanici istegi (2026-10-07, 4. tur): "/satis" artik iki ayri yolla
  // erisilebilir (bkz. hasHizliSatisAccess - YENI bagimsiz "/hizli-satis"
  // yetkisi VEYA ESKI genel "/muhasebe" yetkisi) - bu, SAYFAYI GOSTERME
  // kontrolu (sidebar gorunurlugu/yonlendirme DEGIL, asil "Yetkisiz Erişim"
  // kartini gosterip gostermeme karari) burada EKSIKTI: yonlendirme dogru
  // "/satis"a goturuyordu ama bu satir hala SADECE "/muhasebe"ye baktigi
  // icin sayfa acilir acilmaz "Yetkisiz Erişim" gosteriyordu.
  const canAccessCurrentPage = renderStandalone || (
    pathname === '/satis' ? hasHizliSatisAccess(permissionConfig) : hasPageAccess(permissionConfig, permissionPath)
  )

  useEffect(() => {
    if (renderStandalone) {
      setPermissionStatus('ready')
      return
    }

    let isCancelled = false

    const loadPermissions = async () => {
      setPermissionStatus('loading')
      setAccessBlockedMessage('')

      try {
        const userResponse = await fetch('/api/users/current', { cache: 'no-store' })
        const userPayload = await userResponse.json()

        if (userResponse.status === 403) {
          if (!isCancelled) {
            setPermissionConfig({ userId: '', isAdmin: false, isActive: false, allowedPages: [], allowedActions: [] })
            setAccessBlockedMessage(userPayload.error || 'Kullanıcı pasif durumda. Uygulama erişimi kapalı.')
          }
          return
        }

        const userId = String(userPayload?.data?.id ?? '')
        if (!userResponse.ok || !userId) return

        const permissionResponse = await fetch(`/api/settings/${USER_PERMISSIONS_SETTING_KEY}`, { cache: 'no-store' })
        if (permissionResponse.status === 404) {
          if (!isCancelled) setPermissionConfig(null)
          return
        }

        const permissionPayload = await permissionResponse.json()
        const permissions = permissionPayload?.data?.value as UserPermissionsById | undefined

        if (!isCancelled) {
          setPermissionConfig(permissions?.[userId] ?? null)
        }
      } catch {
        if (!isCancelled) setPermissionConfig(null)
      } finally {
        if (!isCancelled) setPermissionStatus('ready')
      }
    }

    void loadPermissions()

    return () => {
      isCancelled = true
    }
  }, [renderStandalone])

  if (renderStandalone) {
    return (
      <main className="h-full overflow-y-auto overflow-x-hidden bg-slate-100">
        <Suspense fallback={<div className="p-6 text-sm font-semibold text-slate-500">Yukleniyor...</div>}>
          {children}
        </Suspense>
      </main>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-100 dark:bg-slate-950">
      <ReminderDueNotifier />
      <IdleLogout />
      <F2SaveShortcut />
      {/* Kullanici istegi (2026-10-07): "/asistan" artik HERKESE ACIK
          degil (bkz. lib/constants/pageAccess.ts AYNI tarihli not) - bu
          yuzen baloncuk da ayni yetkiye tabi olmali, yoksa sidebar'daki
          baglanti gizlense bile buradan erisilebilirdi. */}
      {hasPageAccess(permissionConfig, '/asistan') && <AsistanBubble />}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Kullanici istegi (Agustos 2026): 7"/8"/9"/10" TABLETLERDE de sabit
            sidebar (288px) icerik alanini asiri daraltiyordu - kalici sidebar
            artik SADECE >= 1024px (lg: gercek masaustu / 10" yatay tablet).
            Altinda (tum tablet dikey + 7" yatay + telefon) hamburger cekmece.

            Genislik: kullanici istegi (Eylul 2026) once 288->240 (w-60)
            kucultuldu, sonra "buton icerikleri tam okunmuyor, saga dogru
            genislet" denildi -> 272px (w-68). Her ekran boyutunda SABIT
            kalir; genisleyen alani orta icerik alir. Yazi boyutu da
            buyutuldugu icin (bkz. globals.css .dy-sidebar) 272 -> 288px. */}
        {/* Masaustu sabit sidebar - dar ekranlarda (ör. 1360x768) icerikle
            orantili olarak kuculur, "Boyut" ayarini da uygular. Bkz.
            SidebarShell. */}
        <Suspense fallback={sidebarAutoHide ? null : <div className="hidden w-[288px] shrink-0 lg:block" />}>
          <SidebarShell
            autoHide={sidebarAutoHide}
            revealed={sidebarRevealed}
            onHoverEnter={openSidebarReveal}
            onHoverLeave={closeSidebarReveal}
          />
        </Suspense>
        {/* Fareyi ekranin sol kenarina getirince menuyu acan ince tetik
            seridi (sadece masaustu + otomatik gizle aciksa). */}
        {sidebarAutoHide && (
          <div
            className="fixed inset-y-0 left-0 z-[899] hidden w-2.5 lg:block"
            onMouseEnter={openSidebarReveal}
            onClick={openSidebarReveal}
            aria-hidden
          />
        )}
        <div
          className={`fixed inset-0 z-[5000] lg:hidden ${isMobileSidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
          aria-hidden={!isMobileSidebarOpen}
        >
          <button
            type="button"
            aria-label="Menuyu kapat"
            onClick={() => setIsMobileSidebarOpen(false)}
            className={`absolute inset-0 bg-slate-950/45 transition-opacity ${isMobileSidebarOpen ? 'opacity-100' : 'opacity-0'}`}
          />
          <div
            className={`absolute inset-y-0 left-0 w-[min(78vw,248px)] overflow-hidden rounded-r-2xl bg-white shadow-2xl transition-transform duration-300 ${
              isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Suspense fallback={null}>
              <Sidebar onNavigate={() => setIsMobileSidebarOpen(false)} />
            </Suspense>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            onMenuClick={() => setIsMobileSidebarOpen(true)}
            sidebarAutoHide={sidebarAutoHide}
            onToggleSidebarAutoHide={toggleSidebarAutoHide}
            permissionConfig={permissionConfig}
          />
          {/* Kullanici istegi (14 Eylul 2026, 12. tur): "yetkisi kapali olan
              sayfanin ... sekmesi de ... gorunmesin" - "Ana Sayfa" sekmesi
              eskiden HER ZAMAN sabit gorunuyordu (sidebar'daki "Ana Sayfa"
              linki ZATEN yetkiye gore gizleniyordu ama bu sekme ayri/
              hardcoded oldugu icin kacıyordu). AppShell zaten permissionConfig'i
              yukledigi icin ayri bir sorgu yapmadan buraya iletiliyor. */}
          <WorkspaceTabs canAccessDashboard={hasPageAccess(permissionConfig, '/dashboard')} />
          <main className="dy-main-safe relative flex-1 overflow-y-auto overflow-x-hidden px-2 pb-6 pt-3 sm:px-4 sm:pb-8 sm:pt-4 md:px-6 md:pb-10 md:pt-6">
            {/* NOT: onceki "max-w-[1600px]" sabit tavan, genis/buyuk
                monitorlerde (ör. 1920px ve uzeri) icerik alaninin ekranin
                tamamini doldurmayip kenarda BOS ALAN birakmasina yol
                aciyordu - kullanicinin "pencereyi buyutunce sidebar ile
                esit buyumuyor, kenarlarda bosluk oluyor" bildirdigi tam
                olarak buydu. Sidebar (nav rafi) zaten profesyonel
                uygulamalarda oldugu gibi SABIT genislikte kalmasi dogru
                (Notion/Gmail/Linear vb.) - asil sorun icerigin akiskan
                olmamasiydi. Tavan kaldirilip icerik mevcut tum genisligi
                dolduruyor. */}
            {/* KATMAN 0: SADECE sayfa icerigi olceklenir. Sidebar / Header /
                WorkspaceTabs bu <main>'in DISINDA kaldigi icin net kalir.
                Genis ekranda scale === 1 -> ScaledArea hicbir sey degistirmez. */}
            <ScaledArea className="mx-auto">
              <Suspense fallback={<div className="p-6 text-sm font-semibold text-slate-500">Yukleniyor...</div>}>
                {permissionStatus === 'loading' ? (
                  <div className="p-6 text-sm font-semibold text-slate-500">Yetkiler kontrol ediliyor...</div>
                ) : canAccessCurrentPage ? (
                  children
                ) : (
                  <AccessDenied message={accessBlockedMessage || 'Bu sayfayı görüntülemek için kullanıcı yetkiniz bulunmuyor.'} />
                )}
              </Suspense>
            </ScaledArea>
          </main>
        </div>
      </div>
    </div>
  )
}
