'use client'

import React from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { useOpenFiles } from '@/lib/context/OpenFilesContext'
import { MODULES_CONFIG } from '@/lib/constants/modules'
import { FORM_SEKMESI_RENK, formSekmesiTuru } from '@/lib/workflow/formSekmesi'

// 2026-10-15 kullanici istegi: sekmeler "biraz renklendirilsin" - her sekme
// kurumsal paletten kalici (yola gore) bir renk noktasi tasir.
const SEKME_RENKLERI = ['bg-[#0E7C86]', 'bg-[#1E5AA8]', 'bg-[#B8860B]', 'bg-[#8B2E4A]', 'bg-[#2F7D4F]', 'bg-[#6B4FA0]', 'bg-[#C2571A]']
const sekmeRengi = (key: string) => {
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return SEKME_RENKLERI[h % SEKME_RENKLERI.length]
}

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
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false)
  React.useEffect(() => {
    const onState = (event: Event) => setHeaderMenuOpen(Boolean((event as CustomEvent<{ open: boolean }>).detail?.open))
    window.addEventListener('netsosyal:header-menu-state', onState)
    return () => window.removeEventListener('netsosyal:header-menu-state', onState)
  }, [])
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
    <div className="dy-ws-tabs bg-gradient-to-b from-[#E3E9F0] to-[#D9E1EA] print:hidden dark:border-slate-800 dark:bg-slate-900 dark:from-slate-900 dark:to-slate-900">
      {/* 1. SATIR: modul sekmeleri */}
      <div className={`flex items-center gap-1.5 overflow-x-auto px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4 sm:pt-3 ${showFileRow ? 'pb-0' : ''}`}>
        {/* Dashboard / Home Tab - sabit, hep en solda. Kullanici istegi
            (14 Eylul 2026, 12. tur): "yetkisi kapali olan sayfanin ...
            sekmesi ... gorunmesin" - Ana Sayfa yetkisi olmayan kullanicida
            bu sekme hic render edilmez. */}
        {/* 2026-10-15 kullanici istegi: ust cubuk masaustunde kaldirildi -
            "İşlemler" menusu (tema, yazici, boyut, yakinlastirma, sol menu,
            WhatsApp durumu...) Ana Sayfa sekmesinin basindaki bu hamburger
            dugmesinden acilir. Menunun kendisi header.tsx'te yasar. */}
        <button
          type="button"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            window.dispatchEvent(new CustomEvent('netsosyal:toggle-header-menu', { detail: { top: rect.bottom, left: rect.left } }))
          }}
          aria-label="İşlemler menüsü"
          aria-expanded={headerMenuOpen}
          title="İşlemler"
          className={`relative z-[1001] mb-1 hidden h-9 w-10 shrink-0 items-center justify-center rounded-lg border border-[#1E2A38] border-b-[3px] border-b-[#D4B26A] text-[#D4B26A] shadow-[0_2px_6px_rgba(16,30,43,0.25)] transition lg:flex ${
            headerMenuOpen ? 'bg-[#2A3B4D] text-white' : 'bg-[#1E2A38] hover:bg-[#2A3B4D] hover:text-white'
          }`}
        >
          <span className="grid gap-[3px]">
            <span className="block h-0.5 w-[18px] rounded-full bg-current" />
            <span className="block h-0.5 w-[18px] rounded-full bg-current" />
            <span className="block h-0.5 w-[18px] rounded-full bg-current" />
          </span>
        </button>
        {canAccessDashboard && (
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`group relative -mb-px flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1.5 !text-[12.5px] transition-all whitespace-nowrap md:gap-2 md:px-3.5 md:py-2 md:!text-[14px] ${
              activeTabId === 'dashboard'
                ? 'is-active font-bold border-[#C9D3DD] bg-white text-[#1E2A38] shadow-[inset_0_3px_0_#D4B26A,0_-1px_4px_rgba(16,30,43,0.10)] dark:bg-slate-950 dark:text-slate-100'
                : 'font-bold border-[#CBD5E1]/70 bg-white/55 text-[#2A3B4D] hover:border-[#1E2A38]/30 hover:bg-white hover:text-[#1E2A38] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md transition-colors md:h-5 md:w-5 ${
                activeTabId === 'dashboard'
                  ? 'bg-[#D4B26A]/20 text-[#1E2A38]'
                  : 'text-[#0E7C86]'
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
          // 2026-10-15: is akisi form sekmeleri kendi renginde (Sonuç mavi,
          // Tahkikat turuncu, Ön İnceleme sari) - bkz. lib/workflow/formSekmesi.ts
          const formTuru = formSekmesiTuru(tab.path)
          const formRenk = formTuru ? FORM_SEKMESI_RENK[formTuru] : null
          return (
          <div
            key={tab.id}
            className={`group relative -mb-px flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1.5 !text-[12.5px] transition-all cursor-pointer whitespace-nowrap md:gap-2 md:px-3.5 md:py-2 md:!text-[14px] ${
              formRenk
                ? `${isActive ? `is-active font-bold ${formRenk.aktif}` : `font-bold ${formRenk.pasif}`}`
                : isActive
                ? 'is-active font-bold border-[#C9D3DD] bg-white text-[#1E2A38] shadow-[inset_0_3px_0_#D4B26A,0_-1px_4px_rgba(16,30,43,0.10)] dark:bg-slate-950 dark:text-slate-100'
                : 'font-bold border-[#CBD5E1]/70 bg-white/55 text-[#2A3B4D] hover:border-[#1E2A38]/30 hover:bg-white hover:text-[#1E2A38] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                formRenk ? (isActive ? 'bg-white' : formRenk.nokta) : isDocs ? 'bg-[#D4B26A]' : sekmeRengi(getTabDedupeKey(tab))
              } ${isActive && !formRenk ? 'ring-2 ring-[#D4B26A]/35' : ''}`}
            />
            <span className="truncate max-w-[92px] md:max-w-[150px]">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeTab(tab.id)
              }}
              className="rounded-full p-0.5 text-[#64748B] transition-colors hover:bg-rose-50 hover:text-rose-600"
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
        <div className="dy-ws-files flex items-center gap-1.5 overflow-x-auto border-t border-[#D5DDE2] bg-white px-2 py-1.5 pl-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4 sm:pl-10 dark:border-slate-800 dark:bg-slate-950">
          <span className="mr-1 hidden shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B] sm:inline">Açık Dosyalar</span>
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
                className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 !text-[12.5px] transition-all whitespace-nowrap md:gap-2 md:px-2.5 md:!text-[13.5px] ${
                  isActiveFile
                    ? 'is-active border-[#0E7C86] bg-[#E6F3F3] font-bold text-[#0A5F67]'
                    : 'border-[#D5DDE2] bg-white font-semibold text-[#334155] hover:border-[#0E7C86]/50'
                }`}
              >
                <span className={`rounded px-1.5 py-0.5 !text-[12px] font-bold leading-none tabular-nums ${isActiveFile ? 'bg-[#0E7C86] text-white' : 'bg-[#E3E9ED] text-[#1E2A38]'}`}>{file.fileNo}</span>
                <span className="truncate max-w-[120px] md:max-w-[180px]">{file.name || '—'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openFiles.close(file.key)
                  }}
                  className="rounded-full p-0.5 text-[#64748B] transition-colors hover:bg-rose-50 hover:text-rose-600"
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
      {/* 2026-10-14: sekmeler ile sayfa icerigi arasindaki bosluk yerine ince kurumsal renk cizgisi */}
      <div aria-hidden className="h-[3px] w-full bg-gradient-to-r from-[#0b1f3f] via-[#0E7C86] to-[#b8860b]" />
    </div>
  )
}
