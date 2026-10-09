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
        title: 'Donem Disi Gida Listesi',
        newButtonLabel: 'Yeni Donem Disi Gida',
        routePath: '/assistance/donem-disi',
        tableName: 'yrd_ddgidadosyali',
        tableId: 'yrd_ddgidadosyali',
        whereClause: 't.durumu != 0',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.nedeni', 'd.dosyano'],
        searchPlaceholder: 'Muracaat eden, neden, dosya no veya aciklama ara',
        emptyMessage: 'Goruntulenecek donem disi gida kaydi bulunamadi.',
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'donemadi', 'dnm_durumu', 'donemint', 'donemstr',
          'dnm_bastarih', 'dnm_durumuaciklama', 'dnm_durumutarih', 'ensondonem'
        ],
      }}
    />
  )
}
