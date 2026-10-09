import { AssistanceListPage } from '../../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

// "Yardım Alanlar" (durumu = 2) dışında kalan, ama hâlâ bir müracaat aşamasını
// geçmiş (durumu != 0) tüm kayıtları gösterir: İptal Edildi, Yardımı
// Durduruldu, Durduruldu vb. - bkz. app/(modules)/assistance/destek-paketi/page.tsx
// (Yardım Alanlar) ve destek-paketi/layout.tsx (3 sekmeli üst menü).
export default function DestekPaketiAlmayanlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Destek Paketi Almayanlar Listesi',
        newButtonLabel: 'Yeni Destek Paketi',
        routePath: '/assistance/destek-paketi/yardim-almayanlar',
        tableName: 'yrd_destekpaketi',
        tableId: 'yrd_destekpaketi_almayanlar',
        whereClause: 't.durumu != 0 AND t.durumu != 2',
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
