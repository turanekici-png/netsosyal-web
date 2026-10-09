'use client'

import React, { Suspense, createContext, useContext, useState, useEffect, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { MODULES_CONFIG } from '../constants/modules'

export interface Tab {
  id: string
  title: string
  path: string
}

interface TabContextType {
  tabs: Tab[]
  activeTabId: string
  addTab: (tab: Omit<Tab, 'id'>) => void
  removeTab: (id: string) => void
  setActiveTab: (id: string) => void
}

const TabContext = createContext<TabContextType | undefined>(undefined)

const normalizeTitle = (title: string) => String(title || '').trim().toLocaleLowerCase('tr-TR')

const modulePaths = MODULES_CONFIG
  .map((moduleConfig) => moduleConfig.path.replace(/\/+$/, '') || '/')
  .sort((firstPath, secondPath) => secondPath.length - firstPath.length)

const moduleTitlesByPath = new Map(
  MODULES_CONFIG.map((moduleConfig) => [
    moduleConfig.path.replace(/\/+$/, '') || '/',
    normalizeTitle(moduleConfig.name),
  ])
)

const getTabKey = (path: string) => {
  const trimmedPath = String(path || '').trim()
  let pathname = trimmedPath.split('?')[0].split('#')[0]

  try {
    pathname = new URL(trimmedPath, 'http://local').pathname
  } catch {
    pathname = trimmedPath.split('?')[0].split('#')[0]
  }

  const normalizedPath = pathname.replace(/\/+$/, '') || '/'

  if (normalizedPath === '/documents' || normalizedPath.startsWith('/documents/')) {
    if (!normalizedPath.startsWith('/documents/all')) return '/documents'
  }

  const modulePath = modulePaths.find((candidatePath) => (
    normalizedPath === candidatePath || normalizedPath.startsWith(`${candidatePath}/`)
  ))
  if (modulePath) return modulePath

  return normalizedPath
}

const getTabDedupeKey = (tab: Pick<Tab, 'path' | 'title'>) => {
  const pathKey = getTabKey(tab.path)
  const title = normalizeTitle(tab.title)

  if (pathKey === '/documents') return '/documents'
  if (pathKey !== '/documents/all' && (title === 'dosya ara' || title.startsWith('dosya ara '))) return '/documents'

  const titleMatchedModulePath = modulePaths.find((modulePath) => {
    const moduleTitle = moduleTitlesByPath.get(modulePath)
    return Boolean(moduleTitle) && (title === moduleTitle || title === `${moduleTitle} listesi` || title === `${moduleTitle} ekle`)
  })
  if (titleMatchedModulePath && pathKey !== titleMatchedModulePath) return titleMatchedModulePath

  return pathKey
}

const createCanonicalTabId = (tab: Pick<Tab, 'path' | 'title'>) => `tab:${getTabDedupeKey(tab)}`

const getModuleTabTitle = (path: string) => {
  const pathname = String(path || '').split('?')[0].split('#')[0]
  const moduleInfo = MODULES_CONFIG.find(m => m.path === pathname)
  if (!moduleInfo) return ''

  if (moduleInfo.path === '/assistance/nakit') {
    return 'Nakit Yardım Listesi'
  }

  if (
    moduleInfo.path.startsWith('/assistance/') &&
    moduleInfo.path !== '/assistance/map' &&
    moduleInfo.path !== '/assistance/periyodik'
  ) {
    return `${moduleInfo.name} Listesi`
  }

  return moduleInfo.name
}

const normalizeTab = (tab: Tab): Tab => {
  const key = getTabDedupeKey(tab)

  if (key === '/documents') {
    return {
      ...tab,
      id: 'tab:/documents',
      title: 'Dosya Ara',
      path: getTabKey(tab.path) === '/documents' ? tab.path : '/documents',
    }
  }

  return {
    ...tab,
    id: createCanonicalTabId(tab),
  }
}

const isSameTabList = (firstTabs: Tab[], secondTabs: Tab[]) => (
  firstTabs.length === secondTabs.length
  && firstTabs.every((tab, index) => {
    const otherTab = secondTabs[index]
    return Boolean(otherTab) && tab.id === otherTab.id && tab.title === otherTab.title && tab.path === otherTab.path
  })
)

const dedupeTabs = (tabList: Tab[], preferredTabId?: string) => {
  const order: string[] = []
  const tabsByKey = new Map<string, Tab>()

  tabList.forEach((tab) => {
    const key = getTabDedupeKey(tab)
    const existingTab = tabsByKey.get(key)

    if (!existingTab) {
      order.push(key)
      tabsByKey.set(key, normalizeTab(tab))
      return
    }

    if (tab.id === preferredTabId || existingTab.id !== preferredTabId) {
      tabsByKey.set(key, normalizeTab(tab))
    }
  })

  return order.map((key) => tabsByKey.get(key)).filter((tab): tab is Tab => Boolean(tab))
}

// Sekme listesi sadece React state'inde tutuluyordu - sayfa yenilendiginde
// (F5) React yeniden mount olur ve `tabs` bos diziyle basliyordu. Ardindan
// sadece o an tarayici adres cubugunda olan URL'e karsilik gelen TEK bir
// sekme yeniden olusturuluyordu; digerleri (ör. daha once acilmis "Dosya
// Yönetimi" sekmesi, kullanici baska bir sekmeye gecip sayfayi
// yeniledi ise) tamamen kayboluyordu. sessionStorage'a yazip ilk
// render'da geri okuyarak bu sekmelerin yenilemeye dayanikli olmasini
// sagliyoruz - sessionStorage tarayici sekmesi/penceresi kapatilana kadar
// kalicidir, bu da "sayfayi yenile" senaryosu icin dogru kapsam.
const TAB_STORAGE_KEY = 'netsosyal:open-tabs'
const ACTIVE_TAB_STORAGE_KEY = 'netsosyal:active-tab-id'

const readStoredTabs = (): { tabs: Tab[]; activeTabId: string } | null => {
  if (typeof window === 'undefined') return null

  try {
    const storedTabsRaw = window.sessionStorage.getItem(TAB_STORAGE_KEY)
    if (!storedTabsRaw) return null

    const parsed = JSON.parse(storedTabsRaw)
    if (!Array.isArray(parsed)) return null

    const validTabs = parsed.filter((tab): tab is Tab => (
      Boolean(tab) && typeof tab.id === 'string' && typeof tab.title === 'string' && typeof tab.path === 'string'
    ))
    if (validTabs.length === 0) return null

    return {
      tabs: validTabs,
      activeTabId: window.sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || '',
    }
  } catch {
    // sessionStorage erisilemez olabilir (gizli sekme kisitlamalari, kota
    // dolu vb.) - sekme geri yukleme bir zorunluluk degil, sessizce yoksay.
    return null
  }
}

const writeStoredTabs = (tabs: Tab[], activeTabId: string) => {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabs))
    window.sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId)
  } catch {
    // bkz. yukarida - depolamaya yazilamamasi uygulamayi bozmamali.
  }
}

const TabRouteSync = ({
  onRouteChange,
}: {
  onRouteChange: (path: string) => void
}) => {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()

  useEffect(() => {
    onRouteChange(search ? `${pathname}?${search}` : pathname)
  }, [onRouteChange, pathname, search])

  return null
}

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const router = useRouter()
  const pathname = usePathname()
  const [currentPath, setCurrentPath] = useState(pathname)
  const blockedAutoAddPathRef = useRef<string | null>(null)
  const visibleTabs = dedupeTabs(tabs, activeTabId)
  const currentTabId = createCanonicalTabId({ title: '', path: currentPath })
  const visibleActiveTabId = activeTabId === 'dashboard' ? 'dashboard' : currentTabId
  const [isHydrated, setIsHydrated] = useState(false)

  // Sayfa yenilemesinden (F5) once acik olan sekmeleri sessionStorage'dan
  // geri yukler. Bilerek useState lazy-initializer YERINE effect icinde
  // yapiliyor - SSR'da sessionStorage yok, lazy initializer kullanilsaydi
  // sunucu render'i (bos sekme listesi) ile istemci hydration'i (dolu
  // sekme listesi) farkli cikar, React hydration hatasi verirdi. Effect
  // sadece istemcide, hydration TAMAMLANDIKTAN sonra calisir - bu yuzden
  // guvenli, bedeli sadece bir kare gecikmeli sekme gorunmesidir.
  useEffect(() => {
    const restored = readStoredTabs()
    if (restored) {
      setTabs(restored.tabs)
      if (restored.activeTabId) setActiveTabId(restored.activeTabId)
    }
    setIsHydrated(true)
  }, [])

  // Sekmeler degistikce sessionStorage'a yaz - ama sadece yukaridaki geri
  // yukleme TAMAMLANDIKTAN sonra. Aksi halde ilk render'daki (henuz geri
  // yuklenmemis) bos `tabs` durumu, geri yukleme fırsatı bulamadan
  // depolanan veriyi silerdi.
  useEffect(() => {
    if (!isHydrated) return
    writeStoredTabs(tabs, activeTabId)
  }, [isHydrated, tabs, activeTabId])

  useEffect(() => {
    queueMicrotask(() => {
      setTabs(prev => {
        const nextTabs = dedupeTabs(prev, activeTabId)
        if (isSameTabList(prev, nextTabs)) {
          return prev
        }

        const activeTabStillExists = nextTabs.some(tab => tab.id === activeTabId)
        if (!activeTabStillExists) {
          const currentTab = nextTabs.find(tab => getTabDedupeKey(tab) === getTabDedupeKey({ title: '', path: currentPath }))
          setActiveTabId(currentTab?.id ?? nextTabs[nextTabs.length - 1]?.id ?? '')
        }

        return nextTabs
      })
    })
  }, [activeTabId, currentPath])

  useEffect(() => {
    if (blockedAutoAddPathRef.current && blockedAutoAddPathRef.current !== currentPath) {
      blockedAutoAddPathRef.current = null
    }

    if (blockedAutoAddPathRef.current === currentPath) {
      return
    }

    if (pathname === '/' || pathname === '/dashboard') {
      queueMicrotask(() => setActiveTabId('dashboard'))
      return
    }

    if (getTabKey(currentPath) !== getTabKey(pathname)) {
      return
    }

    queueMicrotask(() => {
      setTabs(prev => {
        const currentTabs = dedupeTabs(prev, activeTabId)
        const existingTab = currentTabs.find(t => getTabDedupeKey(t) === getTabDedupeKey({ title: '', path: currentPath }))

        if (existingTab) {
          setActiveTabId(existingTab.id)
          const moduleTitle = getModuleTabTitle(pathname)
          const updatedTabs = currentTabs.map(tab => (
            tab.id === existingTab.id
              ? {
                  ...tab,
                  title: moduleTitle || tab.title,
                  path: tab.path !== currentPath ? currentPath : tab.path,
                }
              : tab
          ))
          return isSameTabList(prev, updatedTabs) ? prev : updatedTabs
        }

        const moduleInfo = MODULES_CONFIG.find(m => m.path === pathname)
        if (!moduleInfo) return isSameTabList(prev, currentTabs) ? prev : currentTabs

        const newTab: Tab = {
          id: createCanonicalTabId({ title: moduleInfo.name, path: currentPath }),
          title: getModuleTabTitle(pathname) || moduleInfo.name,
          path: currentPath
        }
        setActiveTabId(newTab.id)
        return dedupeTabs([...currentTabs, newTab], newTab.id)
      })
    })
  }, [activeTabId, currentPath, pathname])

  const addTab = (tabData: Omit<Tab, 'id'>) => {
    blockedAutoAddPathRef.current = null
    let targetPath = tabData.path

    setTabs(prev => {
      const currentTabs = dedupeTabs(prev, activeTabId)
      const existingTab = currentTabs.find(t => getTabDedupeKey(t) === getTabDedupeKey(tabData))

      if (existingTab) {
        setActiveTabId(existingTab.id)
        const updatedTabs = currentTabs.map(tab => (
          tab.id === existingTab.id ? { ...tab, title: tabData.title, path: tabData.path } : tab
        ))
        return isSameTabList(prev, updatedTabs) ? prev : updatedTabs
      }

      const newTab: Tab = {
        ...tabData,
        id: createCanonicalTabId(tabData)
      }
      targetPath = newTab.path
      setActiveTabId(newTab.id)
      return dedupeTabs([...currentTabs, newTab], newTab.id)
    })

    router.push(targetPath)
  }

  const removeTab = (id: string) => {
    const tabToRemove = visibleTabs.find(t => t.id === id)
    if (!tabToRemove) return

    const newTabs = visibleTabs.filter(t => t.id !== id)
    if (activeTabId === id || getTabDedupeKey(tabToRemove) === getTabDedupeKey({ title: '', path: currentPath })) {
      blockedAutoAddPathRef.current = tabToRemove.path
    }

    setTabs(newTabs)

    if (activeTabId === id) {
      if (newTabs.length > 0) {
        const lastTab = newTabs[newTabs.length - 1]
        setActiveTabId(lastTab.id)
        router.push(lastTab.path)
      } else {
        setActiveTabId('')
        // Kullanici istegi (Eylul 2026): "/" artik Dosya Yonetimi'ne
        // yonleniyor (bkz. app/page.tsx). "Ana Sayfa" sekmesi GERCEK
        // dashboard sayfasina (/dashboard) gitmeli - aksi halde tiklayinca
        // Dosya Yonetimi'ne geri sekiyordu.
        router.push('/dashboard')
      }
    }
  }

  const setActiveTab = (id: string) => {
    const tab = visibleTabs.find(t => t.id === id)
    if (tab) {
      setActiveTabId(id)
      router.push(tab.path)
    } else if (id === 'dashboard') {
      setActiveTabId('dashboard')
      // "/" -> Dosya Yonetimi yonlendirmesi yuzunden GERCEK sayfa (/dashboard).
      router.push('/dashboard')
    }
  }

  return (
    <TabContext.Provider value={{ tabs: visibleTabs, activeTabId: visibleActiveTabId, addTab, removeTab, setActiveTab }}>
      <Suspense fallback={null}>
        <TabRouteSync onRouteChange={setCurrentPath} />
      </Suspense>
      {children}
    </TabContext.Provider>
  )
}

export const useTabs = () => {
  const context = useContext(TabContext)
  if (!context) {
    throw new Error('useTabs must be used within a TabProvider')
  }
  return context
}
