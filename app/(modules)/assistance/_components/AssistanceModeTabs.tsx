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
// Kullanici istegi (2026-10-14, Yardımlar kurumsal tur): "daha profesyonel
// ve kurumsal" - 4 farkli renkli dolgu (sky/emerald/amber/rose) yerine
// Dosya Yönetimi'nin dili: aktif sekme koyu lacivert (#1E2A38) zemin + altin
// alt cizgi. Sekme kimligi (Müracaat/Yardım Alanlar/Almayanlar/İptal)
// renkli NOKTA ile korunur; yazi boyutu (9. tur istegi) AYNI kaldi.
const tabActiveBgClasses: Record<string, string> = {
  muracaatlar: 'bg-[#1E2A38]',
  yardimlar: 'bg-[#1E2A38]',
  'yardim-almayanlar': 'bg-[#1E2A38]',
  'iptal-edilenler': 'bg-[#1E2A38]',
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
    <nav aria-label="Liste sekmeleri" className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_2px_rgba(16,30,43,0.05)] print:hidden">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        const dot = tabDotClasses[tab.id] ?? tabDotClasses.yardimlar
        const activeBg = tabActiveBgClasses[tab.id] ?? tabActiveBgClasses.yardimlar

        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border-b-[3px] px-5 py-2 text-[16px] font-bold uppercase tracking-wide transition',
              isActive
                ? `${activeBg} border-b-[#D4B26A] text-white shadow-sm`
                : 'border-b-transparent text-slate-700 hover:bg-slate-100 hover:text-[#1E2A38]',
            ].join(' ')}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${dot} ${isActive ? 'ring-2 ring-white/70' : ''}`} />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
