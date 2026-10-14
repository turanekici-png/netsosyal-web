import { AssistanceListPage } from '../../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

// "Yardım Alanlar" (durumu = 2) dışında kalan, ama hâlâ bir müracaat aşamasını
// geçmiş (durumu != 0) tüm kayıtları gösterir: İptal Edildi, Yardımı
// Durduruldu, Durduruldu vb. - bkz. app/(modules)/assistance/gida/page.tsx
// (Yardım Alanlar) ve gida/layout.tsx (3 sekmeli üst menü).
export default function GidaYardimiAlmayanlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Gıda Yardımı Almayanlar Listesi',
        newButtonLabel: 'Yeni Gıda Yardımı',
        routePath: '/assistance/gida/yardim-almayanlar',
        tableName: 'yrd_gidabankasi',
        tableId: 'yrd_gidabankasi_almayanlar',
        whereClause: 't.durumu != 0 AND t.durumu != 2',
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
