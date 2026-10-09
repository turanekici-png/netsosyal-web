'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { AssistanceModeTab } from './assistanceModeTabsConfig'

type AssistanceModeTabsProps = {
  basePath: string
  extraTabs?: AssistanceModeTab[]
  // "Yardımlar" sekmesinin varsayılan etiketini değiştirmek için (ör. Gıda/
  // Ekmek/Destek Paketi/Hazır Yemek modüllerinde "Yardım Alanlar" olarak
  // gösterilip, "Yardım Almayanlar" adında ayrı bir sekme daha eklenir -
  // bkz. ilgili modüllerin layout.tsx dosyaları). Diğer modülleri (Giyim,
  // Dönem Dışı Gıda, Nakit, Aceze) ETKİLEMEZ - onlar varsayılan "Yardımlar"
  // etiketiyle kalmaya devam eder.
  yardimlarLabel?: string
}

// Kullanici istegi (2026-09-30): "Yardımlar" alanindaki tum yardim turleri
// ve alt sekmeleri, Dosya Yönetimi sayfasinda yapilan "daha profesyonel/
// kurumsal" gorunum guncellemesiyle AYNI dile kavustursun - eskiden her
// sekme FARKLI bir renkte (mavi/yesil/amber/kirmizi) ve tam genislikte esit
// 3 blok halindeydi, bu hem dagitik/amator gorunuyordu hem de genis
// ekranlarda yazi/dugme oranlari asiri buyuyordu. Once "segmented control"
// deseniyle TEK renkli (lacivert) + kucuk nokta denendi.
// Kullanici istegi (7. tur, devam - CANLI ekran goruntusuyle): "sekmeleri
// biraz daha büyütüp renklendirelim" - aktif sekme artik KENDI rengini
// (nokta ile ayni renk ailesi) tasir, tek duz lacivert degil; yazi boyutu
// ve dolgu da bir kademe buyutuldu.
// Kullanici istegi (9. tur, devam - CANLI ekran goruntusuyle): "sekme
// başlıkları koyu renkte olsun, daha okunabilir olsun" - aktif zemin bir
// ton koyulastirildi (-600 -> -700), pasif yazi/nokta rengi de (soluk
// slate-600/200 yerine) daha koyu/kontrastli hale getirildi.
const tabDotClasses: Record<string, string> = {
  muracaatlar: 'bg-sky-500',
  yardimlar: 'bg-emerald-500',
  'yardim-almayanlar': 'bg-amber-500',
  'iptal-edilenler': 'bg-rose-500',
}
const tabActiveBgClasses: Record<string, string> = {
  muracaatlar: 'bg-sky-700',
  yardimlar: 'bg-emerald-700',
  'yardim-almayanlar': 'bg-amber-700',
  'iptal-edilenler': 'bg-rose-700',
}

export function AssistanceModeTabs({ basePath, extraTabs = [], yardimlarLabel = 'Yardımlar' }: AssistanceModeTabsProps) {
  const pathname = usePathname()
  const activeExtraTab = extraTabs.find((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
  const activeTab = pathname.includes('/muracaatlar') ? 'muracaatlar' : activeExtraTab?.id ?? 'yardimlar'
  const tabs = [
    { id: 'muracaatlar', label: 'Müracaatlar', href: `${basePath}/muracaatlar` },
    { id: 'yardimlar', label: yardimlarLabel, href: basePath },
    ...extraTabs,
  ]

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 p-1.5 print:hidden">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        const dot = tabDotClasses[tab.id] ?? tabDotClasses.yardimlar
        const activeBg = tabActiveBgClasses[tab.id] ?? tabActiveBgClasses.yardimlar

        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={[
              'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-[16px] font-black uppercase tracking-tight transition',
              isActive ? `${activeBg} text-white shadow-sm` : 'text-slate-800 hover:bg-slate-200 hover:text-slate-950',
            ].join(' ')}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${isActive ? 'bg-white' : dot}`} />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
