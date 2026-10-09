import { AssistanceRequestListPage } from '../../../requests/_components/AssistanceRequestListPage'

export const dynamic = 'force-dynamic'

export default async function DonemDisiMuracaatlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceRequestListPage
      searchParams={searchParams}
      config={{
        title: 'Dönem Dışı Gıda Müracaatları',
        newButtonLabel: 'Yeni Dönem Dışı Gıda Müracaatı',
        sectionTitle: 'Dönem Dışı Gıda Müracaatları (Durumu = 0)',
        emptyMessage: 'Görüntülenecek dönem dışı gıda müracaatı bulunamadı.',
        searchPlaceholder: 'Müracaat Eden, Neden veya Açıklama ile ara...',
        routePath: '/assistance/donem-disi/muracaatlar',
        tableName: 'yrd_ddgidadosyali',
        tableId: 'yrd_ddgidadosyali_requests',
        searchColumns: ['t.muracaateden', 't.aciklama', 't.nedeni', 'd.dosyano'],
        excludedColumns: [
          'dosyaid', 'kullaniciid', 'ilkkullaniciid', 'islemtarihi', 'ilkislemtarihi',
          'durumuaciklama',
        ],
      }}
    />
  )
}
