import { AssistanceListPage } from '../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

export default function GiyimYardimiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Giyim Yardimi Listesi',
        newButtonLabel: 'Yeni Giyim Yardimi',
        routePath: '/assistance/giyim',
        tableName: 'yrd_giyim',
        tableId: 'yrd_giyim',
        whereClause: 't.durumu != 0',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
        searchPlaceholder: 'Muracaat eden, etiket, dosya no veya aciklama ara',
        emptyMessage: 'Goruntulenecek giyim yardimi kaydi bulunamadi.',
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama', 'dnm_durumutarih', 'ensondonem'
        ],
      }}
    />
  )
}
