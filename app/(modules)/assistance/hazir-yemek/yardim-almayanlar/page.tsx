import { AssistanceListPage } from '../../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

// "Yardım Alanlar" (durumu = 2) dışında kalan, ama hâlâ bir müracaat aşamasını
// geçmiş (durumu != 0) tüm kayıtları gösterir: İptal Edildi, Yardımı
// Durduruldu, Durduruldu vb. - bkz. app/(modules)/assistance/hazir-yemek/page.tsx
// (Yardım Alanlar) ve hazir-yemek/layout.tsx (3 sekmeli üst menü).
export default function HazirYemekAlmayanlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Hazir Yemek Almayanlar Listesi',
        newButtonLabel: 'Yeni Hazir Yemek',
        routePath: '/assistance/hazir-yemek/yardim-almayanlar',
        tableName: 'yrd_haziryemek',
        tableId: 'yrd_haziryemek_almayanlar',
        whereClause: 't.durumu != 0 AND t.durumu != 2',
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
