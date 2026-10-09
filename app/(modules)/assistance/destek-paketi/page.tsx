import { AssistanceListPage } from '../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

export default function DestekPaketiYardimiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Destek Paketi Alanlar Listesi',
        newButtonLabel: 'Yeni Destek Paketi',
        routePath: '/assistance/destek-paketi',
        tableName: 'yrd_destekpaketi',
        tableId: 'yrd_destekpaketi',
        whereClause: 't.durumu = 2',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
        searchPlaceholder: 'Muracaat eden, etiket, dosya no veya aciklama ara',
        emptyMessage: 'Goruntulenecek destek paketi kaydi bulunamadi.',
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama', 'dnm_durumutarih', 'ensondonem'
        ],
      }}
    />
  )
}
