export const USER_PERMISSIONS_SETTING_KEY = 'user_permissions';

// Bir islem yetkisi "Tam sureli" (kisitsiz) verilebilecegi gibi, opsiyonel
// olarak gunluk saat araligina ve/veya tarih araligina da baglanabilir.
// Ikisi de bos birakilirsa (obje var ama alanlari yoksa) fiilen "Tam sureli"
// ile aynidir. Alanlarin TAMAMI opsiyoneldir - sadece saat, sadece tarih
// veya ikisi birden ayarlanabilir.
export interface ActionPermissionSchedule {
  // "HH:MM" formatinda gunluk baslangic/bitis saati. Ikisi de doluysa her
  // gun bu saatler arasinda gecerlidir. bitis < baslangic ise (orn 22:00-06:00)
  // gece yarisini asan bir aralik olarak yorumlanir.
  timeStart?: string;
  timeEnd?: string;
  // "YYYY-MM-DD" formatinda yetkinin gecerli oldugu tarih araligi.
  dateStart?: string;
  dateEnd?: string;
}

// Bir kullanicinin PROGRAMA HIC GIREBILECEGI gun/saatleri kisitlar - islem
// bazli yetkilerden (ActionPermissionSchedule) FARKLI olarak burada tek bir
// kisit, kullanicinin OTURUM ACMASINI (ve zaten acik bir oturumdaysa devam
// eden her istegini) bir butun olarak kontrol eder. Ornek: "Cumartesi/Pazar
// giremesin" ya da "sadece 08:00-17:00 arasi girebilsin".
export interface LoginAccessSchedule {
  // Haftanin hangi gunlerinde girise izin verildigi - 0=Pazar, 1=Pazartesi,
  // ... 6=Cumartesi (JS Date.getDay() ile ayni). Tanimsiz/bos dizi = TUM
  // gunler serbest.
  allowedWeekdays?: number[];
  // "HH:MM" formatinda gunluk giris saat araligi (opsiyonel). Ikisi de
  // doluysa sadece bu saatler arasinda girise izin verilir.
  timeStart?: string;
  timeEnd?: string;
}

export interface UserPermissionConfig {
  userId: string;
  isActive?: boolean;
  isAdmin: boolean;
  allowedPages: string[];
  allowedActions: string[];
  // actionId -> zaman kisiti. Bir actionId burada yoksa (veya obje ise ama
  // alanlari bossa) o islem "Tam sureli" sayilir.
  actionSchedules?: Record<string, ActionPermissionSchedule>;
  // Kullanicinin programa giris yapabilecegi gun/saat kisiti. Tanimsizsa
  // kisit yoktur (her zaman girebilir).
  loginSchedule?: LoginAccessSchedule;
  // Kullanicinin YEREL AG DISINDAN (internet / uzak IP) VEYA MOBIL bir
  // cihazdan (telefon/tablet tarayicisi) programa girip kullanabilmesi.
  // Varsayilan KAPALI (tanimsiz = false): sadece acikca izin verilen
  // kullanici, masaustu + yerel ag disindan erisebilir. "Tam yetkili"
  // (isAdmin) veya HIC permissionConfig'i olmayan kullanicilar bu
  // kisittan MUAFtir. Hem giris aninda (app/api/auth/login) hem de
  // her istekte (lib/apiAuth.ts) kontrol edilir - masaustunde acilan
  // bir oturum telefona tasinsa bile aninda kesilir.
  allowRemoteMobileAccess?: boolean;
  // Onaya gonderilen bir yardim/talep bu kullaniciya (yetkiliye) ATANDIGINDA,
  // masaustu bildirimine (Web Push) EK OLARAK kullanicinin kendi kayitli
  // telefon numarasina (kullanicilar.telefon) da AYNI bildirimin WhatsApp
  // uzerinden gonderilip gonderilmeyecegini belirler. Varsayilan KAPALIdir -
  // sadece kullanici acikca isterse (Ayarlar > Kullanici Yetkileri) acilir.
  whatsappNotifications?: boolean;
}

export type UserPermissionsById = Record<string, UserPermissionConfig>;

export const USER_ACTION_PERMISSION_DEFINITIONS = [
  { id: 'documents.create', label: 'Dosya olusturma', group: 'Dosya islemleri' },
  { id: 'documents.update', label: 'Dosya guncelleme', group: 'Dosya islemleri' },
  { id: 'documents.delete', label: 'Dosya silme', group: 'Dosya islemleri' },
  { id: 'documents.status', label: 'Dosya durumu degistirme', group: 'Dosya islemleri' },
  { id: 'documents.nvi', label: 'Nufus sorgulama', group: 'Dosya islemleri' },
  { id: 'documents.print', label: 'Dosya yazdirma', group: 'Dosya islemleri' },
  { id: 'documents.sms', label: 'SMS gonderme', group: 'Dosya islemleri' },
  { id: 'documents.gulkart', label: 'Gulkart islemleri', group: 'Dosya islemleri' },
  { id: 'documents.attachments', label: 'Belge islemleri', group: 'Dosya islemleri' },
  { id: 'documents.evaluation', label: 'Tahkikat formu', group: 'Dosya islemleri' },
  // Inceleme formunun yeni eleme kriterli + otomatik puanlamali onay akisi -
  // "Inceleme formu" (documents.evaluation) doldurma yetkisi olan biri zaten
  // formu doldurabilir, bu SADECE yonetici onay/red aksiyonu icin ayri bir yetki.
  { id: 'documents.evaluationApprove', label: 'Tahkikat formu onaylama', group: 'Dosya islemleri' },
  // Tahkikat > Inceleme Raporlari penceresindeki "Uygun Gorus Iste" butonu -
  // bir yetkili personelden raporla ilgili gorus istenmesini saglar (bkz.
  // app/(modules)/documents/page.tsx ve app/api/documents/approval-requests).
  { id: 'documents.reportOpinion', label: 'Inceleme raporu - Uygun gorus isteme', group: 'Dosya islemleri' },
  // Kullanici istegi (14 Eylul 2026, 21. tur): "ev ziyareti raporunu sadece
  // yetki verdigimiz kullanicilar gorebilsin, yetkisi kapali olan HICBIR
  // SEKILDE goremesin". Once bu rapor icin AYRI bir yetki YOKTU - GET
  // /api/home-visits'in kendisi de HICBIR requireApiAccess kontrolu
  // yapmiyordu (bkz. route.ts) - herhangi bir oturumu olan kullanici
  // (dosya erisimi/yetkisi ne olursa olsun) herhangi bir dosyanin ev
  // ziyareti raporlarini okuyabilirdi. Bu yeni yetki hem UI'da (documents/
  // page.tsx "Ev Ziyareti" sekmesi/butonu canUseAction ile gizlenir) hem de
  // asil guvenlik siniri olan API'da (route.ts GET'e requireApiAccess
  // eklendi) kullanilir.
  { id: 'documents.homeVisits.view', label: 'Ev Ziyareti Raporu goruntuleme', group: 'Dosya islemleri' },
  { id: 'requests.create', label: 'Muracaat ekleme', group: 'Muracaat islemleri' },
  { id: 'requests.update', label: 'Muracaat guncelleme', group: 'Muracaat islemleri' },
  { id: 'requests.delete', label: 'Muracaat silme', group: 'Muracaat islemleri' },
  { id: 'assistance.create', label: 'Yardim ekleme', group: 'Yardim islemleri' },
  { id: 'assistance.update', label: 'Yardim guncelleme / iptal', group: 'Yardim islemleri' },
  { id: 'assistance.delete', label: 'Yardim silme', group: 'Yardim islemleri' },
  // Yazdirma yetkisi yardim TURUNE gore ayri ayri verilir - ör. saat 16:00
  // sonrasi kisitlanan bir personelin Gıda Bankası yazdirmasi kapansa bile
  // Ekmek yazdirmasinin acik kalmasi gerekebilir (kullanicinin acikca
  // istegi). Bu yuzden TEK bir "assistance.print" yerine her tur icin AYRI
  // bir islem tanimlanip, her birine BAGIMSIZ olarak zaman kisiti da
  // uygulanabilir (bkz. Ayarlar > Kullanici Yetkileri > Yardim islemleri).
  { id: 'assistance.print.ekmek', label: 'Ekmek yardimi yazdirma', group: 'Yardim islemleri' },
  { id: 'assistance.print.gida', label: 'Gida Bankasi yardimi yazdirma', group: 'Yardim islemleri' },
  { id: 'assistance.print.destekpaketi', label: 'Destek Paketi yardimi yazdirma', group: 'Yardim islemleri' },
  { id: 'assistance.print.haziryemek', label: 'Hazir Yemek yardimi yazdirma', group: 'Yardim islemleri' },
  { id: 'assistance.print.giyim', label: 'Giyim yardimi yazdirma', group: 'Yardim islemleri' },
  { id: 'assistance.print.donemdisigida', label: 'Donem Disi Gida yazdirma', group: 'Yardim islemleri' },
  { id: 'assistance.print.ayninakdi', label: 'Ayni/Nakdi yardim yazdirma', group: 'Yardim islemleri' },
  { id: 'assistance.print.diger', label: 'Diger yardim turlerini yazdirma', group: 'Yardim islemleri' },
  { id: 'assistance.print.override', label: 'Suresi gecmis yardimi istisnai yazdirma', group: 'Yardim islemleri' },
  // Kullanici istegi: Nakit Yardımı müracaatlarını Yardım Kriterleri
  // sınırlarına göre toplu/otomatik "Otomatik Red" yapan/geri alan işlem
  // (hem Müracaatlar listesindeki "Otomatik Red Kontrolü" butonu, hem de
  // dosya içindeki müracaat düzenleme penceresinde kriter aşıldığında/
  // altına dokuldugunde sessizce calisan otomatik durum degisikligi) -
  // SADECE bu yetkiye sahip kullanicilar tetikleyebilsin diye eklendi
  // (bkz. app/api/assistance/nakit/auto-reject/route.ts, documents/page.tsx).
  { id: 'assistance.autoReject', label: 'Nakit yardımı Otomatik Red kontrolü/uygulama', group: 'Yardim islemleri' },
  // Kullanici istegi (15 Eylul 2026, 39.-40. tur): Sosyal Asistan icin IKI
  // AYRI yetki - "Rapor Alma" (salt-okunur soru-cevap/rapor) ve "Veri
  // Islemleri" (ekleme/silme/duzeltme). Ikisi BIRBIRINDEN BAGIMSIZDIR - bir
  // kullaniciya sadece rapor, sadece yazma, ikisi birden ya da hicbiri
  // verilebilir (bkz. app/api/asistan/chat/route.ts - asistan.report HER
  // mesajdan once kontrol edilir; lib/services/aiAssistant.service.ts -
  // asistan.write SADECE yazma araclarinin sunulup sunulmayacagini belirler).
  { id: 'asistan.report', label: 'Sosyal Asistan - Rapor/Sorgu Alma', group: 'Sosyal Asistan' },
  // Alttaki gercek islem yetkisi (documents.create, assistance.create vb.)
  // zaten gerekir, bu SADECE "asistan uzerinden de yapabilsin mi" sorusuna
  // cevap verir (savunma derinligi: bir yonetici, bir kullanicinin UI'dan
  // dosya acabilmesini korurken asistan uzerinden acmasini KAPATABILIR).
  { id: 'asistan.write', label: 'Sosyal Asistan - Veri İşlemleri (ekleme/silme/düzeltme)', group: 'Sosyal Asistan' },
  { id: 'reports.view', label: 'Rapor goruntuleme', group: 'Raporlar' },
  { id: 'online.forms.manage', label: 'Online basvuru formlarini yonetme', group: 'Online Basvurular' },
  { id: 'online.forms.criteria', label: 'Online basvuru kriterlerini yonetme', group: 'Online Basvurular' },
  { id: 'online.forms.fields', label: 'Online basvuru form alanlarini yonetme', group: 'Online Basvurular' },
  { id: 'online.forms.intro', label: 'Online basvuru popup/bilgilendirme alanini yonetme', group: 'Online Basvurular' },
  // Kullanici istegi (2026-09-22, 3. tur): "Başvuru Sorgulama" aç/kapa
  // anahtari (bkz. app/api/online-applications/status-lookup-visibility) -
  // /onlinebasvuru sayfasindaki vatandasa acik sorgulama kartinin
  // gorunurlugunu kontrol eder. Digerlerinden (forms.manage/criteria/
  // fields/intro) BAGIMSIZ ayri bir yetki - bir kullaniciya SADECE bunu
  // verip formlari/kriterleri degistirmesine izin vermeden bu tek anahtari
  // yonetmesini saglayabilmek icin.
  { id: 'online.forms.statusLookup', label: 'Online basvuru sorgulama alanini acma/kapama', group: 'Online Basvurular' },
  { id: 'settings.update', label: 'Sistem ayarlarini degistirme', group: 'Yonetim' },
  { id: 'users.manage', label: 'Kullanici yonetimi', group: 'Yonetim' },
  { id: 'sql.manage', label: 'SQL monitoru ve veritabani islemleri', group: 'Yonetim' },
  // Ust menudeki WhatsApp baglanti durumu gostergesi/"Baglan" butonu VE
  // Ayarlar > Sistem Ayarlari > WhatsApp Web sekmesi (QR baglama, baglantiyi
  // kesme, gorunen ad degistirme) - bkz. app/api/whatsapp/status,connect,
  // logout,display-name. Daha once SADECE tam yetkili (admin) kullanabiliyordu
  // (requireAdminAccess) - artik admin olmayan bir kullaniciya da bu tek
  // islem AYRICA verilebilir, boylece kurumun paylasimli WhatsApp oturumunu
  // yonetme yetkisi delege edilebilir.
  { id: 'settings.whatsapp', label: 'WhatsApp baglanti durumu goruntuleme/yonetme', group: 'Yonetim' },
  // Kullanici istegi: Ana Sayfa'daki rapor kutularinin yerini/boyutunu
  // degistirebilme (surukle-birak duzenleme) SADECE bu yetkiye sahip
  // personelde acik olsun - digerleri kendi (varsa daha once kaydedilmis,
  // yoksa varsayilan) duzeni SADECE GORUR, degistiremez (bkz.
  // components/shared/DashboardGrid.tsx, app/api/dashboard-layout/route.ts).
  { id: 'dashboard.layout', label: 'Ana sayfa duzenini degistirme (surukle-birak)', group: 'Yonetim' },
];

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTimeOnly(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

// Bir islem yetkisinin, verilen (varsayilan: su anki) zamanda gecerli olup
// olmadigini kontrol eder. Hem sunucu tarafinda (lib/apiAuth.ts) hem de
// istemci tarafinda (canUseAction) AYNI fonksiyon kullanilir - boylece
// butonlarin gorunurlugu ile gercek API izni HER ZAMAN birebir tutarli olur.
export function isActionScheduleActive(
  schedule: ActionPermissionSchedule | undefined | null,
  now: Date = new Date(),
): boolean {
  if (!schedule) return true;

  if (schedule.dateStart) {
    const start = parseDateOnly(schedule.dateStart);
    if (start && now < start) return false;
  }

  if (schedule.dateEnd) {
    const end = parseDateOnly(schedule.dateEnd);
    if (end) {
      // Bitis tarihi dahil (o gunun sonuna kadar) gecerli olsun.
      end.setHours(23, 59, 59, 999);
      if (now > end) return false;
    }
  }

  if (schedule.timeStart && schedule.timeEnd) {
    const start = parseTimeOnly(schedule.timeStart);
    const end = parseTimeOnly(schedule.timeEnd);

    if (start && end) {
      const startMinutes = start.hours * 60 + start.minutes;
      const endMinutes = end.hours * 60 + end.minutes;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      if (startMinutes <= endMinutes) {
        // Ayni gun icinde normal bir aralik (orn 08:00 - 17:00).
        if (nowMinutes < startMinutes || nowMinutes > endMinutes) return false;
      } else {
        // Gece yarisini asan aralik (orn 22:00 - 06:00).
        if (nowMinutes < startMinutes && nowMinutes > endMinutes) return false;
      }
    }
  }

  return true;
}

// Bir zaman kisitinin fiilen "bos" (hicbir kisit tanimlanmamis => Tam sureli)
// olup olmadigini soyler - UI'da "Zaman araligi" secili ama hicbir alan
// doldurulmamissa "Tam sureli" ile ayni davranir, bu yuzden kaydederken/
// gosterirken ayirt etmek icin kullanilir.
export function isScheduleEmpty(schedule: ActionPermissionSchedule | undefined | null): boolean {
  if (!schedule) return true;
  return !schedule.timeStart && !schedule.timeEnd && !schedule.dateStart && !schedule.dateEnd;
}

// Kullanicinin su an (varsayilan: su anki zaman) programa giris yapmasina/
// oturumuna devam etmesine izin var mi kontrol eder. Hem login uc noktasinda
// (giris ANINDA engellemek icin) hem de requireApiAccess icinde (zaten acik
// bir oturumun, kisit saatine girince SONRAKI istekte kesilmesi icin) AYNI
// fonksiyon kullanilir.
export function isLoginAllowedNow(
  schedule: LoginAccessSchedule | undefined | null,
  now: Date = new Date(),
): boolean {
  if (!schedule) return true;

  if (schedule.allowedWeekdays && schedule.allowedWeekdays.length > 0) {
    if (!schedule.allowedWeekdays.includes(now.getDay())) return false;
  }

  if (schedule.timeStart && schedule.timeEnd) {
    const start = parseTimeOnly(schedule.timeStart);
    const end = parseTimeOnly(schedule.timeEnd);

    if (start && end) {
      const startMinutes = start.hours * 60 + start.minutes;
      const endMinutes = end.hours * 60 + end.minutes;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      if (startMinutes <= endMinutes) {
        if (nowMinutes < startMinutes || nowMinutes > endMinutes) return false;
      } else {
        // Gece yarisini asan aralik (orn 22:00 - 06:00).
        if (nowMinutes < startMinutes && nowMinutes > endMinutes) return false;
      }
    }
  }

  return true;
}

// Tum haftanin (7 gun) secili oldugu ya da hic gun secilmemis olmasi "gun
// kisiti yok" anlamina gelir - UI'da butonlarin baslangic durumunu (hepsi
// aktif) belirlemek icin kullanilir.
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function isLoginScheduleEmpty(schedule: LoginAccessSchedule | undefined | null): boolean {
  if (!schedule) return true;
  const hasWeekdayRestriction = !!schedule.allowedWeekdays && schedule.allowedWeekdays.length > 0 && schedule.allowedWeekdays.length < 7;
  return !hasWeekdayRestriction && !schedule.timeStart && !schedule.timeEnd;
}
