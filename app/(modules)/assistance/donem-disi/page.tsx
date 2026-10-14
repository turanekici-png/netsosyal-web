import { AssistanceListPage } from '../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

export default function DonemDisiGidaYardimiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Dönem Dışı Gıda Listesi',
        newButtonLabel: 'Yeni Dönem Dışı Gıda',
        routePath: '/assistance/donem-disi',
        tableName: 'yrd_ddgidadosyali',
        tableId: 'yrd_ddgidadosyali',
        whereClause: 't.durumu != 0',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.nedeni', 'd.dosyano'],
        searchPlaceholder: 'Müracaat eden, neden, dosya no veya açıklama ara',
        emptyMessage: 'Görüntülenecek dönem dışı gıda kaydı bulunamadı.',
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama', 'dnm_durumutarih', 'ensondonem'
        ],
      }}
    />
  )
}
