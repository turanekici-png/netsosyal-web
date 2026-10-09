import { AssistanceListPage } from '../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

export default function HazirYemekPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Hazir Yemek Alanlar Listesi',
        newButtonLabel: 'Yeni Hazir Yemek',
        routePath: '/assistance/hazir-yemek',
        tableName: 'yrd_haziryemek',
        tableId: 'yrd_haziryemek',
        whereClause: 't.durumu = 2',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
        searchPlaceholder: 'Muracaat eden, etiket, dosya no veya aciklama ara',
        emptyMessage: 'Goruntulenecek hazir yemek kaydi bulunamadi.',
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama', 'dnm_durumutarih', 'ensondonem'
        ],
      }}
    />
  )
}
