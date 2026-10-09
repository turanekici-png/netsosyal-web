import { AssistanceListPage } from '../../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

export default function NakitIptalEdilenlerPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'İptal Edilen Nakit Yardımları',
        newButtonLabel: 'Yeni Nakit Yardımı',
        routePath: '/assistance/nakit/iptal-edilenler',
        tableName: 'yrd_ayninakti',
        tableId: 'yrd_ayninakti_cancelled',
        whereClause: 't.durumu = 1',
        searchColumns: ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano'],
        searchPlaceholder: 'Müracaat eden, TC, IBAN veya dosya no ara',
        emptyMessage: 'Görüntülenecek iptal edilmiş nakit yardımı kaydı bulunamadı.',
        showSummary: false,
        personnelAssignConfig: {
          endpoint: '/api/assistance/nakit/personnel',
          label: 'Personel Ata',
        },
        copyConfig: {
          endpoint: '/api/assistance/nakit/copy',
          label: 'Kayıtları Kopyala',
          sourceStatus: 1,
        },
        recordUpdateConfig: {
          endpoint: '/api/assistance/nakit/bulk-update',
          label: 'Güncelle',
          sourceStatus: 1,
        },
        // Kullanici istegi: "tabloda bulunan tüm veriler bu listede görünsün,
        // istediğimizi biz ekleyip kaldırabilelim" - hicbir sutun artik
        // ZORLA gizli degil, HEPSI "Sütun Ayarları" uzerinden kullanici
        // tarafindan acilip/kapatilabilir bir secenek olarak sunulur.
        excludedColumns: [],
        phoneFieldPriority: ['ceptel', 'dosya_telefonu', 'mur_telefon', 'telefon'],
      }}
    />
  )
}
