import { AssistanceRequestListPage } from '../../../requests/_components/AssistanceRequestListPage'

export const dynamic = 'force-dynamic'

export default async function DestekPaketiMuracaatlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceRequestListPage
      searchParams={searchParams}
      config={{
        title: 'Destek Paketi Müracaatları',
        newButtonLabel: 'Yeni Destek Paketi Müracaatı',
        sectionTitle: 'Destek Paketi Müracaatları (Durumu = 0)',
        emptyMessage: 'Görüntülenecek destek paketi müracaatı bulunamadı.',
        searchPlaceholder: 'Müracaat Eden, Etiket veya Açıklama ile ara...',
        routePath: '/assistance/destek-paketi/muracaatlar',
        tableName: 'yrd_destekpaketi',
        tableId: 'yrd_destekpaketi_requests',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama', 'dnm_durumutarih', 'ensondonem',
        ],
      }}
    />
  )
}
