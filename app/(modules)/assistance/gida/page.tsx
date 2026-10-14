import { AssistanceListPage } from '../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

export default function GidaYardimiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Gıda Yardımı Alanlar Listesi',
        newButtonLabel: 'Yeni Gıda Yardımı',
        routePath: '/assistance/gida',
        tableName: 'yrd_gidabankasi',
        tableId: 'yrd_gidabankasi',
        whereClause: 't.durumu = 2',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.etiket', 'd.dosyano'],
        searchPlaceholder: 'Müracaat eden, etiket, dosya no veya açıklama ara',
        emptyMessage: 'Görüntülenecek gıda yardımı kaydı bulunamadı.',
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama', 'dnm_durumutarih', 'ensondonem'
        ],
      }}
    />
  )
}
