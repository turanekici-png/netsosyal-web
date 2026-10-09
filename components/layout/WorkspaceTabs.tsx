'use client'

import React from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { useOpenFiles } from '@/lib/context/OpenFilesContext'
import { MODULES_CONFIG } from '@/lib/constants/modules'

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

const getTabDedupeKey = (tab: { path: string; title: string }) => {
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

export const WorkspaceTabs: React.FC<{ canAccessDashboard?: boolean }> = ({ canAccessDashboard = true }) => {
  const { tabs, activeTabId, removeTab, setActiveTab } = useTabs()
  // Kullanici istegi (Ekim 2026): acilan her dosya, "Dosya Yönetimi"
  // sekmesinin YANINDA ayri bir sekme (dosya no + sahibi adi, digerlerinden
  // FARKLI renkte). Veri/aktif/kapatma mantigi documents/page.tsx'te
  // (OpenFilesContext ile kopruleniyor).
  const openFiles = useOpenFiles()
  const visibleTabs = React.useMemo(() => {
    const tabMap = new Map<string, typeof tabs[number]>()

    tabs.forEach((tab) => {
      const key = getTabDedupeKey(tab)
      const existing = tabMap.get(key)
      const normalizedTab = key === '/documents' ? { ...tab, id: 'tab:/documents', title: 'Dosya Yönetimi' } : tab

      if (!existing || tab.id === activeTabId) {
        tabMap.set(key, normalizedTab)
      }
    })

    return Array.from(tabMap.values())
  }, [activeTabId, tabs])

  // Kullanici istegi (Agustos 2026): acik dosya sekmeleri, modul sekmeleriyle
  // AYNI satirda (yatay kaydirilan) degil - modul sekmelerinin ALTINDA, hafif
  // icerlek AYRI bir satirda gorunsun ("Dosya Yönetimi"ne bagli alt sekmeler
  // hissi). Modul sekmesi satiri ile davranis/renk AYNEN korunur.
  const documentsTab = visibleTabs.find((tab) => getTabDedupeKey(tab) === '/documents')
  const showFileRow = Boolean(documentsTab) && openFiles.files.length > 0

  return (
    <div className="border-b border-[#E2E5DE] bg-[#F1F3EF] print:hidden dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900">
      {/* 1. SATIR: modul sekmeleri */}
      <div className={`flex items-center gap-1.5 overflow-x-auto px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4 sm:pt-3 ${showFileRow ? 'pb-0' : ''}`}>
        {/* Dashboard / Home Tab - sabit, hep en solda. Kullanici istegi
            (14 Eylul 2026, 12. tur): "yetkisi kapali olan sayfanin ...
            sekmesi ... gorunmesin" - Ana Sayfa yetkisi olmayan kullanicida
            bu sekme hic render edilmez. */}
        {canAccessDashboard && (
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`group relative flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2 py-1 !text-[12px] font-black transition-all whitespace-nowrap md:gap-2 md:px-3 md:py-2 ${
              activeTabId === 'dashboard'
                ? 'border-[#1E2A38] bg-[#1E2A38] text-white shadow-[0_-2px_8px_rgba(30,42,56,0.25)]'
                : 'border-[#D7DEE3] bg-[#EEF1F3] text-[#1E2A38] hover:bg-[#E2E8EC]'
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-lg transition-colors md:h-5 md:w-5 ${
                activeTabId === 'dashboard'
                  ? 'bg-white/20 text-white'
                  : 'bg-white/70 text-[#1E2A38]'
              }`}
            >
              <svg className="h-2.5 w-2.5 md:h-3 md:w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </span>
            Ana Sayfa
          </button>
        )}

        {/* Dynamic Tabs */}
        {visibleTabs.map((tab) => {
          const isActive = activeTabId === tab.id
          // Kullanici istegi (Agustos 2026): "Dosya Yönetimi" sekmesi SECILI
          // iken, altindaki acik dosya sekmeleriyle AYNI bronz/altin renkte
          // olsun (mavi degil) - iki satiri gorsel olarak birbirine baglar.
          const isDocs = getTabDedupeKey(tab) === '/documents'
          return (
          <div
            key={tab.id}
            className={`group relative flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2 py-1 !text-[12px] font-black transition-all cursor-pointer whitespace-nowrap md:gap-2 md:px-3 md:py-2 ${
              isActive
                ? isDocs
                  ? 'border-[#2A3B4D] bg-[#2A3B4D] text-white shadow-[0_-2px_8px_rgba(42,59,77,0.3)]'
                  : 'border-[#1E2A38] bg-[#1E2A38] text-white shadow-[0_-2px_8px_rgba(30,42,56,0.25)]'
                : isDocs
                  ? 'border-[#D7DEE3] bg-[#E4E8EA] text-[#2A3B4D] hover:bg-[#D7DEE3]'
                  : 'border-[#D7DEE3] bg-[#EEF1F3] text-[#1E2A38] hover:bg-[#E2E8EC]'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                isActive ? 'bg-white/80' : isDocs ? 'bg-[#2A3B4D]/50' : 'bg-[#1E2A38]/50'
              }`}
            />
            <span className="truncate max-w-[92px] md:max-w-[150px]">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeTab(tab.id)
              }}
              className={`rounded-full p-0.5 transition-colors ${
                isActive
                  ? 'text-white/70 hover:bg-white/15 hover:text-white'
                  : isDocs
                    ? 'text-[#2A3B4D]/70 hover:bg-[#2A3B4D]/15 hover:text-[#1E2A38]'
                    : 'text-[#1E2A38]/60 hover:bg-[#1E2A38]/15 hover:text-[#1E2A38]'
              }`}
            >
              <svg className="h-2.5 w-2.5 md:h-3 md:w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          )
        })}
      </div>

      {/* 2. SATIR: acik dosya sekmeleri (bronz/altin) - hafif icerlek, ayri satir */}
      {showFileRow && documentsTab && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-2 pb-0 pt-1.5 pl-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4 sm:pl-10">
          {openFiles.files.map((file) => {
            const isActiveFile = activeTabId === documentsTab.id && openFiles.activeKey === file.key
            return (
              <div
                key={`file:${file.key}`}
                onClick={() => {
                  if (activeTabId !== documentsTab.id) setActiveTab(documentsTab.id)
                  openFiles.select(file.key)
                }}
                title={`${file.fileNo} - ${file.name}`}
                className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border border-b-0 px-2 py-1 !text-[12px] font-bold transition-all whitespace-nowrap md:gap-2 md:px-3 md:py-1.5 ${
                  isActiveFile
                    ? 'border-[#2A3B4D] bg-[#2A3B4D] text-white shadow-[0_-2px_8px_rgba(42,59,77,0.3)]'
                    : 'border-[#D7DEE3] bg-[#E4E8EA] text-[#2A3B4D] hover:bg-[#D7DEE3]'
                }`}
              >
                <span className={`font-mono rounded-md px-1 py-0.5 !text-[12px] font-black leading-none tracking-tight md:px-1.5 ${isActiveFile ? 'bg-white/20 text-white' : 'bg-[#2A3B4D] text-white'}`}>{file.fileNo}</span>
                <span className={`truncate max-w-[110px] !text-[12px] font-bold md:max-w-[150px] ${isActiveFile ? 'text-white/90' : 'text-[#2A3B4D]'}`}>{file.name || '—'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openFiles.close(file.key)
                  }}
                  className={`rounded-full p-0.5 transition-colors ${isActiveFile ? 'text-white/70 hover:bg-white/15 hover:text-white' : 'text-[#2A3B4D]/70 hover:bg-[#2A3B4D]/15 hover:text-[#1E2A38]'}`}
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
