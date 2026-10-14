import Link from 'next/link'
import { ReportPageHeader } from '@/components/shared/ReportPageHeader'
import { getAssistanceKicker } from '../_components/assistanceModeTabsConfig'
import { AcezeApplicationForm } from './AcezeApplicationForm'
import { AcezeRecordsList } from './AcezeRecordsList'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-10-14, Yardımlar kurumsal tur): Aceze sayfasi
// eskiden diger yardim sayfalarindan TAMAMEN farkli bir gorunumdeydi
// (gokmavi/yesil degrade + bulanik daireler). Artik diger yardim
// listeleriyle AYNI dil: lacivert kurumsal baslik + AssistanceModeTabs ile
// ayni sekme stili. Sekme baglantilari (?tab=new / ?tab=list) DEGISMEDI.
const ACEZE_TABS = [
  { id: 'new', label: 'Yeni Başvuru', href: '/assistance/aceze?tab=new', dot: 'bg-sky-500' },
  { id: 'list', label: 'Aceze Yardımları', href: '/assistance/aceze?tab=list', dot: 'bg-emerald-500' },
] as const

export default async function AcezeYardimiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; tab?: string; add?: string } & Record<string, string>>
}) {
  const params = await searchParams
  const activeTab = params.tab === 'list' ? 'list' : 'new'

  return (
    <div className="min-w-0 space-y-5">
      <ReportPageHeader
        eyebrow="Yardım Yönetimi"
        kicker={getAssistanceKicker('/assistance/aceze')}
        title={activeTab === 'new' ? 'Aceze Yardımı Başvurusu' : 'Aceze Yardımları Listesi'}
        subtitle={activeTab === 'new'
          ? 'Yeni aceze yardımı başvurusu oluşturun.'
          : 'Kayıtlı aceze yardımlarını görüntüleyin, arayın ve düzenleyin.'}
      />

      <nav aria-label="Aceze sekmeleri" className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_2px_rgba(16,30,43,0.05)] print:hidden">
        {ACEZE_TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border-b-[3px] px-5 py-2 text-[16px] font-bold uppercase tracking-wide transition',
                isActive
                  ? 'border-b-[#D4B26A] bg-[#1E2A38] text-white shadow-sm'
                  : 'border-b-transparent text-slate-700 hover:bg-slate-100 hover:text-[#1E2A38]',
              ].join(' ')}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${tab.dot} ${isActive ? 'ring-2 ring-white/70' : ''}`} />
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {activeTab === 'new' ? (
        <AcezeApplicationForm />
      ) : (
        <AcezeRecordsList searchParams={Promise.resolve(params)} />
      )}
    </div>
  )
}
