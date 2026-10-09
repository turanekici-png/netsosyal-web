import { AssistanceRequestListPage } from '../../../requests/_components/AssistanceRequestListPage'

export const dynamic = 'force-dynamic'

export default async function HazirYemekMuracaatlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceRequestListPage
      searchParams={searchParams}
      config={{
        title: 'Hazır Yemek Müracaatları',
        newButtonLabel: 'Yeni Hazır Yemek Müracaatı',
        sectionTitle: 'Hazır Yemek Müracaatları (Durumu = 0)',
        emptyMessage: 'Görüntülenecek hazır yemek müracaatı bulunamadı.',
        searchPlaceholder: 'Müracaat Eden, Etiket veya Açıklama ile ara...',
        routePath: '/assistance/hazir-yemek/muracaatlar',
        tableName: 'yrd_haziryemek',
        tableId: 'yrd_haziryemek_requests',
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
