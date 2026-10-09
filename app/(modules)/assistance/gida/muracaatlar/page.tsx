import { AssistanceRequestListPage } from '../../../requests/_components/AssistanceRequestListPage'

export const dynamic = 'force-dynamic'

export default async function GidaMuracaatlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceRequestListPage
      searchParams={searchParams}
      config={{
        title: 'Gıda Müracaatları',
        newButtonLabel: 'Yeni Gıda Müracaatı',
        sectionTitle: 'Gıda Müracaatları (Durumu = 0)',
        emptyMessage: 'Görüntülenecek gıda müracaatı bulunamadı.',
        searchPlaceholder: 'Müracaat Eden, Etiket veya Açıklama ile ara...',
        routePath: '/assistance/gida/muracaatlar',
        tableName: 'yrd_gidabankasi',
        tableId: 'yrd_gidabankasi_requests',
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
