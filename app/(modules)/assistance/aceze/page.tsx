import Link from 'next/link'
import { AcezeApplicationForm } from './AcezeApplicationForm'
import { AcezeRecordsList } from './AcezeRecordsList'

export const dynamic = 'force-dynamic'

export default async function AcezeYardimiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; tab?: string; add?: string } & Record<string, string>>
}) {
  const params = await searchParams
  const activeTab = params.tab === 'list' ? 'list' : 'new'

  return (
    <div className="min-w-0 space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-sky-200/80 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-2 shadow-[0_12px_35px_-22px_rgba(2,132,199,0.8)]">
        <div className="pointer-events-none absolute -right-10 -top-14 h-32 w-32 rounded-full bg-emerald-300/20 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-14 left-1/4 h-28 w-28 rounded-full bg-sky-300/25 blur-2xl" />
        <div className="relative grid grid-cols-2 gap-2 sm:max-w-[560px]">
        <Link
          href="/assistance/aceze?tab=new"
          className={`rounded-xl px-3 py-3.5 text-center text-sm font-black transition-all ${activeTab === 'new' ? 'bg-gradient-to-r from-[#006ba6] to-[#0095cf] text-white shadow-lg shadow-sky-200' : 'bg-white/70 text-slate-600 hover:-translate-y-0.5 hover:bg-white hover:text-[#005f95] hover:shadow-md'}`}
        >
          Yeni Başvuru
        </Link>
        <Link
          href="/assistance/aceze?tab=list"
          className={`rounded-xl px-3 py-3.5 text-center text-sm font-black transition-all ${activeTab === 'list' ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-200' : 'bg-white/70 text-slate-600 hover:-translate-y-0.5 hover:bg-white hover:text-emerald-700 hover:shadow-md'}`}
        >
          Aceze Yardımları
        </Link>
        </div>
      </div>

      {activeTab === 'new' ? (
        <AcezeApplicationForm />
      ) : (
        <AcezeRecordsList searchParams={Promise.resolve(params)} />
      )}
    </div>
  )
}
