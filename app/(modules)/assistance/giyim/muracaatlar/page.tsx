import { AssistanceRequestListPage } from '../../../requests/_components/AssistanceRequestListPage'

export const dynamic = 'force-dynamic'

export default async function GiyimMuracaatlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceRequestListPage
      searchParams={searchParams}
      config={{
        title: 'Giyim Müracaatları',
        newButtonLabel: 'Yeni Giyim Müracaatı',
        sectionTitle: 'Giyim Müracaatları (Durumu = 0)',
        emptyMessage: 'Görüntülenecek giyim müracaatı bulunamadı.',
        searchPlaceholder: 'Müracaat Eden, Etiket veya Açıklama ile ara...',
        routePath: '/assistance/giyim/muracaatlar',
        tableName: 'yrd_giyim',
        tableId: 'yrd_giyim_requests',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama',
        ],
      }}
    />
  )
}
