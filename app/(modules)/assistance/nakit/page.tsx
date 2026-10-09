import { AssistanceListPage } from '../_components/AssistanceListPage'

export const dynamic = 'force-dynamic'

export default function NakitYardimiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceListPage
      searchParams={searchParams}
      config={{
        title: 'Nakit Yardım Listesi',
        newButtonLabel: 'Yeni Nakit Yardimi',
        routePath: '/assistance/nakit',
        tableName: 'yrd_ayninakti',
        tableId: 'yrd_ayninakti',
        whereClause: 't.durumu = 6',
        searchColumns: ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano'],
        searchPlaceholder: 'Muracaat eden, TC, IBAN veya dosya no ara',
        emptyMessage: 'Goruntulenecek nakit yardimi kaydi bulunamadi.',
        showSummary: false,
        personnelAssignConfig: {
          endpoint: '/api/assistance/nakit/personnel',
          label: 'Personel Ata',
        },
        copyConfig: {
          endpoint: '/api/assistance/nakit/copy',
          label: 'Kayitlari Kopyala',
          sourceStatus: 6,
        },
        recordUpdateConfig: {
          endpoint: '/api/assistance/nakit/bulk-update',
          label: 'Guncelle',
          sourceStatus: 6,
        },
        // Kullanici istegi: "tabloda bulunan tüm veriler bu listede görünsün,
        // istediğimizi biz ekleyip kaldırabilelim" - hicbir sutun artik
        // ZORLA gizli degil, HEPSI "Sütun Ayarları" uzerinden kullanici
        // tarafindan acilip/kapatilabilir bir secenek olarak sunulur.
        excludedColumns: [],
        // Kullanici istegi: toplu WhatsApp gonderiminde, dosyanin genel
        // telefonu yerine muracaatcinin NAKIT YARDIMI MURACAATI SIRASINDA
        // verdigi telefon (ceptel) ONCELIKLI kullanilsin.
        phoneFieldPriority: ['ceptel', 'dosya_telefonu', 'mur_telefon', 'telefon'],
      }}
    />
  )
}
