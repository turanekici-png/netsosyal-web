import { AssistanceRequestListPage } from '../../../requests/_components/AssistanceRequestListPage'

export const dynamic = 'force-dynamic'

export default async function EkmekMuracaatlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceRequestListPage
      searchParams={searchParams}
      config={{
        title: 'Ekmek Müracaatları',
        newButtonLabel: 'Yeni Ekmek Müracaatı',
        sectionTitle: 'Ekmek Müracaatları (Durumu = 0)',
        emptyMessage: 'Görüntülenecek ekmek müracaatı bulunamadı.',
        searchPlaceholder: 'Müracaat Eden, Kart No veya Açıklama ile ara...',
        routePath: '/assistance/ekmek/muracaatlar',
        tableName: 'yrd_ekmek',
        tableId: 'yrd_ekmek_requests',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.kartno', 'd.dosyano'],
        excludedColumns: [
          'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama', 'dosyaid',
        ],
      }}
    />
  )
}
