import { AssistanceRequestListPage } from '../../../requests/_components/AssistanceRequestListPage'

export const dynamic = 'force-dynamic'

// yrd_ayninakti tablosunun kolonlari (bkz.
// app/api/assistance/nakit/import/route.ts) - "dosyano" KASITLI OLARAK YOK:
// kullanici yeni muracaatlarda dosya numarasini bilmeyebilir. Bunun yerine
// "tckimlikno" alanindan, bu kisinin sistemde ZATEN kayitli bir dosyasi
// varsa, dosya otomatik olarak bulunup baglaniyor - yoksa bos kalir.
// "durumu", "durumutarih", "tahkikatpers", "topbirey", "medenihal" de
// KASITLI OLARAK sablonda YOK (kullanici istegiyle cikarildi); "durumu"
// gonderilmese bile sunucu tarafinda otomatik 0 (Yeni Müracaat) atanir.
const NAKIT_IMPORT_COLUMNS = [
  'tckimlikno', 'muracaateden', 'dogumtarihi', 'ceptel', 'iban', 'aylikgelir', 'mulkiyetbilgisi', 'aracbilgisi',
  'muracaattarihi', 'donem', 'etiket', 'miktar', 'muracaatnotu', 'muracaatozelkod',
  'durumuaciklama', 'asama', 'asamanotu', 'asamaozelkod',
]

export default async function NakitMuracaatlarPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string } & Record<string, string>>
}) {
  return (
    <AssistanceRequestListPage
      searchParams={searchParams}
      config={{
        title: 'Nakit Müracaatları',
        newButtonLabel: 'Yeni Nakit Müracaatı',
        sectionTitle: 'Nakit Müracaatları (Durumu = 0)',
        emptyMessage: 'Görüntülenecek nakit müracaatı bulunamadı.',
        searchPlaceholder: 'Müracaat Eden, TC No veya IBAN ile ara...',
        routePath: '/assistance/nakit/muracaatlar',
        tableName: 'yrd_ayninakti',
        tableId: 'yrd_nakit_requests',
        searchColumns: ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano'],
        personnelAssignConfig: {
          endpoint: '/api/assistance/nakit/personnel',
          label: 'Personel Ata',
        },
        copyConfig: {
          endpoint: '/api/assistance/nakit/copy',
          label: 'Kayıtları Kopyala',
          sourceStatus: 0,
        },
        investigationReportConfig: {
          endpoint: '/api/requests/nakit/investigation-reports',
          label: 'Toplu Tahkikat Raporu',
        },
        recordUpdateConfig: {
          endpoint: '/api/assistance/nakit/bulk-update',
          label: 'Güncelle',
          sourceStatus: 0,
        },
        // Kurumda dosyasi OLMAYAN bir muracaat sahibi icin, listede o kisiyi
        // secip sag-tik menusunden tek tikla yeni dosya acilabilmesi -
        // dosya siradaki numarayi alir, dosya sahibi "tipi=1/yakinligi=kendisi"
        // olur ve bu muracaat otomatik o dosyaya baglanir.
        createFileConfig: {
          endpoint: '/api/assistance/nakit/create-file',
          label: 'Yeni Dosya Oluştur',
        },
        // Kullanici istegi: "tabloda bulunan tüm veriler bu listede görünsün,
        // istediğimizi biz ekleyip kaldırabilelim" - hicbir sutun artik
        // ZORLA gizli degil, HEPSI (dosyaid, kullaniciid, islemtarihi vb.
        // dahil) "Sütun Ayarları" uzerinden kullanici tarafindan
        // acilip/kapatilabilir bir secenek olarak sunulur.
        excludedColumns: [],
        importConfig: {
          endpoint: '/api/assistance/nakit/import',
          columns: NAKIT_IMPORT_COLUMNS,
          title: 'Nakit Müracaatı Excel Aktarımı',
          description: 'Excel şablonunu indirip doldurun, sonra buradan yükleyin. Dosya numarası girmenize gerek yok — TC kimlik no sistemde kayıtlı bir dosyayla eşleşirse otomatik bağlanır, yeni müracaatlarda boş kalır.',
          templateFileName: `nakit-muracaat-sablon-${new Date().toISOString().slice(0, 10)}.xlsx`,
        },
        phoneFieldPriority: ['ceptel', 'dosya_telefonu', 'mur_telefon', 'telefon'],
      }}
    />
  )
}
