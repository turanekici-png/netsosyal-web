'use client'

import { Suspense, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTabs } from '@/lib/context/TabContext'
import { FormDesignRenderer } from '@/components/shared/FormDesignRenderer'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { SosyalAsistanPanel } from './SosyalAsistanPanel'
import { ApplicationStatusLookupToggle } from '@/app/online/ApplicationStatusLookupToggle'
import {
  DEFAULT_ONLINE_APPLICATION_FORMS,
  isFormCurrentlyPublished,
  normalizeOnlineApplicationCriteria,
  normalizeOnlineApplicationIntro,
  ONLINE_APPLICATION_FORMS_SETTING_KEY,
  type OnlineApplication,
  type OnlineApplicationCriteria,
  type OnlineApplicationIntro,
  type OnlineFormField,
} from '@/lib/constants/onlineApplicationForms'
import { MODULES_CONFIG } from '@/lib/constants/modules'
import { AUTHORIZED_PERSONNEL_SETTING_KEY, type AuthorizedPersonnelEntry } from '@/lib/constants/authorizedPersonnel'
import { WHATSAPP_SETTINGS_KEY, defaultWhatsappSettings, type WhatsappSettings } from '@/lib/constants/whatsappSettings'
import {
  ALL_WEEKDAYS,
  USER_ACTION_PERMISSION_DEFINITIONS,
  USER_PERMISSIONS_SETTING_KEY,
  isLoginScheduleEmpty,
  isScheduleEmpty,
  type ActionPermissionSchedule,
  type UserPermissionConfig,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'
import { findPredefinedCategoryByCandidates } from '@/lib/constants/predefinedValues'
import {
  buildKriterRowValue,
  buildYardimKriteriId,
  parseKriterRowValue,
  parseYardimKriteriId,
  YARDIM_KRITERI_KISI_BASI_MIKTAR_TUR,
} from '@/lib/nakitCriteria'

export const dynamic = "force-dynamic"

// Kullanici istegi (2026-09-22): "yayına çıkacağı tarih/saat ve yayından
// kalkacağı tarih/saat belirleyelim" - admin editorunde formun "Simdi"
// durumunu (yayinda / henuz baslamadi / suresi doldu / manuel kapali) tek
// bir yerden okunakli sekilde gostermek icin. isFormCurrentlyPublished ile
// AYNI mantigi kullanir, sadece kullaniciya gosterilecek metin/renk
// uretir.
function getPublishScheduleStatus(form: Pick<OnlineApplication, 'active' | 'publishStartAt' | 'publishEndAt'>) {
  if (!form.active) {
    return { label: 'Pasif (manuel olarak kapalı)', tone: 'slate' as const };
  }
  const now = new Date();
  if (form.publishStartAt) {
    const start = new Date(form.publishStartAt);
    if (!Number.isNaN(start.getTime()) && now < start) {
      return { label: `Henüz başlamadı — ${start.toLocaleString('tr-TR')} tarihinde yayına girecek`, tone: 'amber' as const };
    }
  }
  if (form.publishEndAt) {
    const end = new Date(form.publishEndAt);
    if (!Number.isNaN(end.getTime()) && now > end) {
      return { label: `Süresi doldu — ${end.toLocaleString('tr-TR')} tarihinde yayından kalktı`, tone: 'rose' as const };
    }
  }
  return { label: 'Şu anda yayında', tone: 'emerald' as const };
}

type TabType = 'nvi' | 'sms' | 'whatsapp' | 'sosyalAsistan' | 'general' | 'neighborhoods' | 'authorizedPersonnel' | 'online' | 'formDesign' | 'evaluationForm' | 'updateForm' | 'preliminaryReviewForm' | 'predefinedValues' | 'yardimKriterleri' | 'scheduledTasks' | 'databaseBackups' | 'personnelPerformance' | 'userPermissions';
type OnlineCriterionType = 'minAge' | 'uniqueAddressNo' | 'uniqueIdentity' | 'maxIncome' | 'maxVehicleModelYear' | 'maxAge';

const ONLINE_CRITERION_OPTIONS: Array<{
  type: OnlineCriterionType;
  label: string;
  enabledField: keyof OnlineApplicationCriteria;
  valueField?: keyof OnlineApplicationCriteria;
  defaultValue?: number;
  min?: number;
  widthClassName?: string;
  ariaLabel?: string;
}> = [
  {
    type: 'minAge',
    label: 'Belirlenen yaşın altındakiler başvuramasın',
    enabledField: 'minAgeEnabled',
    valueField: 'minAge',
    defaultValue: 18,
    min: 1,
    widthClassName: 'w-24',
    ariaLabel: 'Minimum yaş',
  },
  {
    type: 'uniqueAddressNo',
    label: 'Aynı adres no ile aynı forma ikinci başvuruyu engelle',
    enabledField: 'uniqueAddressNoEnabled',
  },
  {
    type: 'uniqueIdentity',
    label: 'Aynı TC kimlik no ile aynı forma ikinci başvuruyu engelle',
    enabledField: 'uniqueIdentityEnabled',
  },
  {
    type: 'maxIncome',
    label: 'Gelir üst sınırını aşanlar başvuramasın',
    enabledField: 'maxIncomeEnabled',
    valueField: 'maxIncome',
    defaultValue: 10000,
    min: 1,
    widthClassName: 'w-28',
    ariaLabel: 'Gelir üst sınırı',
  },
  {
    type: 'maxVehicleModelYear',
    label: 'Araç modeli üst sınırını aşanlar başvuramasın',
    enabledField: 'maxVehicleModelYearEnabled',
    valueField: 'maxVehicleModelYear',
    defaultValue: 2005,
    min: 1900,
    widthClassName: 'w-24',
    ariaLabel: 'Araç model üst sınırı',
  },
  {
    type: 'maxAge',
    label: 'Yaş üst sınırını aşanlar başvuramasın',
    enabledField: 'maxAgeEnabled',
    valueField: 'maxAge',
    defaultValue: 65,
    min: 1,
    widthClassName: 'w-24',
    ariaLabel: 'Yaş üst sınırı',
  },
];

const settingsHeaderByTab: Partial<Record<TabType, { eyebrow: string; title: string }>> = {
  online: { eyebrow: 'Vatandaş Başvuru Portalı', title: 'Online Başvuru Formları' },
  userPermissions: { eyebrow: 'Erişim Kontrolü', title: 'Kullanıcı Yetkileri' },
  nvi: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  sms: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  whatsapp: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  formDesign: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  evaluationForm: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  updateForm: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  preliminaryReviewForm: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  predefinedValues: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  scheduledTasks: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  databaseBackups: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  personnelPerformance: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  general: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  neighborhoods: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
  authorizedPersonnel: { eyebrow: 'Yönetim', title: 'Sistem Ayarları' },
}

interface NviCredentials {
  user: string;
  pass: string;
  useBridge: boolean;
  bridgeUrl?: string;
  bridgeToken?: string;
}

interface NviService {
  id: 'tcKimlik' | 'adres' | 'maviKart' | 'nufusKayit' | 'localDb';
  name: string;
  description: string;
  url: string;
  serviceName?: string;
  enabled: boolean;
}

interface PredefinedValue {
  id: string;
  name: string;
}

interface ReportBand {
  id: string;
  type: 'ReportTitle' | 'PageHeader' | 'MasterData' | 'PageFooter';
  name: string;
  height: number;
}

interface DesignBlock {
  id: string;
  bandId?: string;
  type: 'text' | 'variable' | 'barcode' | 'qrcode' | 'line';
  x: number;
  y: number;
  value: string;
  fontSize?: number;
  fontWeight?: string;
}

interface ReportField {
  token: string;
  label: string;
  source: string;
}

interface ReportFieldGroup {
  id: string;
  title: string;
  fields: ReportField[];
}

interface FormDesign {
  id: string;
  name: string;
  type: 'barcode' | 'a4' | 'label';
  linkedAssistance: string;
  width?: string;
  height?: string;
  content: string;
  bands?: ReportBand[];
  blocks?: DesignBlock[];
}

interface PredefinedValuesPayload {
  values: Record<string, PredefinedValue[]>;
  titles: Record<string, string>;
}

interface PredefinedValuesResponse {
  success: boolean;
  data?: PredefinedValuesPayload;
  error?: string;
}

type ScheduledSqlTaskType = 'daily' | 'weekly';

interface ScheduledSqlTask {
  id: number;
  name: string;
  query: string;
  scheduleType: ScheduledSqlTaskType;
  dayOfWeek: number | null;
  timeOfDay: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: 'idle' | 'success' | 'error';
  lastMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ScheduledSqlTaskForm {
  name: string;
  query: string;
  scheduleType: ScheduledSqlTaskType;
  dayOfWeek: number;
  timeOfDay: string;
  enabled: boolean;
}

interface ScheduledSqlTasksResponse {
  success: boolean;
  data?: ScheduledSqlTask[] | ScheduledSqlTask;
  error?: string;
}

type DatabaseBackupScheduleType = 'daily' | 'weekly';

interface DatabaseBackupSchedule {
  id: string;
  name: string;
  enabled: boolean;
  databaseNames: string[];
  scheduleType: DatabaseBackupScheduleType;
  dayOfWeek: number | null;
  timeOfDay: string;
  lastRunAt: string | null;
  lastStatus: 'idle' | 'success' | 'error';
  lastMessage: string | null;
}

interface DatabaseBackupSettings {
  backupDirectory: string;
  postgresBinDirectory: string;
  databaseName: string;
  databaseNames: string[];
  scheduleEnabled: boolean;
  scheduleType: DatabaseBackupScheduleType;
  dayOfWeek: number | null;
  timeOfDay: string;
  schedules: DatabaseBackupSchedule[];
  lastRunAt: string | null;
  lastStatus: 'idle' | 'success' | 'error';
  lastMessage: string | null;
}

interface DatabaseBackupFile {
  fileName: string;
  fullPath: string;
  databaseName: string;
  size: number;
  createdAt: string;
}

interface DatabaseBackupOption {
  name: string;
  label: string;
  isCurrent: boolean;
}

interface DatabaseBackupsResponse {
  success: boolean;
  data?: {
    settings: DatabaseBackupSettings;
    backups: DatabaseBackupFile[];
    databaseOptions?: DatabaseBackupOption[];
  };
  message?: string;
  error?: string;
}

interface FolderEntry {
  name: string;
  fullPath: string;
}

interface FolderPickerResponse {
  success: boolean;
  data?: {
    currentPath: string;
    parentPath: string | null;
    roots: FolderEntry[];
    directories: FolderEntry[];
  };
  error?: string;
}

interface PersonnelPerformanceUser {
  userName: string;
  total: number;
  daily: number;
  weekly: number;
  monthly: number;
  lastActivity: string | null;
}

interface PersonnelPerformanceBreakdown {
  userName: string;
  label: string;
  count: number;
}

interface PersonnelPerformanceRecent {
  userName: string;
  operationType: string;
  tableName: string;
  recordId: string;
  description: string;
  activityDate: string | null;
}

interface PersonnelPerformancePayload {
  users: PersonnelPerformanceUser[];
  categories: PersonnelPerformanceBreakdown[];
  operations: PersonnelPerformanceBreakdown[];
  fields: PersonnelPerformanceBreakdown[];
  recent: PersonnelPerformanceRecent[];
}

interface PersonnelPerformanceResponse {
  success: boolean;
  data?: PersonnelPerformancePayload;
  error?: string;
}

interface SettingResponse<T> {
  success: boolean;
  data?: {
    value?: T;
  };
  error?: string;
}

interface NeighborhoodRow {
  id: string;
  name: string | null;
  paymentDay: number | null;
  paymentEndDay: number | null;
}


interface NeighborhoodsResponse {
  success: boolean;
  data?: NeighborhoodRow[];
  error?: string;
}

interface GeneralSettings {
  institutionName: string;
  departmentName: string;
  address: string;
  phone1: string;
  phone2: string;
  email: string;
  website: string;
  printInstitutionName: string;
  printFooterText: string;
  defaultPreparedByUnit: string;
  barcodeInfoText: string;
  onlineApplicationInfoText: string;
  onlineApplicationSuccessMessage: string;
  // Kullanici istegi (2026-09-22, 2. tur): kontrolu buradan alinip Online
  // Başvurular yonetim sayfasina tasindi (bkz. app/online/
  // ApplicationStatusLookupToggle.tsx) - burada SADECE tur/varsayilan icin
  // duruyor, bu sayfanin "Değişiklikleri Kaydet" akisi diger alanlari
  // kaydederken bu alani YANLISLIKLA silmesin/eski degere dondurmesin diye.
  applicationStatusLookupEnabled: boolean;
  workingHours: string;
  logoDataUrl: string;
}

type SmsProviderId = 'mutlucell' | 'ileti' | 'netgsm';

interface SmsProviderSettings {
  enabled: boolean;
  senderTitle: string;
  apiUrl: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
  customerCode: string;
  testPhone: string;
  notes: string;
}

interface SmsMessageTemplate {
  id: string;
  title: string;
  text: string;
  active: boolean;
}

interface SmsIntegrationSettings {
  activeProvider: SmsProviderId;
  providers: Record<SmsProviderId, SmsProviderSettings>;
  templates: SmsMessageTemplate[];
}

interface SettingsUser {
  id: string;
  username?: string;
  name?: string;
  email?: string;
  status?: number;
}

interface UsersResponse {
  success: boolean;
  data?: SettingsUser[];
  error?: string;
}

const fixedPermissionPages = [
  { name: 'Ana Sayfa', path: '/' },
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Online Başvurular', path: '/online' },
  { name: 'Gülkart Listesi', path: '/gulkart/liste' },
  { name: 'Gülkart Rezerv', path: '/gulkart/rezerv' },
  { name: 'Ön İnceleme', path: '/workflow/on-inceleme' },
  { name: 'Tahkikat', path: '/workflow/tahkikat' },
  { name: 'Güncelleme', path: '/workflow/guncelleme' },
  { name: 'İnceleme Formları', path: '/workflow/sonuc' },
  { name: 'Mahalle Grupları', path: '/workflow/mahalle-gruplari' },
  { name: 'Kullanıcılar', path: '/users' },
  { name: 'Ayarlar', path: '/settings' },
  { name: 'Online Basvuru Form Ayarlari', path: '/settings/online' },
  { name: 'Kullanici Yetki Ayarlari', path: '/settings/user-permissions' },
  { name: 'İşlem Geçmişi', path: '/logs/history' },
  { name: 'Çöp Kutusu / Geri Al', path: '/logs/trash' },
  { name: 'Onay Bekleyenler', path: '/approval-queue' },
  // Kullanici istegi (2026-10-07): "Kurum İçi Mesaj", "Sosyal Asistan" ve
  // "Takvim ve Hatırlatıcı" eskiden HERKESE ACIKTI (kod icinde sabit
  // istisna, bkz. lib/constants/pageAccess.ts) - "sadece Hizli Satis/Dernek
  // İşlemleri'ne yetkili" tek-amacli hesaplarda bu istisna "sadece X'e
  // erissin" hedefini bozdugu icin KALDIRILDI, artik digerleri gibi
  // acikca verilmesi gereken normal birer sayfa yetkisi. Mevcut kisitli
  // kullanicilarin erisimi KAYBETMEMESI icin ayni degisiklikle BIRLIKTE
  // bir migration calistirildi (2026-10-07) - o anki tum kisitli
  // kullanicilarin allowedPages'ine bu ikisi ACIKCA eklendi.
  { name: 'Kurum İçi Mesaj', path: '/communication' },
  { name: 'Sosyal Asistan', path: '/asistan' },
  // "/takvim-hatirlatici": GERCEK bir Next.js sayfasi DEGIL (sidebar'daki
  // "Takvim ve Hatırlatıcı" butonu bir POPUP acar) - bu yuzden MODULES_
  // CONFIG'te degil, burada SANAL bir sayfa olarak. Daha once HICBIR yetki
  // kontrolu yoktu (herkese daima acikti).
  { name: 'Takvim ve Hatırlatıcı', path: '/takvim-hatirlatici' },
  // Kullanici istegi (2026-10-07, 3. tur): "sadece Hizli Satis'a yetkili
  // olsun" dedigimiz kullanicilarda hala sorun yasandi, "ayrı bir yetki
  // alanı eklemeliyiz" dendi - asagidaki KENDI BAGIMSIZ "/hizli-satis"
  // alani (digger sayfalardan BAGIMSIZ, "Muhasebe" anahtarina ihtiyac
  // DUYMAYAN) bu amaçla eklendi. Bu TEK BASINA isaretlenirse kullanici
  // Hizli Satis'a girebilir (hangi kasa/hesaba gore asagidaki alt
  // maddelere bakilir - hicbiri secili degilse SINIRSIZ, tum kasalar
  // gorunur). Kasa/isimli-kullanici alt maddelerinden biri isaretliyse
  // TEK BASINA bu da yeterlidir (bu ust kutuyu AYRICA isaretlemeye GEREK
  // YOK - "child implies parent" kuraliyla otomatik dahil olur, bkz.
  // lib/constants/pageAccess.ts), ama admin'in ne oldugunu NET gormesi
  // icin burada da acikca listelenir. Eski "/muhasebe" (Muhasebe modulu)
  // yetkisi olan kullanicilar da (bu yeni alan hic isaretlenmemis olsa
  // bile) GERIYE DONUK UYUMLULUK icin Hizli Satis'a girebilmeye devam eder
  // (bkz. lib/hizliSatisProxy.ts - proxy() fonksiyonundaki iki asamali kontrol).
  { name: 'Hızlı Satış - Giriş İzni', path: '/hizli-satis' },
  { name: 'Hızlı Satış - Kasa 1', path: '/hizli-satis/kasa1' },
  { name: 'Hızlı Satış - Kasa 2', path: '/hizli-satis/kasa2' },
  { name: 'Hızlı Satış - Kasa 3 (Giyim Kasası)', path: '/hizli-satis/kasa3' },
  { name: 'Hızlı Satış - Cari', path: '/hizli-satis/cari' },
  // Kullanici istegi (2026-10-07, 2. tur): "Kasa 1/2/3/Cari" sadece Hizli
  // Satis icindeki GENEL sistem girisleridir - ama Hizli Satis'in kendi ic
  // kullanici_yetki.py sisteminde (bkz. Kullanıcılar sayfasi) GERCEK, ISIMLI
  // hesaplar da var: "TURAN" (yonetici=1, HER SEYI goren tek tam yetkili
  // kullanici) ve "MUHASEBE" (Wolvox'tan aktarilmis, kasalardan daha genis
  // ama yonetici olmayan bir modul seti: alis faturasi, parti, muhasebe
  // arsivi, belgeler, fatura tasarimi, ayarlar). Bunlar da aynen kasalar
  // gibi SANAL sayfa olarak eklenir - isaretlenince o ISIMLI hesabin KENDI
  // (kullanici_yetki.py'deki) yetkileriyle, sifresiz giris yapilir (bkz.
  // HizliSatis app.py'deki kasa-girisi rotasi, artik KY.kullanicilari_listele()
  // ile TUM tanimli hesaplari - kasa/cari/isimli - tek listede degerlendirir).
  { name: 'Hızlı Satış - Muhasebe (isimli kullanıcı)', path: '/hizli-satis/muhasebe' },
  { name: 'Hızlı Satış - Turan (tam yetkili)', path: '/hizli-satis/turan' },
  // Kullanici istegi (2026-10-07): Dernek İşlemleri icin de, Hizli Satis'in
  // kasalari gibi, UYGULAMA İÇİNDEKİ sayfalara gore ayri yetki alanlari -
  // bunlar da GERCEK Next.js sayfalari DEGIL ("/dernek" altinda SANAL
  // alt-sayfalar, bkz. yukaridaki Hizli Satis notu ile AYNI mantik): hicbiri
  // isaretli degilse (eski kullanicilar) SINIRSIZ sayilir (tum sayfalar
  // gorunur), biri/bazilari isaretlenince Dernek İşlemleri SADECE o
  // sayfalarla sinirlanir (bkz. lib/hizliSatisProxy.ts -
  // resolveDernekAllowedSayfalar, "X-NetSosyal-Dernek-Sayfalar" basligi).
  { name: 'Dernek - Gelen Faturalar', path: '/dernek/gelen-faturalar' },
  { name: 'Dernek - Kesilen/Tekli Fatura', path: '/dernek/kesilen-faturalar' },
  { name: 'Dernek - Cari İşlemleri', path: '/dernek/cari' },
  { name: 'Dernek - Gelir/Gider Takibi', path: '/dernek/gelir-gider' },
  { name: 'Dernek - Kurban', path: '/dernek/kurban' },
  { name: 'Dernek - Wolvox Raporları', path: '/dernek/wolvox-raporlari' },
  { name: 'Dernek - Yönetim (Ayarlar/Kullanıcılar)', path: '/dernek/yonetim' },
];

// Kullanici istegi (14 Eylul 2026, 17. tur): 16. turdaki "Dosya Yönetimi
// kosulsuz herkese acik" degisikligi geri alindi - kullanici bu sayfayi da
// diger sayfalar gibi kullanici bazinda acip kapatabilmek istiyor.
const permissionPages = [
  ...MODULES_CONFIG.map((moduleConfig) => ({ name: moduleConfig.name, path: moduleConfig.path })),
  ...fixedPermissionPages,
].filter((page, index, allPages) => allPages.findIndex((item) => item.path === page.path) === index);

// "Görebileceği Sayfalar" listesi, kullanici yetki sayfasinda SOL
// SIDEBAR'daki ("components/layout/sidebar.tsx") acilir menu basliklariyla
// BIREBIR eslesecek sekilde renkli gruplar halinde gosteriliyor - boylece
// bir grubun ("Gülkart İşlemleri", "Yardımlar", "Raporlar", "İş Akışı",
// "Ayarlar" ...) basligindaki "Tümünü Seç/Temizle" butonuyla o sidebar
// basligi ALTINDAKI TÜM sayfalar tek seferde acilip kapatilabiliyor, ayni
// zamanda grup icindeki her sayfa da TEK TEK acilip kapatilabiliyor.
// Sayfalarin (permissionPages) kendi icinde bir "group" alani olmadigi
// icin path on-ekine gore burada siniflandiriliyor; cogu sayfa icin path
// on-eki sidebar grubuyla dogrudan orantili, ama birkac sayfa sidebar'da
// FARKLI bir baslik altinda gorunuyor - bunlar PAGE_GROUP_OVERRIDES ile
// elle duzeltiliyor:
//  - Periyodik Yardimlar / Yardim Dagilim Haritasi: path "/assistance" ile
//    baslasa da sidebar'da "Yardımlar" degil "Raporlar" acilir menusunde.
//  - Gulkart Hareketleri: path "/reports" ile baslasa da sidebar'da
//    "Raporlar" degil "Gülkart İşlemleri" acilir menusunde (ayni sayfa
//    Raporlar'da da linkleniyor ama admin panelinde TEK yerde, Gülkart
//    grubunda gorunmesi "Gülkart İşlemleri"ni tek seferde kapatabilmek
//    icin gerekli).
// Islemlerin (USER_ACTION_PERMISSION_DEFINITIONS) zaten kendi "group"
// alani var, o dogrudan kullanilir.
const GULKART_MOVEMENTS_PATH = '/reports/yardim-hareketleri';

const PAGE_GROUP_OVERRIDES: Record<string, string> = {
  '/assistance/periyodik': 'Raporlar',
  '/assistance/map': 'Raporlar',
  [GULKART_MOVEMENTS_PATH]: 'Gülkart İşlemleri',
  // Sidebar'da ayri bir acilir menu degil, "Yardımlar"la ilgili tek bir
  // sabit baglantidir (bkz. components/layout/sidebar.tsx) - yol
  // on-ekinden ("/approval-queue") herhangi bir grup kuralina uymadigi
  // icin elle "Yardımlar" grubuna atanir.
  '/approval-queue': 'Yardımlar',
  // Kullanici istegi (2026-10-07): bu ucu de "Genel" grubunda, Ana Sayfa/
  // Dashboard'un yaninda gorunsun (varsayilan kurala gore hicbiri
  // eslesmedigi icin "Diğer"e duserdi).
  '/communication': 'Genel',
  '/asistan': 'Genel',
  '/takvim-hatirlatici': 'Genel',
  // Kullanici istegi (2026-10-07): "Muhasebe" ve "Dernek İşlemleri" AYRI
  // alanlar (gruplar) olsun - Muhasebe altinda Hizli Satis'in kasa
  // sayfalari, Dernek İşlemleri altinda da Dernek'in kendi ic sayfalari
  // icin yetki verilsin (varsayilan kurala gore hicbiri eslesmedigi icin
  // ikisi de "Diğer"e duserdi - iki AYRI isimli grup olarak sabitlendi).
  '/muhasebe': 'Muhasebe',
  '/muhasebe/baglanti-ayarlari': 'Muhasebe',
  '/hizli-satis': 'Muhasebe',
  '/hizli-satis/kasa1': 'Muhasebe',
  '/hizli-satis/kasa2': 'Muhasebe',
  '/hizli-satis/kasa3': 'Muhasebe',
  '/hizli-satis/cari': 'Muhasebe',
  '/hizli-satis/muhasebe': 'Muhasebe',
  '/hizli-satis/turan': 'Muhasebe',
  '/dernek': 'Dernek İşlemleri',
  '/dernek/gelen-faturalar': 'Dernek İşlemleri',
  '/dernek/kesilen-faturalar': 'Dernek İşlemleri',
  '/dernek/cari': 'Dernek İşlemleri',
  '/dernek/gelir-gider': 'Dernek İşlemleri',
  '/dernek/kurban': 'Dernek İşlemleri',
  '/dernek/wolvox-raporlari': 'Dernek İşlemleri',
  '/dernek/yonetim': 'Dernek İşlemleri',
};

const PAGE_PERMISSION_GROUP_RULES: { group: string; test: (path: string) => boolean }[] = [
  // NOT (14 Eylul 2026, 16. tur): "/documents" artik bu listede (permissionPages)
  // hic gorunmuyor - kosulsuz her zaman erisilebilir oldugu icin ayri bir
  // grup kurali gerekmiyor (15. turdeki gecici "Genel" tasima geri alindi).
  { group: 'Genel', test: (path) => path === '/' || path === '/dashboard' },
  { group: 'Dosya ve Bireyler', test: (path) => path.startsWith('/documents') || path.startsWith('/beneficiary') || path.startsWith('/hakedis') },
  { group: 'Müracaatlar', test: (path) => path.startsWith('/requests') },
  { group: 'Yardımlar', test: (path) => path.startsWith('/assistance') },
  { group: 'Gülkart İşlemleri', test: (path) => path.startsWith('/gulkart') },
  { group: 'Online Başvurular', test: (path) => path.startsWith('/online') },
  { group: 'İş Akışı', test: (path) => path.startsWith('/workflow') },
  { group: 'Raporlar', test: (path) => path.startsWith('/reports') },
  { group: 'Ayarlar', test: (path) => path.startsWith('/users') || path.startsWith('/settings') || path.startsWith('/sql-monitor') || path.startsWith('/scheduled-tasks') || path.startsWith('/logs') },
];

function getPagePermissionGroup(path: string): string {
  return PAGE_GROUP_OVERRIDES[path] ?? PAGE_PERMISSION_GROUP_RULES.find((rule) => rule.test(path))?.group ?? 'Diğer';
}

// Gruplarin ekranda gorunme sirasi, sidebar'daki YUKARIDAN AŞAĞIYA gorsel
// sirayla AYNI olsun diye burada sabitleniyor (yoksa gruplar, permissionPages
// dizisindeki ilk-gorulme sirasina gore rastgele bir sirada cikiyordu -
// ornegin "Genel" en basta degil ortalarda bir yerde beliriyordu).
const PAGE_PERMISSION_GROUP_DISPLAY_ORDER = [
  'Genel',
  'Dosya ve Bireyler',
  'Yardımlar',
  'Raporlar',
  'Gülkart İşlemleri',
  'Online Başvurular',
  'İş Akışı',
  'Ayarlar',
  'Müracaatlar',
  'Muhasebe',
  'Dernek İşlemleri',
  'Diğer',
];

// Sabit renk paleti - her grup, ilk gorundugu sirayla listeden bir renk alir
// (sinifsiz döngü), boylece hem sayfa hem islem gruplari birbirinden farkli
// renklerle ayirt edilir. Tailwind JIT icin siniflar TAM METIN olarak burada
// yaziliyor (dinamik sablon string'i CALISMAZ).
const PERMISSION_GROUP_COLOR_THEMES = [
  { header: 'from-sky-600 to-blue-600', border: 'border-sky-200', bg: 'bg-sky-50/60', chipBg: 'bg-white/20', chipHover: 'hover:bg-white/30' },
  { header: 'from-emerald-600 to-teal-600', border: 'border-emerald-200', bg: 'bg-emerald-50/60', chipBg: 'bg-white/20', chipHover: 'hover:bg-white/30' },
  { header: 'from-amber-600 to-orange-600', border: 'border-amber-200', bg: 'bg-amber-50/60', chipBg: 'bg-white/20', chipHover: 'hover:bg-white/30' },
  { header: 'from-violet-600 to-purple-600', border: 'border-violet-200', bg: 'bg-violet-50/60', chipBg: 'bg-white/20', chipHover: 'hover:bg-white/30' },
  { header: 'from-rose-600 to-pink-600', border: 'border-rose-200', bg: 'bg-rose-50/60', chipBg: 'bg-white/20', chipHover: 'hover:bg-white/30' },
  { header: 'from-cyan-600 to-sky-600', border: 'border-cyan-200', bg: 'bg-cyan-50/60', chipBg: 'bg-white/20', chipHover: 'hover:bg-white/30' },
  { header: 'from-indigo-600 to-blue-600', border: 'border-indigo-200', bg: 'bg-indigo-50/60', chipBg: 'bg-white/20', chipHover: 'hover:bg-white/30' },
  { header: 'from-fuchsia-600 to-pink-600', border: 'border-fuchsia-200', bg: 'bg-fuchsia-50/60', chipBg: 'bg-white/20', chipHover: 'hover:bg-white/30' },
];

const groupedPermissionPages: Record<string, typeof permissionPages> = {};
for (const page of permissionPages) {
  const group = getPagePermissionGroup(page.path);
  if (!groupedPermissionPages[group]) {
    groupedPermissionPages[group] = [];
  }
  groupedPermissionPages[group].push(page);
}
// Sira, PAGE_PERMISSION_GROUP_DISPLAY_ORDER'daki sabit sirayla belirleniyor
// (sidebar'daki gorsel sirayla ayni); orada listelenmeyen (beklenmedik/
// ileride eklenebilecek) bir grup olursa en sona eklenir, kaybolmaz.
const permissionPageGroupOrder: string[] = [
  ...PAGE_PERMISSION_GROUP_DISPLAY_ORDER.filter((group) => groupedPermissionPages[group]),
  ...Object.keys(groupedPermissionPages).filter((group) => !PAGE_PERMISSION_GROUP_DISPLAY_ORDER.includes(group)),
];

const permissionActionGroupOrder: string[] = [];
const groupedPermissionActions: Record<string, typeof USER_ACTION_PERMISSION_DEFINITIONS> = {};
for (const action of USER_ACTION_PERMISSION_DEFINITIONS) {
  if (!groupedPermissionActions[action.group]) {
    groupedPermissionActions[action.group] = [];
    permissionActionGroupOrder.push(action.group);
  }
  groupedPermissionActions[action.group].push(action);
}

// Giris izni (Pzt->Paz sirayla) - "day" degeri JS Date.getDay() ile ayni
// (0=Pazar). Turkce haftada Pazartesi ilk gorunecek sekilde sirali.
const LOGIN_WEEKDAY_LABELS: { day: number; label: string }[] = [
  { day: 1, label: 'Pzt' },
  { day: 2, label: 'Sal' },
  { day: 3, label: 'Çar' },
  { day: 4, label: 'Per' },
  { day: 5, label: 'Cum' },
  { day: 6, label: 'Cmt' },
  { day: 0, label: 'Paz' },
];

const GENERAL_SETTINGS_KEY = 'general_settings';
const SMS_INTEGRATION_SETTINGS_KEY = 'sms_integration_settings';

const defaultGeneralSettings: GeneralSettings = {
  institutionName: 'Sivas Belediyesi',
  departmentName: 'Sosyal Hizmetler Müdürlüğü',
  address: 'Sivas Belediyesi Sosyal Hizmetler Müdürlüğü',
  phone1: '',
  phone2: '',
  email: '',
  website: '',
  printInstitutionName: 'Sivas Belediyesi Sosyal Hizmetler Müdürlüğü',
  printFooterText: 'Bu belge sosyal yardım değerlendirme süreçleri için hazırlanmıştır.',
  defaultPreparedByUnit: 'Sosyal Hizmetler Müdürlüğü',
  barcodeInfoText: 'Belge doğrulama ve takip işlemleri için barkod/QR bilgisi kullanılabilir.',
  onlineApplicationInfoText: 'Başvurunuzun değerlendirilebilmesi için bilgilerinizi eksiksiz doldurun.',
  onlineApplicationSuccessMessage: 'Başvurunuz alınmıştır. Kurum personeli tarafından incelenecektir.',
  applicationStatusLookupEnabled: true,
  workingHours: 'Hafta içi 08:00 - 17:00',
  logoDataUrl: '/sivas-belediyesi-logo.png',
};

const defaultSmsProviderSettings: SmsProviderSettings = {
  enabled: false,
  senderTitle: '',
  apiUrl: '',
  username: '',
  password: '',
  apiKey: '',
  apiSecret: '',
  customerCode: '',
  testPhone: '',
  notes: '',
};

const defaultSmsMessageTemplates: SmsMessageTemplate[] = [
  {
    id: 'application_received',
    title: 'Başvuru Alındı',
    text: 'Sayın {adSoyad}, {dosyaNo} numaralı sosyal yardım başvurunuz alınmıştır. İnceleme sonucu tarafınıza bildirilecektir. {kurum}',
    active: true,
  },
  {
    id: 'missing_document',
    title: 'Eksik Evrak',
    text: 'Sayın {adSoyad}, {dosyaNo} numaralı dosyanızda eksik evrak bulunmaktadır. Detaylı bilgi için Sosyal Hizmetler Müdürlüğümüze başvurabilirsiniz. {kurum}',
    active: true,
  },
  {
    id: 'home_visit',
    title: 'Ev Ziyareti Bilgilendirme',
    text: 'Sayın {adSoyad}, sosyal yardım başvurunuz kapsamında adresinize hane incelemesi yapılacaktır. {kurum}',
    active: true,
  },
  {
    id: 'assistance_approved',
    title: 'Yardım Onaylandı',
    text: 'Sayın {adSoyad}, sosyal yardım başvurunuz uygun görülmüştür. Süreç hakkında tarafınıza ayrıca bilgi verilecektir. {kurum}',
    active: true,
  },
  {
    id: 'custom',
    title: 'Boş Mesaj',
    text: '',
    active: true,
  },
];

const defaultSmsIntegrationSettings: SmsIntegrationSettings = {
  activeProvider: 'mutlucell',
  providers: {
    mutlucell: {
      ...defaultSmsProviderSettings,
      apiUrl: 'https://smsgw.mutlucell.com/smsgw-ws/sndblkex',
    },
    ileti: {
      ...defaultSmsProviderSettings,
      apiUrl: 'https://api.iletibilgi.com.tr',
    },
    netgsm: {
      ...defaultSmsProviderSettings,
      apiUrl: 'https://api.netgsm.com.tr',
    },
  },
  templates: defaultSmsMessageTemplates,
};

const formatExternalUrl = (value?: string) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const weekdayOptions = [
  { value: 1, label: 'Pazartesi' },
  { value: 2, label: 'Salı' },
  { value: 3, label: 'Çarşamba' },
  { value: 4, label: 'Perşembe' },
  { value: 5, label: 'Cuma' },
  { value: 6, label: 'Cumartesi' },
  { value: 0, label: 'Pazar' },
];

const emptyScheduledTaskForm: ScheduledSqlTaskForm = {
  name: '',
  query: '',
  scheduleType: 'weekly',
  dayOfWeek: 1,
  timeOfDay: '09:00',
  enabled: true,
};

const defaultDatabaseBackupSettings: DatabaseBackupSettings = {
  backupDirectory: 'backups/database',
  postgresBinDirectory: '',
  databaseName: '',
  databaseNames: [],
  scheduleEnabled: false,
  scheduleType: 'daily',
  dayOfWeek: null,
  timeOfDay: '02:00',
  schedules: [],
  lastRunAt: null,
  lastStatus: 'idle',
  lastMessage: null,
};

const assistanceTemplateOptions = [
  'Tümü',
  'Dosya',
  'Aceze',
  'Ekmek',
  'Gıda Bankası',
  'Hazır Yemek',
  'Destek Paketi',
  'Giyim',
  'Diğer Kurum Yardımı',
];

const reportFieldGroups: ReportFieldGroup[] = [
  {
    id: 'dosya',
    title: 'Dosya Alanları',
    fields: [
      { token: 'dosya.id', label: 'Dosya ID', source: 'dosyalar.id' },
      { token: 'dosya.dosyano', label: 'Dosya No', source: 'dosyalar.dosyano' },
      { token: 'dosya.muracaat_tarihi', label: 'Müracaat Tarihi', source: 'dosyalar.muracaattarihi' },
      { token: 'dosya.durum', label: 'Dosya Durumu', source: 'dosyalar.durumu' },
      { token: 'dosya.mahalle', label: 'Mahalle', source: 'dosyalar.mahalleadi' },
      { token: 'dosya.cadde', label: 'Cadde', source: 'dosyalar.cadde' },
      { token: 'dosya.sokak', label: 'Sokak', source: 'dosyalar.sokak' },
      { token: 'dosya.site', label: 'Site', source: 'dosyalar.site' },
      { token: 'dosya.blok', label: 'Blok', source: 'dosyalar.blok' },
      { token: 'dosya.bina_no', label: 'Bina No', source: 'dosyalar.binano' },
      { token: 'dosya.daire_no', label: 'Daire No', source: 'dosyalar.daireno' },
      { token: 'dosya.adres', label: 'Açık Adres', source: 'dosyalar.adres' },
      { token: 'dosya.telefon', label: 'Telefon', source: 'dosyalar.telefon' },
      { token: 'dosya.adres_no', label: 'Adres No', source: 'dosyalar.adresno' },
      { token: 'dosya.kart_no', label: 'Kart No', source: 'dosyalar.kartno' },
      { token: 'dosya.toplam_birey', label: 'Toplam Birey', source: 'dosyalar.topbirey' },
      { token: 'dosya.aciklama', label: 'Dosya Açıklama', source: 'dosyalar.aciklama' },
      { token: 'dosya.konum_enlem', label: 'Konum Enlem', source: 'dosyalar.konum_enlem' },
      { token: 'dosya.konum_boylam', label: 'Konum Boylam', source: 'dosyalar.konum_boylam' },
    ],
  },
  {
    id: 'kisi_hane',
    title: 'Kişi ve Hane Alanları',
    fields: [
      { token: 'kisi.tc', label: 'T.C. Kimlik No', source: 'bireyler.tckimlikno' },
      { token: 'kisi.ad_soyad', label: 'Ad Soyad', source: 'bireyler.adisoyadi' },
      { token: 'kisi.dogum_tarihi', label: 'Doğum Tarihi', source: 'bireyler.dogumtarihi' },
      { token: 'kisi.cinsiyet', label: 'Cinsiyet', source: 'bireyler.cinsiyeti' },
      { token: 'kisi.yakinlik', label: 'Yakınlık', source: 'bireyler.yakinligi' },
      { token: 'kisi.medeni_hal', label: 'Medeni Hal', source: 'bireyler.medenihali' },
      { token: 'kisi.telefon', label: 'Cep Telefonu', source: 'bireyler.ceptel' },
      { token: 'kisi.iban', label: 'IBAN', source: 'bireyler.iban' },
      { token: 'hane.kisi_sayisi', label: 'Hane Kişi Sayısı', source: 'dosyalar.topbirey' },
      { token: 'hane.konut_turu', label: 'Konut Türü', source: 'dosyalar.konutturu' },
      { token: 'hane.isinma_turu', label: 'Isınma Türü', source: 'dosyalar.isinmaturu' },
      { token: 'hane.mulkiyet', label: 'Mülkiyet Durumu', source: 'dosyalar.mulkiyetdurumu' },
      { token: 'hane.kira', label: 'Kira Miktarı', source: 'dosyalar.kiramiktari' },
    ],
  },
  {
    id: 'yardim_ortak',
    title: 'Ortak Yardım Alanları',
    fields: [
      { token: 'yardim.id', label: 'Yardım ID', source: 'yrd_*.id' },
      { token: 'yardim.turu', label: 'Yardım Türü', source: 'seçili yardım' },
      { token: 'yardim.muracaat_eden', label: 'Müracaat Eden', source: 'yrd_*.muracaateden' },
      { token: 'yardim.muracaat_tarihi', label: 'Müracaat Tarihi', source: 'yrd_*.muracaattarihi' },
      { token: 'yardim.muracaat_aciklama', label: 'Müracaat Açıklama', source: 'yrd_*.muracaataciklama' },
      { token: 'yardim.bas_tarih', label: 'Başlangıç Tarihi', source: 'yrd_*.bastarih' },
      { token: 'yardim.bit_tarih', label: 'Bitiş Tarihi', source: 'yrd_*.bittarih' },
      { token: 'yardim.miktar', label: 'Miktar', source: 'yrd_*.miktar' },
      { token: 'yardim.durum', label: 'Yardım Durumu', source: 'yrd_*.durumu' },
      { token: 'yardim.durum_tarih', label: 'Durum Tarihi', source: 'yrd_*.durumutarih' },
      { token: 'yardim.durum_aciklama', label: 'Durum Açıklama', source: 'yrd_*.durumuaciklama' },
      { token: 'yardim.donem', label: 'Dönem', source: 'yrd_*.donem' },
      { token: 'yardim.donem_adi', label: 'Dönem Adı', source: 'yrd_*.donemadi' },
      { token: 'yardim.etiket', label: 'Etiket', source: 'yrd_*.etiket' },
      { token: 'yardim.aciklama', label: 'Yardım Açıklama', source: 'yrd_*.aciklama' },
    ],
  },
  {
    id: 'yardim_ozel',
    title: 'Yardım Türüne Özel Alanlar',
    fields: [
      { token: 'aceze.tc', label: 'Aceze T.C. Kimlik No', source: 'yrd_aceze.tckimlikno' },
      { token: 'aceze.ad_soyad', label: 'Aceze Ad Soyad', source: 'yrd_aceze.adisoyadi' },
      { token: 'aceze.baba_adi', label: 'Aceze Baba Adı', source: 'yrd_aceze.babaadi' },
      { token: 'aceze.ana_adi', label: 'Aceze Ana Adı', source: 'yrd_aceze.anaadi' },
      { token: 'aceze.dogum_yeri', label: 'Aceze Doğum Yeri', source: 'yrd_aceze.dogumyeri' },
      { token: 'aceze.dogum_tarihi', label: 'Aceze Doğum Tarihi', source: 'yrd_aceze.dogumtarihi' },
      { token: 'aceze.saglik_durumu', label: 'Aceze Sağlık Durumu', source: 'yrd_aceze.saglikdurumu' },
      { token: 'aceze.hastalik', label: 'Aceze Hastalık Adı', source: 'yrd_aceze.hastalikadi' },
      { token: 'aceze.gidecegi_yer', label: 'Aceze Gideceği Yer', source: 'yrd_aceze.gidecegiyer' },
      { token: 'aceze.neden', label: 'Aceze Nedeni', source: 'yrd_aceze.nedeni' },
      { token: 'ekmek.durak', label: 'Ekmek Durak Adı', source: 'yrd_ekmek.durakadi' },
      { token: 'ekmek.kart_no', label: 'Ekmek Kart No', source: 'yrd_ekmek.kartno' },
      { token: 'ekmek.kart_tarih', label: 'Ekmek Kart Tarih', source: 'yrd_ekmek.karttarih' },
      { token: 'ekmek.kart_aciklama', label: 'Ekmek Kart Açıklama', source: 'yrd_ekmek.kartaciklama' },
      { token: 'gida.odeme_gunu', label: 'Gıda Ödeme Günü', source: 'yrd_gidabankasi.odemegunu' },
      { token: 'gida.enson_donem', label: 'Gıda En Son Dönem', source: 'yrd_gidabankasi.ensondonem' },
      { token: 'haziryemek.kisi_sayisi', label: 'Hazır Yemek Kişi Sayısı', source: 'yrd_haziryemek.kisisayisi' },
      { token: 'haziryemek.ekmek_miktari', label: 'Hazır Yemek Ekmek Miktarı', source: 'yrd_haziryemek.ekmekmiktari' },
      { token: 'destekpaketi.odeme_gunu', label: 'Destek Paketi Ödeme Günü', source: 'yrd_destekpaketi.odemegunu' },
      { token: 'destekpaketi.enson_donem', label: 'Destek Paketi En Son Dönem', source: 'yrd_destekpaketi.ensondonem' },
      { token: 'giyim.miktar', label: 'Giyim Miktar', source: 'yrd_giyim.miktar' },
      { token: 'diger_kurum.kurum', label: 'Diğer Kurum Adı', source: 'yrd_digerkrmalyrdm.yardimalkrmadi' },
      { token: 'diger_kurum.yardim_turu', label: 'Diğer Kurum Yardım Türü', source: 'yrd_digerkrmalyrdm.yardimturu' },
    ],
  },
  {
    id: 'cikti',
    title: 'Çıktı ve Sistem Alanları',
    fields: [
      { token: 'cikti.tarih', label: 'Çıktı Tarihi', source: 'sistem' },
      { token: 'cikti.saat', label: 'Çıktı Saati', source: 'sistem' },
      { token: 'cikti.kullanici', label: 'Hazırlayan Kullanıcı', source: 'sistem' },
      { token: 'kurum.adi', label: 'Kurum Adı', source: 'ayarlar.kurumadi' },
      { token: 'kurum.adres', label: 'Kurum Adresi', source: 'ayarlar.adres' },
      { token: 'kurum.telefon', label: 'Kurum Telefonu', source: 'ayarlar.telefon1' },
      { token: 'barkod_no', label: 'Barkod No', source: 'üretilen değer' },
      { token: 'qr_dosya_url', label: 'Dosya QR', source: 'üretilen değer' },
    ],
  },
];

// Kullanici istegi: "Yardım Kriterleri" artik Hazır Değerler'in ICINDE
// degil, kendi AYRI sekmesinde ve DÖNEM BAZINDA AYRI PANELLERDE yonetiliyor
// - her panel bir dönemi (ya da dönemsiz "Tüm Dönemler/Genel" kriterleri)
// temsil eder, kendi Kriter Türü/Kriter Bilgisi satirlarina sahiptir. Veri
// hala AYNI "yardimKriterleri" Hazır Değerler kategorisinde, id alaninin
// "<Dönem>::<Kriter Türü>" bicimindeki KODLANMIS haliyle saklanir (bkz.
// lib/nakitCriteria.ts - parseYardimKriteriId/buildYardimKriteriId), boylece
// Otomatik Red kontrolündeki mevcut okuma mantigi DEGISMEDEN calismaya
// devam eder.
function YardimKriterleriTab({
  predefinedValues,
  setPredefinedValues,
  donemOptions,
}: {
  predefinedValues: Record<string, PredefinedValue[]>
  setPredefinedValues: Dispatch<SetStateAction<Record<string, PredefinedValue[]>>>
  donemOptions: PredefinedValue[]
}) {
  const CATEGORY = 'yardimKriterleri'
  const rows = predefinedValues[CATEGORY] ?? []
  const [newPanelDonem, setNewPanelDonem] = useState('')

  const groups = new Map<string, { index: number; val: PredefinedValue }[]>()
  rows.forEach((val, index) => {
    const { donem } = parseYardimKriteriId(val.id)
    const list = groups.get(donem) ?? []
    list.push({ index, val })
    groups.set(donem, list)
  })

  // Kullanici istegi: "Tüm Dönemler (Genel)" paneli KALDIRILDI - bundan
  // sonra yardim kriterleri SADECE belirli bir döneme bagli olarak
  // acilabilir/gorunur. (Alttaki findYardimKriteriValue'daki dönemsiz
  // "genel deger" fallback mantigi koda dokunulmadan durur - sadece bu UI
  // artik dönemsiz kayit OLUSTURMAYA izin vermez.)
  const panelDonems = Array.from(groups.keys()).filter((d) => d !== '').sort((a, b) => a.localeCompare(b, 'tr-TR'));

  const updateRow = (index: number, field: 'id' | 'name', value: string) => {
    setPredefinedValues(prev => ({
      ...prev,
      [CATEGORY]: (prev[CATEGORY] ?? []).map((item, i) => i === index ? { ...item, [field]: value } : item),
    }));
  };
  const removeRow = (index: number) => {
    setPredefinedValues(prev => ({
      ...prev,
      [CATEGORY]: (prev[CATEGORY] ?? []).filter((_, i) => i !== index),
    }));
  };
  const addRow = (donem: string) => {
    setPredefinedValues(prev => ({
      ...prev,
      [CATEGORY]: [...(prev[CATEGORY] ?? []), { id: buildYardimKriteriId(donem, ''), name: '' }],
    }));
  };
  // Kullanici istegi: "Kişi Başı Ödenecek Miktar" - dönem basina TEK, SABIT
  // bir deger, genel/serbest kriter listesinden AYRI gosterilir ama AYNI
  // depolama semasina (CATEGORY icinde "<Dönem>::<Tur>" id'li tek bir satir)
  // yazilir - eski kriter satirlarina DOKUNULMAZ, sadece bu SABIT satir
  // eklenir/guncellenir.
  const updatePersonAmount = (donem: string, value: string) => {
    setPredefinedValues(prev => {
      const list = prev[CATEGORY] ?? [];
      const existingIndex = list.findIndex((item) => {
        const parsed = parseYardimKriteriId(item.id);
        return parsed.donem === donem && parsed.tur === YARDIM_KRITERI_KISI_BASI_MIKTAR_TUR;
      });
      if (existingIndex !== -1) {
        return {
          ...prev,
          [CATEGORY]: list.map((item, i) => i === existingIndex ? { ...item, name: value } : item),
        };
      }
      return {
        ...prev,
        [CATEGORY]: [...list, { id: buildYardimKriteriId(donem, YARDIM_KRITERI_KISI_BASI_MIKTAR_TUR), name: value }],
      };
    });
  };
  // Kullanici istegi (2026-09-30): "kriter adı, limit ve açıklama yan yana
  // olsun ... kriter oluştururken onun açıklamasınıda yanına ekleyebilelim" -
  // her kriter SATIRININ (ör. "Aylık Gelir") KENDI aciklama metni, AYNI
  // satirda saklanir (bkz. lib/nakitCriteria.ts - parseKriterRowValue/
  // buildKriterRowValue: aciklama girilmemisse `name` eskisi gibi duz limit
  // metnidir, girilmisse {limit, aciklama} JSON'udur).
  const updateRowLimit = (index: number, limit: string) => {
    const current = parseKriterRowValue(rows[index]?.name);
    updateRow(index, 'name', buildKriterRowValue(limit, current.aciklama));
  };
  const updateRowAciklama = (index: number, aciklama: string) => {
    const current = parseKriterRowValue(rows[index]?.name);
    updateRow(index, 'name', buildKriterRowValue(current.limit, aciklama));
  };

  const availableDonemsForNewPanel = donemOptions.filter((d) => !panelDonems.includes(d.name));

  const addNewPanel = () => {
    if (!newPanelDonem) return;
    addRow(newPanelDonem);
    setNewPanelDonem('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-[#1E2A38]">Yardım Kriterleri</h2>
          <p className="mt-1.5 text-xl font-semibold text-slate-500">
            Nakit Yardımı müracaatlarının Otomatik Red kontrolünde kullanılan Aylık Gelir/Araç Modeli gibi sınırlar - her dönem için ayrı tanımlanabilir, tanımlanmayan dönemlerde &quot;Tüm Dönemler&quot; paneli geçerli olur.
          </p>
        </div>
        {availableDonemsForNewPanel.length > 0 && (
          <div className="flex shrink-0 gap-2">
            <select
              value={newPanelDonem}
              onChange={e => setNewPanelDonem(e.target.value)}
              className="rounded-md border border-slate-300 px-4 py-2.5 text-xl outline-none focus:border-[#1E2A38]"
            >
              <option value="">Dönem seçiniz...</option>
              {availableDonemsForNewPanel.map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
            <button
              onClick={addNewPanel}
              disabled={!newPanelDonem}
              className="rounded-md bg-[#6fb744] px-4 py-2.5 text-xl font-bold text-white hover:bg-[#5aa333] disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              + Yeni Dönem İçin Kriter Ekle
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {panelDonems.length === 0 && (
          <p className="md:col-span-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-xl font-bold text-slate-400">
            Henüz hiçbir dönem için kriter tanımlanmadı - yukarıdan bir dönem seçip &quot;+ Yeni Dönem İçin Kriter Ekle&quot; ile başlayın.
          </p>
        )}
        {panelDonems.map((donem) => {
          const allPanelRows = groups.get(donem) ?? [];
          const personAmountEntry = allPanelRows.find(({ val }) => parseYardimKriteriId(val.id).tur === YARDIM_KRITERI_KISI_BASI_MIKTAR_TUR);
          const panelRows = allPanelRows.filter(({ val }) => parseYardimKriteriId(val.id).tur !== YARDIM_KRITERI_KISI_BASI_MIKTAR_TUR);
          return (
            <div key={donem} className="rounded-lg border border-amber-200 bg-amber-50/40 p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-amber-200/70 pb-2 mb-2">
                <h3 className="text-xl font-black text-slate-800">{donem}</h3>
                <span className="text-xl font-black uppercase text-slate-400">{panelRows.length} kriter</span>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2">
                <label className="whitespace-nowrap text-xl font-bold text-emerald-800">Kişi Başı Ödenecek Miktar (TL)</label>
                <input
                  type="number"
                  min={0}
                  placeholder="Örn: 1000"
                  value={personAmountEntry?.val.name ?? ''}
                  onChange={(e) => updatePersonAmount(donem, e.target.value)}
                  className="w-32 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xl outline-none focus:border-[#1E2A38]"
                />
              </div>
              {/* Kullanici istegi (2026-09-30): "kriter adı, limit ve açıklama
                  yan yana olsun ... kriter oluştururken onun açıklamasınıda
                  yanına ekleyebilelim" - her kriter satirinda 3 alan yan yana:
                  Kriter Adı (tur, ör. "Aylık Gelir"), Limit (esik degeri) ve
                  Açıklama (bu kriter asildiginda açıklama alanina yazilacak
                  ozel metin - bos birakilirsa sistemin hesapladigi varsayilan
                  metin kullanilir, bkz. lib/services/cashAutoReject.service.ts). */}
              <div className="space-y-2">
                {panelRows.length === 0 ? (
                  <p className="py-1 text-xl font-semibold text-slate-400">Henüz kriter eklenmedi.</p>
                ) : (
                  <>
                    <div className="hidden gap-2 px-1 text-lg font-black uppercase text-slate-400 sm:grid sm:grid-cols-[1fr_140px_1.4fr_28px]">
                      <span>Kriter Adı</span>
                      <span>Limit</span>
                      <span>Açıklama (opsiyonel)</span>
                      <span />
                    </div>
                    {panelRows.map(({ index, val }) => {
                      const { limit, aciklama } = parseKriterRowValue(val.name);
                      return (
                        <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_1.4fr_28px] sm:items-center">
                          <input
                            type="text"
                            placeholder="Kriter Adı (ör. Aylık Gelir)"
                            value={parseYardimKriteriId(val.id).tur}
                            onChange={e => updateRow(index, 'id', buildYardimKriteriId(donem, e.target.value))}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xl outline-none focus:border-[#1E2A38]"
                          />
                          <input
                            type="text"
                            placeholder="Limit"
                            value={limit}
                            onChange={e => updateRowLimit(index, e.target.value)}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xl outline-none focus:border-[#1E2A38]"
                          />
                          <input
                            type="text"
                            placeholder="Örn: Gelir sınırı aşıldığından uygun görülmemiştir."
                            value={aciklama}
                            onChange={e => updateRowAciklama(index, e.target.value)}
                            maxLength={100}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xl outline-none focus:border-[#1E2A38]"
                          />
                          <button onClick={() => removeRow(index)} className="justify-self-end text-xl text-slate-300 hover:text-rose-500 sm:justify-self-center">×</button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
              <button
                onClick={() => addRow(donem)}
                className="w-full rounded-md border border-dashed border-slate-300 py-2 text-xl font-bold text-slate-500 hover:bg-white hover:border-[#1E2A38] hover:text-[#1E2A38] transition-all mt-2"
              >
                + Yeni Kriter Ekle
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Kullanici istegi/hata (Eylul 2026): mobilde bu sayfa BOM BEYAZ aciliyordu -
// kok neden: useSearchParams() dogrudan default export'ta cagriliyor ve
// <Suspense> sinirinda DEGIL. Next.js bu durumda (ozellikle prod'da, SPA
// navigasyonunda) sayfayi CSR'a dusurup bos render edebiliyor. Ic bilesene
// tasindi, default export <Suspense> ile sarildi.
function SystemSettingsPageInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { addTab } = useTabs()
  const [activeTab, setActiveTab] = useState<TabType>('nvi')
  const activeHeader = settingsHeaderByTab[activeTab] ?? settingsHeaderByTab.nvi!
  const [nviCreds, setNviCreds] = useState<NviCredentials>({ 
    user: '', 
    pass: '', 
    useBridge: true,
    bridgeUrl: 'http://10.0.0.183:3500/master.asmx', 
    bridgeToken: '' 
  });
  const [services, setServices] = useState<NviService[]>([
    {
      id: 'localDb',
      name: 'Sistem Entegre Alanı (Bireyler Tablosu)',
      description: 'Kişi bilgilerini sistemin kendi veritabanındaki bireyler tablosundan sorgular (Çevrimdışı/Hızlı).',
      url: 'LOCAL_DB',
      enabled: true,
    },
    {
      id: 'tcKimlik',
      name: 'TC Kimlik No ile Kişi Bilgileri',
      description: 'Kişinin temel kimlik bilgilerini (ad, soyad, doğum tarihi vb.) sorgular.',
      url: 'https://kps.nvi.gov.tr/Services/KpsServices.svc',
      enabled: false,
    },
    {
      id: 'adres',
      name: 'Adres Bilgileri Sorgulama',
      description: 'Kişinin MERNİS üzerinde kayıtlı yerleşim yeri ve diğer adreslerini sorgular.',
      url: 'https://kps.nvi.gov.tr/Services/KpsServices.svc',
      enabled: true,
    },
    {
      id: 'maviKart',
      name: 'Mavi Kartlı Kişi Bilgileri',
      description: 'Mavi Kart sahibi kişinin temel kimlik bilgilerini sorgular.',
      url: 'https://kps.nvi.gov.tr/Services/KpsServices.svc',
      enabled: false,
    },
    {
      id: 'nufusKayit',
      name: 'Aile Nüfus Kayıt Örneği',
      description: 'Kişinin vukuatlı nüfus kayıt örneğini (hane halkı) sorgular.',
      url: 'https://kps.nvi.gov.tr/Services/KpsServices.svc',
      enabled: true,
    },
  ]);
  const [predefinedValues, setPredefinedValues] = useState<Record<string, PredefinedValue[]>>({
    fileStatus: [
      { id: '1', name: 'Aktif' },
      { id: '2', name: 'Pasif' },
      { id: '9', name: 'Arşivlendi' },
    ],
    assistanceStatus: [
      { id: '1', name: 'Devam Ediyor' },
      { id: '2', name: 'Tamamlandı' },
      { id: '3', name: 'İptal Edildi' },
      { id: '0', name: 'Yardım Almıyor' },
    ],
    relationship: [
      { id: '0', name: 'Kendisi' },
      { id: '1', name: 'Eşi' },
      { id: '2', name: 'Oğlu' },
      { id: '3', name: 'Kızı' },
      { id: '4', name: 'Annesi' },
      { id: '5', name: 'Babası' },
    ],
    maritalStatus: [
      { id: '1', name: 'Bekar' },
      { id: '2', name: 'Evli' },
      { id: '3', name: 'Dul' },
      { id: '4', name: 'Boşanmış' },
    ],
    healthStatus: [
      { id: '0', name: 'Sağlık Sorunu Yok' },
      { id: '1', name: 'Engelli' },
      { id: '2', name: 'Süreğen Hastalık' },
      { id: '3', name: 'Yaşlı/Bakıma Muhtaç' },
    ],
  });

  const [predefinedValueTitles, setPredefinedValueTitles] = useState<Record<string, string>>({
    fileStatus: 'Dosya Durumu',
    assistanceStatus: 'Yardım Durumu',
    relationship: 'Yakınlık Derecesi',
    maritalStatus: 'Medeni Hal',
    healthStatus: 'Sağlık Durumu',
  });

  const [newCategoryTitle, setNewCategoryTitle] = useState('');
  const [predefinedSaveStatus, setPredefinedSaveStatus] = useState('');
  const [isSavingPredefinedValues, setIsSavingPredefinedValues] = useState(false);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledSqlTask[]>([]);
  const [scheduledTaskForm, setScheduledTaskForm] = useState<ScheduledSqlTaskForm>(emptyScheduledTaskForm);
  const [editingScheduledTaskId, setEditingScheduledTaskId] = useState<number | null>(null);
  const [scheduledTaskStatus, setScheduledTaskStatus] = useState('');
  const [isSavingScheduledTask, setIsSavingScheduledTask] = useState(false);
  const [runningScheduledTaskId, setRunningScheduledTaskId] = useState<number | null>(null);
  const [databaseBackupSettings, setDatabaseBackupSettings] = useState<DatabaseBackupSettings>(defaultDatabaseBackupSettings);
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackupFile[]>([]);
  const [databaseBackupOptions, setDatabaseBackupOptions] = useState<DatabaseBackupOption[]>([]);
  const [selectedRestoreBackup, setSelectedRestoreBackup] = useState('');
  const [databaseBackupStatus, setDatabaseBackupStatus] = useState('');
  const [isLoadingDatabaseBackups, setIsLoadingDatabaseBackups] = useState(false);
  const [isSavingDatabaseBackupSettings, setIsSavingDatabaseBackupSettings] = useState(false);
  const [isRunningDatabaseBackup, setIsRunningDatabaseBackup] = useState(false);
  const [isRestoringDatabaseBackup, setIsRestoringDatabaseBackup] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [folderPickerData, setFolderPickerData] = useState<FolderPickerResponse['data'] | null>(null);
  const [folderPickerStatus, setFolderPickerStatus] = useState('');
  const [isLoadingFolderPicker, setIsLoadingFolderPicker] = useState(false);
  const [personnelPerformance, setPersonnelPerformance] = useState<PersonnelPerformancePayload | null>(null);
  const [personnelPerformanceStatus, setPersonnelPerformanceStatus] = useState('');
  const [isLoadingPersonnelPerformance, setIsLoadingPersonnelPerformance] = useState(false);
  const [hasLoadedPersonnelPerformance, setHasLoadedPersonnelPerformance] = useState(false);
  const [settingsUsers, setSettingsUsers] = useState<SettingsUser[]>([]);
  const [selectedPermissionUserId, setSelectedPermissionUserId] = useState<string | null>(null);
  const [permissionUserSearchTerm, setPermissionUserSearchTerm] = useState('');
  const [userPermissions, setUserPermissions] = useState<UserPermissionsById>({});
  const [userPermissionStatus, setUserPermissionStatus] = useState('');
  const [isSavingUserPermissions, setIsSavingUserPermissions] = useState(false);

  // Online Başvuru Durumları
  const [onlineForms, setOnlineForms] = useState<OnlineApplication[]>(DEFAULT_ONLINE_APPLICATION_FORMS);
  const [selectedOnlineFormId, setSelectedOnlineFormId] = useState<string | null>('app_1');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<OnlineFormField['type']>('text');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [onlineFormStatus, setOnlineFormStatus] = useState('');
  const [isSavingOnlineForms, setIsSavingOnlineForms] = useState(false);
  // Kullanici istegi (2026-09-22): "bitiş tarihi ve saati gelince
  // yayından kalkmadı" - alttaki isFormCurrentlyPublished/getPublishScheduleStatus
  // mantiginin KENDISI dogruydu (dogrulandi), asil sorun bu ekranin hicbir
  // zamanlayicisi olmamasiydi: sayfa acildiginda HESAPLANIP bir daha
  // kullanici baska bir seye tiklamadikca YENIDEN HESAPLANMIYORDU - yani
  // "Şu an: Şu anda yayında" yazisi, duvar saati suresi gecse bile
  // kullanici baska bir alana tiklayip React'i yeniden render ETTIRMEDIGI
  // surece ekranda DONMUS kaliyordu. Bu sayac her 15 saniyede bir state'i
  // (deger olarak degil, SADECE render'i tetiklemek icin) guncelleyip
  // asagidaki zamanlama durumu/nokta gostergelerinin canli kalmasini saglar.
  const [scheduleStatusTick, setScheduleStatusTick] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => {
      setScheduleStatusTick((tick) => tick + 1);
    }, 15000);
    return () => window.clearInterval(interval);
  }, []);
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(defaultGeneralSettings);
  const [generalSettingsStatus, setGeneralSettingsStatus] = useState('');
  const [isSavingGeneralSettings, setIsSavingGeneralSettings] = useState(false);
  const [neighborhoods, setNeighborhoods] = useState<NeighborhoodRow[]>([]);
  const [neighborhoodStatus, setNeighborhoodStatus] = useState('');
  const [isLoadingNeighborhoods, setIsLoadingNeighborhoods] = useState(false);
  const [neighborhoodForm, setNeighborhoodForm] = useState({ name: '', paymentDay: '', paymentEndDay: '' });
  const [savingNeighborhoodId, setSavingNeighborhoodId] = useState<string | null>(null);
  const [neighborhoodSearchTerm, setNeighborhoodSearchTerm] = useState('');
  const [neighborhoodSortKey, setNeighborhoodSortKey] = useState<'name' | 'paymentDay' | 'paymentEndDay'>('name');
  const [neighborhoodSortDir, setNeighborhoodSortDir] = useState<'asc' | 'desc'>('asc');
  const [bulkPaymentDayForm, setBulkPaymentDayForm] = useState({ paymentDay: '', paymentEndDay: '' });
  const [isApplyingBulkPaymentDay, setIsApplyingBulkPaymentDay] = useState(false);
  const [authorizedPersonnel, setAuthorizedPersonnel] = useState<AuthorizedPersonnelEntry[]>([]);
  const [authorizedPersonnelStatus, setAuthorizedPersonnelStatus] = useState('');
  const [isSavingAuthorizedPersonnel, setIsSavingAuthorizedPersonnel] = useState(false);
  const [authorizedPersonnelSearchTerm, setAuthorizedPersonnelSearchTerm] = useState('');
  const [whatsappSettings, setWhatsappSettings] = useState<WhatsappSettings>(defaultWhatsappSettings);
  const [whatsappSettingsForm, setWhatsappSettingsForm] = useState<WhatsappSettings>(defaultWhatsappSettings);
  const [whatsappStatus, setWhatsappStatus] = useState('');
  const [isSavingWhatsapp, setIsSavingWhatsapp] = useState(false);
  const [whatsappConnection, setWhatsappConnection] = useState<{
    status: 'disconnected' | 'initializing' | 'qr' | 'authenticated' | 'ready' | 'auth_failure';
    qrDataUrl: string | null;
    connectedNumber: string | null;
    connectedName: string | null;
    lastError: string | null;
    reconnectCooldownUntil: number | null;
  } | null>(null);
  const [isWhatsappConnecting, setIsWhatsappConnecting] = useState(false);
  const [isWhatsappLoggingOut, setIsWhatsappLoggingOut] = useState(false);
  const [whatsappDisplayNameForm, setWhatsappDisplayNameForm] = useState('');
  const [whatsappDisplayNameStatus, setWhatsappDisplayNameStatus] = useState('');
  const [isSavingWhatsappDisplayName, setIsSavingWhatsappDisplayName] = useState(false);
  const [smsSettings, setSmsSettings] = useState<SmsIntegrationSettings>(defaultSmsIntegrationSettings);
  const [smsSettingsStatus, setSmsSettingsStatus] = useState('');
  const [isSavingSmsSettings, setIsSavingSmsSettings] = useState(false);
  const [smsProviderTestStatus, setSmsProviderTestStatus] = useState<Partial<Record<SmsProviderId, { status: 'sending' | 'success' | 'error'; message: string }>>>({});

  const [formDesigns, setFormDesigns] = useState<FormDesign[]>([
    {
      id: '1',
      name: 'Standart Yardım Barkodu',
      type: 'label',
      linkedAssistance: 'Tümü',
      width: '80',
      height: '40',
      content: '',
      bands: [
        { id: 'bnd_1', type: 'MasterData', name: 'Barkod Verisi', height: 151 }
      ],
      blocks: [
        { id: 'b1', bandId: 'bnd_1', type: 'variable', x: 20, y: 15, value: '{{yardim.turu}}', fontSize: 16, fontWeight: 'bold' },
        { id: 'b2', bandId: 'bnd_1', type: 'variable', x: 20, y: 45, value: '{{kisi.ad_soyad}}', fontSize: 14, fontWeight: 'normal' },
        { id: 'b3', bandId: 'bnd_1', type: 'barcode', x: 20, y: 75, value: '{{dosya.dosyano}}' },
      ]
    }
  ]);
  const [selectedFormDesignId, setSelectedFormDesignId] = useState<string | null>(formDesigns[0]?.id || null);

  // Drag and Drop (Görsel Tasarım) Durumları
  const [draggedTool, setDraggedTool] = useState<DesignBlock['type'] | null>(null);
  const [draggedField, setDraggedField] = useState<ReportField | null>(null);
  const [draggedBlock, setDraggedBlock] = useState<{ designId: string, blockId: string, offsetX: number, offsetY: number } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [formDesignStatus, setFormDesignStatus] = useState('');
  const [isSavingFormDesigns, setIsSavingFormDesigns] = useState(false);
  const [isFormPreviewOpen, setIsFormPreviewOpen] = useState(false);
  const [isFullscreenDesigner, setIsFullscreenDesigner] = useState(false);

  const dummyPrintData = {
    yardim: { id: 'Y-12345', turu: 'Ekmek', miktar: '30', durum: 'Aktif', aciklama: 'Aylık rutin', bas_tarih: '01.01.2023', bit_tarih: '31.12.2023', donem: '2023/1' },
    kisi: { tc: '12345678901', ad_soyad: 'Ahmet Yılmaz', telefon: '0555 555 5555', dogum_tarihi: '01.01.1980' },
    dosya: { dosyano: 'D-98765', adres: 'Örnek Mah. Test Sok. No:1', mahalle: 'Örnek Mah.' },
    cikti: { tarih: new Date().toLocaleDateString('tr-TR'), saat: new Date().toLocaleTimeString('tr-TR') }
  };

  const selectedOnlineForm = onlineForms.find(f => f.id === selectedOnlineFormId) ?? null;
  const selectedOnlineCriteria = normalizeOnlineApplicationCriteria(selectedOnlineForm?.criteria);
  const selectedOnlineCriteriaRows = ONLINE_CRITERION_OPTIONS.filter(option => Boolean(selectedOnlineCriteria[option.enabledField]));
  const selectedOnlineManualCriteria = selectedOnlineCriteria.manualInfoCriteria;
  const selectedOnlineIntro = normalizeOnlineApplicationIntro(selectedOnlineForm?.intro);
  const selectedPermissionUser = settingsUsers.find(user => user.id === selectedPermissionUserId) ?? null;
  const filteredPermissionUsers = (() => {
    const term = permissionUserSearchTerm.trim().toLocaleLowerCase('tr-TR');
    if (!term) return settingsUsers;
    return settingsUsers.filter(user => {
      const haystack = [user.name, user.username, user.email, String(user.id)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      return haystack.includes(term);
    });
  })();
  // KAPS / NVİ Sorgu Ekranı, uygulamanin KENDI origin'i uzerinden (/kaps)
  // ters-proxy'lenir - bkz. next.config.js "rewrites". Boylece hem CSP
  // (frame-src 'self') gomulu iframe'e izin verir hem de ekran her
  // istemciden erisilebilir (kpsv2 IIS Express sadece sunucuda localhost'a
  // bagli - "http://<ip>:3500" istemciden acilmiyordu).
  const kapsUrl = '/kaps';
  const kapsDirectUrl = (() => {
    try {
      const hostname = publicBaseUrl ? new URL(publicBaseUrl).hostname : 'localhost';
      return `http://${hostname}:3500`;
    } catch {
      return 'http://localhost:3500';
    }
  })();
  const selectedOnlineFormUrl = selectedOnlineForm
    ? `${publicBaseUrl || ''}/online?form=${encodeURIComponent(selectedOnlineForm.id)}`
    : `${publicBaseUrl || ''}/online`;
  // Kullanici istegi (14 Eylul 2026, 2. tur): "/onlinebasvuru" artik TEK bir
  // forma degil, kurumun O AN ACIK OLAN TUM online basvuru turlerinin
  // listelendigi ortak ana sayfaya isaret ediyor (bkz. app/onlinebasvuru/
  // page.tsx) - bu yuzden yukaridaki (forma OZEL) linkten AYRI, sabit bir
  // "ana sayfa" bagalantisi da gosteriliyor.
  const onlineFormsHubUrl = `${publicBaseUrl || ''}/onlinebasvuru`;
  const copyOnlineFormsHubUrl = async () => {
    try {
      await navigator.clipboard.writeText(onlineFormsHubUrl);
      setOnlineFormStatus('Tüm formların listelendiği ana sayfa bağlantısı kopyalandı.');
    } catch {
      setOnlineFormStatus('Bağlantı kopyalanamadı. Linki elle seçip kopyalayabilirsiniz.');
    }
  };

  const copyOnlineFormUrl = async () => {
    try {
      await navigator.clipboard.writeText(selectedOnlineFormUrl);
      setOnlineFormStatus('Online başvuru bağlantısı kopyalandı.');
    } catch {
      setOnlineFormStatus('Bağlantı kopyalanamadı. Linki elle seçip kopyalayabilirsiniz.');
    }
  };

  useEffect(() => {
    let isCancelled = false;

    const loadFormDesigns = async () => {
      try {
        const response = await fetch('/api/settings/form_design_templates');
        if (response.status === 404) return;

        const payload = (await response.json()) as SettingResponse<FormDesign[]>;
        if (!response.ok || !payload.success || !Array.isArray(payload.data?.value)) {
          throw new Error(payload.error || 'Form tasarımları alınamadı.');
        }

        if (!isCancelled) {
          setFormDesigns(payload.data.value);
          if (payload.data.value.length > 0) {
            setSelectedFormDesignId(payload.data.value[0].id);
          }
        }
      } catch (loadError) {
        if (!isCancelled) {
          setFormDesignStatus((loadError as Error).message);
        }
      }
    };

    loadFormDesigns();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadOnlineForms = async () => {
      try {
        const response = await fetch(`/api/settings/${ONLINE_APPLICATION_FORMS_SETTING_KEY}`);
        if (response.status === 404) return;

        const payload = (await response.json()) as SettingResponse<OnlineApplication[]>;
        const value = payload.data?.value;

        if (!response.ok || !payload.success || !Array.isArray(value)) {
          throw new Error(payload.error || 'Online başvuru formları alınamadı.');
        }

        if (!isCancelled) {
          setOnlineForms(value.map(form => ({
            ...form,
            criteria: normalizeOnlineApplicationCriteria(form.criteria),
            intro: normalizeOnlineApplicationIntro(form.intro),
          })));
          setSelectedOnlineFormId(value[0]?.id ?? null);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setOnlineFormStatus((loadError as Error).message);
        }
      }
    };

    loadOnlineForms();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setPublicBaseUrl(window.location.origin);
    });
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadGeneralSettings = async () => {
      try {
        const response = await fetch(`/api/settings/${GENERAL_SETTINGS_KEY}`);
        if (response.status === 404) return;

        const payload = (await response.json()) as SettingResponse<GeneralSettings>;
        const value = payload.data?.value;

        if (!response.ok || !payload.success || !value) {
          throw new Error(payload.error || 'Genel ayarlar alınamadı.');
        }

        if (!isCancelled) {
          setGeneralSettings({ ...defaultGeneralSettings, ...value });
        }
      } catch (loadError) {
        if (!isCancelled) {
          setGeneralSettingsStatus((loadError as Error).message);
        }
      }
    };

    loadGeneralSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadNeighborhoods = async () => {
      setIsLoadingNeighborhoods(true);
      setNeighborhoodStatus('');

      try {
        const response = await fetch('/api/settings/neighborhoods');
        const payload = (await response.json()) as NeighborhoodsResponse;

        if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
          throw new Error(payload.error || 'Mahalle listesi alinamadi.');
        }

        if (!isCancelled) {
          setNeighborhoods(payload.data);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setNeighborhoodStatus((loadError as Error).message);
          setNeighborhoods([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingNeighborhoods(false);
        }
      }
    };

    void loadNeighborhoods();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadAuthorizedPersonnel = async () => {
      try {
        const response = await fetch(`/api/settings/${AUTHORIZED_PERSONNEL_SETTING_KEY}`);
        if (response.status === 404) return;

        const payload = (await response.json()) as SettingResponse<AuthorizedPersonnelEntry[]>;
        if (!response.ok) {
          throw new Error(payload.error || 'Yetkili personel listesi alınamadı.');
        }

        if (!isCancelled && Array.isArray(payload.data?.value)) {
          setAuthorizedPersonnel(payload.data.value);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setAuthorizedPersonnelStatus((loadError as Error).message);
        }
      }
    };

    void loadAuthorizedPersonnel();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadWhatsappSettings = async () => {
      try {
        const response = await fetch(`/api/settings/${WHATSAPP_SETTINGS_KEY}`);
        if (response.status === 404) return;

        const payload = (await response.json()) as SettingResponse<WhatsappSettings>;
        if (!response.ok) {
          throw new Error(payload.error || 'WhatsApp Web ayarları alınamadı.');
        }

        if (!isCancelled && payload.data?.value) {
          const merged = { ...defaultWhatsappSettings, ...payload.data.value };
          setWhatsappSettings(merged);
          setWhatsappSettingsForm(merged);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setWhatsappStatus((loadError as Error).message);
        }
      }
    };

    void loadWhatsappSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Merkezi WhatsApp oturumunun (bkz. lib/services/whatsappWeb.service.ts)
  // canlı durumunu gösterir - sadece "WhatsApp Web" sekmesi açıkken 3
  // saniyede bir sorgular (QR kod ekranda görünürken otomatik yenilenir,
  // bağlantı kurulunca "Bağlı" durumuna hemen geçer).
  useEffect(() => {
    if (activeTab !== 'whatsapp') return;
    let isCancelled = false;

    const loadWhatsappConnection = async () => {
      try {
        const response = await fetch('/api/whatsapp/status', { cache: 'no-store' });
        const payload = await response.json();
        if (!isCancelled && payload?.success) {
          setWhatsappConnection(payload.data);
        }
      } catch {
        // sessizce yoksay, bir sonraki sorguda tekrar denenir
      }
    };

    void loadWhatsappConnection();
    const interval = setInterval(loadWhatsappConnection, 3000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [activeTab]);

  // Bağlantı "Bağlı" durumuna geçtiğinde, "Kurum Görünen Adı" formunu o an
  // WhatsApp'ta kayıtlı olan isimle (boşsa) bir kez doldurur - kullanıcı
  // zaten bir şeyler yazıyorsa üzerine yazmaz.
  useEffect(() => {
    if (whatsappConnection?.status === 'ready' && whatsappConnection.connectedName && !whatsappDisplayNameForm) {
      setWhatsappDisplayNameForm(whatsappConnection.connectedName);
    }
  }, [whatsappConnection?.status, whatsappConnection?.connectedName, whatsappDisplayNameForm]);

  const connectWhatsapp = async (force = false) => {
    setIsWhatsappConnecting(true);
    try {
      const response = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const payload = await response.json();
      if (payload?.success) setWhatsappConnection(payload.data);
    } catch {
      // durum bir sonraki pollde tekrar okunur
    } finally {
      setIsWhatsappConnecting(false);
    }
  };

  // Kullanıcı isteği: "burada 'Bağlan' yazıyorsa, buna kullanıcı elle
  // basmak ZORUNDA kalmasın - sistem bunu KENDİSİ yapsın." Sunucu
  // tarafındaki 1 dakikalık otomatik sağlık kontrolüne (bkz.
  // lib/services/whatsappWeb.service.ts) EK bir güvence katmanı: bu ekran
  // açıkken "Bağlı Değil" durumu görülür görülmez, tıpkı kullanıcı "Bağlan"
  // butonuna basmış gibi otomatik olarak bağlanma denemesi başlatılır -
  // QR gerekmeyen (kayıtlı oturumlu) bir kopmada bu anında kendi kendine
  // düzelir. Ayni kopukluk icin ard arda deneme yapmasin diye (baglanti
  // saglanana ya da durum degisene kadar) tek seferlik tetiklenir.
  const whatsappAutoReconnectAttemptedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'whatsapp' || !whatsappConnection) return;

    const isDropped = whatsappConnection.status === 'disconnected' || whatsappConnection.status === 'auth_failure';
    if (!isDropped) {
      whatsappAutoReconnectAttemptedRef.current = false;
      return;
    }

    if (whatsappAutoReconnectAttemptedRef.current || isWhatsappConnecting) return;
    whatsappAutoReconnectAttemptedRef.current = true;
    void connectWhatsapp(false);
  }, [activeTab, whatsappConnection, isWhatsappConnecting]);

  const disconnectWhatsapp = async () => {
    if (!window.confirm('Kurumun WhatsApp bağlantısını kesmek istediğinize emin misiniz? Tekrar bağlanmak için yeniden QR kod okutmak gerekecek.')) return;
    setIsWhatsappLoggingOut(true);
    try {
      const response = await fetch('/api/whatsapp/logout', { method: 'POST' });
      const payload = await response.json();
      if (payload?.success) setWhatsappConnection(payload.data);
    } catch {
      // durum bir sonraki pollde tekrar okunur
    } finally {
      setIsWhatsappLoggingOut(false);
    }
  };

  const saveWhatsappDisplayName = async () => {
    const name = whatsappDisplayNameForm.trim();
    if (!name) return;
    setIsSavingWhatsappDisplayName(true);
    setWhatsappDisplayNameStatus('');
    try {
      const response = await fetch('/api/whatsapp/display-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      const payload = await response.json();
      if (payload?.success) {
        setWhatsappDisplayNameStatus('Görünen ad güncellendi.');
        setWhatsappConnection(prev => (prev ? { ...prev, connectedName: name } : prev));
      } else {
        setWhatsappDisplayNameStatus(payload?.error || 'Görünen ad değiştirilemedi.');
      }
    } catch {
      setWhatsappDisplayNameStatus('Görünen ad değiştirilemedi - sunucuya ulaşılamadı.');
    } finally {
      setIsSavingWhatsappDisplayName(false);
    }
  };

  useEffect(() => {
    let isCancelled = false;

    const loadSmsSettings = async () => {
      try {
        const response = await fetch(`/api/settings/${SMS_INTEGRATION_SETTINGS_KEY}`);
        if (response.status === 404) return;

        const payload = (await response.json()) as SettingResponse<SmsIntegrationSettings>;
        const value = payload.data?.value;

        if (!response.ok || !payload.success || !value) {
          throw new Error(payload.error || 'SMS entegrasyon ayarları alınamadı.');
        }

        if (!isCancelled) {
          setSmsSettings({
            ...defaultSmsIntegrationSettings,
            ...value,
            providers: {
              mutlucell: {
                ...defaultSmsIntegrationSettings.providers.mutlucell,
                ...value.providers?.mutlucell,
              },
              ileti: {
                ...defaultSmsIntegrationSettings.providers.ileti,
                ...value.providers?.ileti,
              },
              netgsm: {
                ...defaultSmsIntegrationSettings.providers.netgsm,
                ...value.providers?.netgsm,
              },
            },
            templates: Array.isArray(value.templates) && value.templates.length > 0
              ? value.templates.map((template) => ({
                  ...template,
                  active: template.active !== false,
                }))
              : defaultSmsMessageTemplates,
          });
        }
      } catch (loadError) {
        if (!isCancelled) {
          setSmsSettingsStatus((loadError as Error).message);
        }
      }
    };

    loadSmsSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pathname !== '/settings') return

    const tab = searchParams.get('tab') as TabType | null
    const userId = searchParams.get('user')
    const nextTab: TabType = tab === 'userPermissions' || tab === 'online' ? tab : 'nvi'

    setActiveTab((current) => (current === nextTab ? current : nextTab))

    if (userId) {
      setSelectedPermissionUserId(userId)
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    let isCancelled = false;

    const loadPredefinedValues = async () => {
      try {
        const response = await fetch('/api/predefined-values');
        const payload = (await response.json()) as PredefinedValuesResponse;

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || 'Hazır değerler alınamadı.');
        }

        if (!isCancelled) {
          setPredefinedValues(payload.data.values);
          setPredefinedValueTitles(payload.data.titles);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setPredefinedSaveStatus((loadError as Error).message);
        }
      }
    };

    loadPredefinedValues();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadScheduledTasks = async () => {
      try {
        const response = await fetch('/api/scheduled-sql-tasks');
        const payload = (await response.json()) as ScheduledSqlTasksResponse;

        if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
          throw new Error(payload.error || 'Zamanlanmış görevler alınamadı.');
        }

        if (!isCancelled) {
          setScheduledTasks(payload.data);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setScheduledTaskStatus((loadError as Error).message);
        }
      }
    };

    loadScheduledTasks();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadDatabaseBackups = async () => {
      setIsLoadingDatabaseBackups(true);
      setDatabaseBackupStatus('');

      try {
        const response = await fetch('/api/settings/database-backups');
        const payload = (await response.json()) as DatabaseBackupsResponse;

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || 'Veritabani yedekleri alinamadi.');
        }

        if (!isCancelled) {
          setDatabaseBackupSettings(payload.data.settings);
          setDatabaseBackups(payload.data.backups);
          setDatabaseBackupOptions(payload.data.databaseOptions ?? (
            payload.data.settings.databaseName
              ? [{ name: payload.data.settings.databaseName, label: payload.data.settings.databaseName, isCurrent: true }]
              : []
          ));
          setSelectedRestoreBackup(payload.data.backups[0]?.fileName ?? '');
        }
      } catch (loadError) {
        if (!isCancelled) {
          setDatabaseBackupStatus((loadError as Error).message);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingDatabaseBackups(false);
        }
      }
    };

    loadDatabaseBackups();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'personnelPerformance' || hasLoadedPersonnelPerformance) return;

    let isCancelled = false;

    const loadPersonnelPerformance = async () => {
      setIsLoadingPersonnelPerformance(true);
      setPersonnelPerformanceStatus('');

      try {
        const response = await fetch('/api/settings/personnel-performance');
        const payload = (await response.json()) as PersonnelPerformanceResponse;

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || 'Personel performans verileri alinamadi.');
        }

        if (!isCancelled) {
          setPersonnelPerformance(payload.data);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setPersonnelPerformance(null);
          setPersonnelPerformanceStatus((loadError as Error).message);
        }
      } finally {
        if (!isCancelled) {
          setHasLoadedPersonnelPerformance(true);
          setIsLoadingPersonnelPerformance(false);
        }
      }
    };

    loadPersonnelPerformance();

    return () => {
      isCancelled = true;
    };
  }, [activeTab, hasLoadedPersonnelPerformance]);

  useEffect(() => {
    let isCancelled = false;

    const loadUserPermissions = async () => {
      try {
        const [usersResponse, permissionsResponse] = await Promise.all([
          fetch('/api/users?limit=500'),
          fetch(`/api/settings/${USER_PERMISSIONS_SETTING_KEY}`),
        ]);

        const usersPayload = (await usersResponse.json()) as UsersResponse;
        if (!usersResponse.ok || !usersPayload.success || !Array.isArray(usersPayload.data)) {
          throw new Error(usersPayload.error || 'Kullanıcılar alınamadı.');
        }

        let permissions: UserPermissionsById = {};
        if (permissionsResponse.ok) {
          const permissionsPayload = (await permissionsResponse.json()) as SettingResponse<UserPermissionsById>;
          permissions = permissionsPayload.data?.value ?? {};
        } else if (permissionsResponse.status !== 404) {
          const permissionsPayload = await permissionsResponse.json();
          throw new Error(permissionsPayload.error || 'Kullanıcı yetkileri alınamadı.');
        }

        if (!isCancelled) {
          setSettingsUsers(usersPayload.data);
          setSelectedPermissionUserId(current => current ?? usersPayload.data?.[0]?.id ?? null);
          setUserPermissions(permissions);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setUserPermissionStatus((loadError as Error).message);
        }
      }
    };

    loadUserPermissions();

    return () => {
      isCancelled = true;
    };
  }, []);

  const [isSavingNvi, setIsSavingNvi] = useState(false);
  const [nviStatus, setNviStatus] = useState('');

  useEffect(() => {
    fetch('/api/settings/nvi')
      .then(res => res.json())
      .then(payload => {
        if (payload.success) {
          if (payload.creds) setNviCreds(payload.creds);
          if (Array.isArray(payload.data) && payload.data.length > 0) {
            setServices(payload.data);
          }
        }
      })
      .catch(err => console.error('NVİ Ayarları yüklenemedi:', err));
  }, []);

  const saveNviSettings = async () => {
    setIsSavingNvi(true);
    setNviStatus('');
    try {
      const res = await fetch('/api/settings/nvi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services, creds: nviCreds })
      });
      const payload = await res.json();
      if (payload.success) {
        setNviStatus('NVİ ayarları başarıyla kaydedildi.');
      } else {
        throw new Error(payload.error);
      }
    } catch (err) {
      setNviStatus('Hata: ' + (err as Error).message);
    } finally {
      setIsSavingNvi(false);
    }
  };

  const savePredefinedValues = async () => {
    setIsSavingPredefinedValues(true);
    setPredefinedSaveStatus('');

    try {
      const response = await fetch('/api/predefined-values', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: predefinedValues,
          titles: predefinedValueTitles,
        }),
      });
      const payload = (await response.json()) as PredefinedValuesResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Hazır değerler kaydedilemedi.');
      }

      setPredefinedValues(payload.data.values);
      setPredefinedValueTitles(payload.data.titles);
      setPredefinedSaveStatus('Hazır değerler kaydedildi.');
    } catch (saveError) {
      setPredefinedSaveStatus((saveError as Error).message);
    } finally {
      setIsSavingPredefinedValues(false);
    }
  };

  const saveFormDesigns = async () => {
    setIsSavingFormDesigns(true);
    setFormDesignStatus('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'form_design_templates',
          value: formDesigns,
          type: 'json',
        }),
      });
      const payload = (await response.json()) as SettingResponse<FormDesign[]>;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Form tasarımları kaydedilemedi.');
      }

      setFormDesignStatus('Form tasarımları kaydedildi.');
    } catch (saveError) {
      setFormDesignStatus((saveError as Error).message);
    } finally {
      setIsSavingFormDesigns(false);
    }
  };

  const saveOnlineForms = async () => {
    setIsSavingOnlineForms(true);
    setOnlineFormStatus('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: ONLINE_APPLICATION_FORMS_SETTING_KEY,
          value: onlineForms,
          type: 'json',
        }),
      });
      const payload = (await response.json()) as SettingResponse<OnlineApplication[]>;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Online başvuru formları kaydedilemedi.');
      }

      setOnlineFormStatus('Online başvuru formları kaydedildi.');
    } catch (saveError) {
      setOnlineFormStatus((saveError as Error).message);
    } finally {
      setIsSavingOnlineForms(false);
    }
  };

  const updateGeneralSetting = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    setGeneralSettings(prev => ({ ...prev, [key]: value }));
  };

  const refreshNeighborhoods = async () => {
    setIsLoadingNeighborhoods(true);
    setNeighborhoodStatus('');

    try {
      const response = await fetch('/api/settings/neighborhoods');
      const payload = (await response.json()) as NeighborhoodsResponse;

      if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload.error || 'Mahalle listesi alınamadı.');
      }

      setNeighborhoods(payload.data);
    } catch (loadError) {
      setNeighborhoodStatus((loadError as Error).message);
      setNeighborhoods([]);
    } finally {
      setIsLoadingNeighborhoods(false);
    }
  };

  const addNeighborhood = async () => {
    if (!neighborhoodForm.name.trim()) {
      setNeighborhoodStatus('Mahalle adı zorunludur.');
      return;
    }

    setSavingNeighborhoodId('new');
    setNeighborhoodStatus('');

    try {
      const response = await fetch('/api/settings/neighborhoods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: neighborhoodForm.name,
          paymentDay: neighborhoodForm.paymentDay,
          paymentEndDay: neighborhoodForm.paymentEndDay,
        }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Mahalle eklenemedi.');
      }

      setNeighborhoodForm({ name: '', paymentDay: '', paymentEndDay: '' });
      await refreshNeighborhoods();
      setNeighborhoodStatus('Mahalle eklendi.');
    } catch (saveError) {
      setNeighborhoodStatus((saveError as Error).message);
    } finally {
      setSavingNeighborhoodId(null);
    }
  };

  // API artik KISMI guncelleme destekliyor - body'de SADECE gonderilen alan
  // degistiriliyor (bkz. app/api/settings/neighborhoods/route.ts PATCH), bu
  // yuzden burada sadece degisen tek alani gondermek yeterli, diger alanlari
  // (mahalle adi, diger gun) tekrar gondermeye/korumaya gerek yok.
  const updateNeighborhoodPaymentDay = async (neighborhood: NeighborhoodRow, paymentDay: string) => {
    setSavingNeighborhoodId(neighborhood.id);
    setNeighborhoodStatus('');

    try {
      const response = await fetch('/api/settings/neighborhoods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: neighborhood.id, paymentDay }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Ödeme başlangıç günü güncellenemedi.');
      }

      await refreshNeighborhoods();
      setNeighborhoodStatus('Ödeme başlangıç günü güncellendi.');
    } catch (saveError) {
      setNeighborhoodStatus((saveError as Error).message);
    } finally {
      setSavingNeighborhoodId(null);
    }
  };

  const updateNeighborhoodPaymentEndDay = async (neighborhood: NeighborhoodRow, paymentEndDay: string) => {
    setSavingNeighborhoodId(neighborhood.id);
    setNeighborhoodStatus('');

    try {
      const response = await fetch('/api/settings/neighborhoods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: neighborhood.id, paymentEndDay }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Ödeme bitiş günü güncellenemedi.');
      }

      await refreshNeighborhoods();
      setNeighborhoodStatus('Ödeme bitiş günü güncellendi.');
    } catch (saveError) {
      setNeighborhoodStatus((saveError as Error).message);
    } finally {
      setSavingNeighborhoodId(null);
    }
  };

  // "Güncelle" butonu ONCEDEN sadece odeme gunu gonderiyordu - mahalle adi
  // hem API'de hem burada hic gonderilmiyordu, bu yuzden isim satirdaki
  // duz metin olarak SABIT kalip DUZENLENEMIYORDU (kullanicinin bildirdigi
  // sorunun kok nedeni buydu). Artik isim de duzenlenebilir bir input ve
  // Guncelle butonu ucunu (isim, baslangic gunu, bitis gunu) BIRLIKTE gonderiyor.
  const updateNeighborhood = async (neighborhood: NeighborhoodRow, name: string, paymentDay: string, paymentEndDay: string) => {
    if (!name.trim()) {
      setNeighborhoodStatus('Mahalle adı boş bırakılamaz.');
      return;
    }

    setSavingNeighborhoodId(neighborhood.id);
    setNeighborhoodStatus('');

    try {
      const response = await fetch('/api/settings/neighborhoods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: neighborhood.id, name, paymentDay, paymentEndDay }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Mahalle güncellenemedi.');
      }

      await refreshNeighborhoods();
      setNeighborhoodStatus('Mahalle bilgileri güncellendi.');
    } catch (saveError) {
      setNeighborhoodStatus((saveError as Error).message);
    } finally {
      setSavingNeighborhoodId(null);
    }
  };

  // "Tüm Mahallelere Uygula" - burada belirlenen odeme baslangic/bitis gunu,
  // TEK SEFERDE tum mahallelere uygulanir (API tarafinda "applyToAll" bayragi
  // ile TEK bir UPDATE sorgusu calisir, 71 mahalle icin tek tek istek atmaya
  // gerek kalmaz). En az bir alan doldurulmus olmali; bos birakilan alan
  // mevcut degerleri DEGISTIRMEZ (kismi guncelleme, bkz. API route.ts).
  const applyPaymentDayToAllNeighborhoods = async () => {
    const { paymentDay, paymentEndDay } = bulkPaymentDayForm;
    if (!paymentDay.trim() && !paymentEndDay.trim()) {
      setNeighborhoodStatus('Uygulanacak ödeme başlangıç veya bitiş günü zorunludur.');
      return;
    }

    const parts: string[] = [];
    if (paymentDay.trim()) parts.push(`başlangıç günü ${paymentDay}`);
    if (paymentEndDay.trim()) parts.push(`bitiş günü ${paymentEndDay}`);
    if (!(await confirmDialog(`Ödeme ${parts.join(' ve ')} bilgisi TÜM mahallelere (${neighborhoods.length} kayıt) uygulanacak. Devam etmek istiyor musunuz?`))) return;

    setIsApplyingBulkPaymentDay(true);
    setNeighborhoodStatus('');

    try {
      const body: Record<string, unknown> = { applyToAll: true };
      if (paymentDay.trim()) body.paymentDay = paymentDay;
      if (paymentEndDay.trim()) body.paymentEndDay = paymentEndDay;

      const response = await fetch('/api/settings/neighborhoods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Ödeme günü tüm mahallelere uygulanamadı.');
      }

      await refreshNeighborhoods();
      setNeighborhoodStatus(`Ödeme günü bilgisi ${neighborhoods.length} mahalleye uygulandı.`);
    } catch (bulkError) {
      setNeighborhoodStatus((bulkError as Error).message);
    } finally {
      setIsApplyingBulkPaymentDay(false);
    }
  };

  const deleteNeighborhood = async (neighborhood: NeighborhoodRow) => {
    if (!(await confirmDialog(`${neighborhood.name || 'Seçili mahalle'} silinsin mi?`))) return;

    setSavingNeighborhoodId(neighborhood.id);
    setNeighborhoodStatus('');

    try {
      const response = await fetch('/api/settings/neighborhoods', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: neighborhood.id }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Mahalle silinemedi.');
      }

      await refreshNeighborhoods();
      setNeighborhoodStatus('Mahalle silindi.');
    } catch (deleteError) {
      setNeighborhoodStatus((deleteError as Error).message);
    } finally {
      setSavingNeighborhoodId(null);
    }
  };

  // "Yetkili Personeller" listesi generic /api/settings (key/value) uzerinden
  // saklanir - "Kullanıcılar" sayfasindaki gibi yeni bir tablo GEREKMEZ,
  // sadece settingsUsers icindeki kullanicilarin ID'lerine referans tutulur.
  // Her degisiklik ANINDA kaydedilir (Mahalle Listesi'ndeki gibi - ustteki
  // "Değişiklikleri Kaydet" butonuna basmaya gerek yoktur).
  const persistAuthorizedPersonnel = async (next: AuthorizedPersonnelEntry[]) => {
    setIsSavingAuthorizedPersonnel(true);
    setAuthorizedPersonnelStatus('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: AUTHORIZED_PERSONNEL_SETTING_KEY, value: next, type: 'json' }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Yetkili personel listesi kaydedilemedi.');
      }

      setAuthorizedPersonnel(next);
    } catch (saveError) {
      setAuthorizedPersonnelStatus((saveError as Error).message);
    } finally {
      setIsSavingAuthorizedPersonnel(false);
    }
  };

  // "WhatsApp Web" - wa.me link tabanli basit entegrasyon, API anahtari/Meta
  // hesabi GEREKMEZ. Buradaki numara SADECE bilgilendirme/etiket amaclidir -
  // "SMS Gönder" penceresindeki "WhatsApp'tan Gönder" butonu buraya bakmaz,
  // dogrudan o an kullanicinin tarayicisinda/telefonunda ACIK olan WhatsApp
  // hesabini kullanir (wa.me boyle calisir).
  const persistWhatsappSettings = async () => {
    setIsSavingWhatsapp(true);
    setWhatsappStatus('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: WHATSAPP_SETTINGS_KEY, value: whatsappSettingsForm, type: 'json' }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'WhatsApp Web ayarları kaydedilemedi.');
      }

      setWhatsappSettings(whatsappSettingsForm);
      setWhatsappStatus('WhatsApp Web ayarları kaydedildi.');
    } catch (saveError) {
      setWhatsappStatus((saveError as Error).message);
    } finally {
      setIsSavingWhatsapp(false);
    }
  };

  const addAuthorizedPersonnel = async (userId: string) => {
    if (authorizedPersonnel.some(entry => entry.userId === userId)) return;
    const next = [...authorizedPersonnel, { userId, title: '', addedAt: new Date().toISOString() }];
    await persistAuthorizedPersonnel(next);
    setAuthorizedPersonnelStatus('Yetkili personel eklendi.');
  };

  const removeAuthorizedPersonnel = async (entry: AuthorizedPersonnelEntry) => {
    const user = settingsUsers.find(u => u.id === entry.userId);
    if (!(await confirmDialog(`${user?.name || user?.username || 'Seçili personel'} yetkili personel listesinden çıkarılsın mı?`))) return;

    const next = authorizedPersonnel.filter(item => item.userId !== entry.userId);
    await persistAuthorizedPersonnel(next);
    setAuthorizedPersonnelStatus('Yetkili personel listeden çıkarıldı.');
  };

  const updateAuthorizedPersonnelTitle = async (userId: string, title: string) => {
    const next = authorizedPersonnel.map(entry => entry.userId === userId ? { ...entry, title } : entry);
    await persistAuthorizedPersonnel(next);
  };

  const handleGeneralLogoChange = (file?: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setGeneralSettingsStatus('Lütfen geçerli bir görsel dosyası seçin.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setGeneralSettingsStatus('Logo dosyası 2 MB sınırını aşmamalıdır.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateGeneralSetting('logoDataUrl', String(reader.result || ''));
      setGeneralSettingsStatus('Logo önizlemeye eklendi. Kalıcı olması için değişiklikleri kaydedin.');
    };
    reader.onerror = () => setGeneralSettingsStatus('Logo dosyası okunamadı.');
    reader.readAsDataURL(file);
  };

  const saveGeneralSettings = async () => {
    setIsSavingGeneralSettings(true);
    setGeneralSettingsStatus('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: GENERAL_SETTINGS_KEY,
          value: generalSettings,
          type: 'json',
        }),
      });
      const payload = (await response.json()) as SettingResponse<GeneralSettings>;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Genel ayarlar kaydedilemedi.');
      }

      setGeneralSettingsStatus('Genel ayarlar kaydedildi.');
    } catch (saveError) {
      setGeneralSettingsStatus((saveError as Error).message);
    } finally {
      setIsSavingGeneralSettings(false);
    }
  };

  const updateSmsProviderSetting = <K extends keyof SmsProviderSettings>(
    providerId: SmsProviderId,
    key: K,
    value: SmsProviderSettings[K],
  ) => {
    setSmsSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [providerId]: {
          ...prev.providers[providerId],
          [key]: value,
        },
      },
    }));
  };

  const updateSmsTemplate = (templateId: string, updates: Partial<SmsMessageTemplate>) => {
    setSmsSettings(prev => ({
      ...prev,
      templates: prev.templates.map(template => (
        template.id === templateId ? { ...template, ...updates } : template
      )),
    }));
  };

  const addSmsTemplate = () => {
    const id = `template_${Date.now()}`;
    setSmsSettings(prev => ({
      ...prev,
      templates: [
        ...prev.templates,
        {
          id,
          title: 'Yeni SMS Kalıbı',
          text: 'Sayın {adSoyad}, mesaj metninizi buraya yazın. {kurum}',
          active: true,
        },
      ],
    }));
  };

  const removeSmsTemplate = (templateId: string) => {
    setSmsSettings(prev => ({
      ...prev,
      templates: prev.templates.length > 1
        ? prev.templates.filter(template => template.id !== templateId)
        : prev.templates,
    }));
  };

  const saveSmsSettings = async () => {
    setIsSavingSmsSettings(true);
    setSmsSettingsStatus('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: SMS_INTEGRATION_SETTINGS_KEY,
          value: smsSettings,
          type: 'json',
        }),
      });
      const payload = (await response.json()) as SettingResponse<SmsIntegrationSettings>;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'SMS entegrasyon ayarları kaydedilemedi.');
      }

      setSmsSettingsStatus('SMS entegrasyon ayarları kaydedildi.');
    } catch (saveError) {
      setSmsSettingsStatus((saveError as Error).message);
    } finally {
      setIsSavingSmsSettings(false);
    }
  };

  // Kullanici istegi: SMS entegrasyonunun (ör. Mutlucell) GERCEKTEN calisip
  // calismadigini, ayarlar formuna girilen bilgilerle canli test edebilme -
  // /api/sms/send AYNI (dosya sayfasindaki "SMS Gönder" ile ayni) genel
  // gonderim ucuna, "Test Telefonu" alanina sabit bir test metniyle istek
  // atar. Testin GUNCEL FORM verileriyle calismasi icin once (varsa
  // kaydedilmemis) degisiklikler kaydedilir, sonra gonderim denenir - aksi
  // halde kullanici formda bir alani duzeltip hemen test etse bile eski
  // (kaydedilmemis) ayarlarla test edilmis olurdu. NOT: /api/sms/send her
  // zaman o an "Aktif Sağlayıcı" olarak seçili firma uzerinden gonderir -
  // bu yuzden test SADECE aktif saglayici karti icin sunulur (baska bir
  // karttaki bilgiyle "test ettim ama aslinda baska firma gitti" gibi
  // yaniltici bir durumdan kacinmak icin).
  const testSmsProvider = async (providerId: SmsProviderId) => {
    const providerSettings = smsSettings.providers[providerId];
    const testPhone = providerSettings.testPhone.trim();
    if (!testPhone) {
      setSmsProviderTestStatus(prev => ({ ...prev, [providerId]: { status: 'error', message: 'Önce "Test Telefonu" alanını doldurun.' } }));
      return;
    }

    setSmsProviderTestStatus(prev => ({ ...prev, [providerId]: { status: 'sending', message: '' } }));

    try {
      const saveResponse = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: SMS_INTEGRATION_SETTINGS_KEY, value: smsSettings, type: 'json' }),
      });
      const savePayload = (await saveResponse.json()) as SettingResponse<SmsIntegrationSettings>;
      if (!saveResponse.ok || !savePayload.success) {
        throw new Error(savePayload.error || 'Ayarlar kaydedilemedi, test gönderilemedi.');
      }

      const response = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhone,
          message: 'Bu bir test mesajıdır - Sosyal Yardım Yönetim Sistemi SMS Entegrasyonu.',
          adSoyad: 'Test Gönderimi',
        }),
      });
      const payload = (await response.json()) as { success: boolean; error?: string };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Test SMS gönderilemedi.');
      }

      setSmsProviderTestStatus(prev => ({ ...prev, [providerId]: { status: 'success', message: `Test SMS "${testPhone}" numarasına başarıyla gönderildi.` } }));
    } catch (testError) {
      setSmsProviderTestStatus(prev => ({ ...prev, [providerId]: { status: 'error', message: (testError as Error).message } }));
    }
  };

  const ensureUserPermissionConfig = (userId: string): UserPermissionConfig => {
    return userPermissions[userId] ?? {
      userId,
      isActive: settingsUsers.find(user => user.id === userId)?.status !== 0,
      isAdmin: true,
      allowedPages: permissionPages.map(page => page.path),
      allowedActions: USER_ACTION_PERMISSION_DEFINITIONS.map(action => action.id),
    };
  };

  const updateUserPermissionConfig = (userId: string, updater: (config: UserPermissionConfig) => UserPermissionConfig) => {
    setUserPermissions(prev => ({
      ...prev,
      [userId]: updater(prev[userId] ?? {
        userId,
        isActive: settingsUsers.find(user => user.id === userId)?.status !== 0,
        isAdmin: true,
        allowedPages: permissionPages.map(page => page.path),
        allowedActions: USER_ACTION_PERMISSION_DEFINITIONS.map(action => action.id),
      }),
    }));
  };

  const toggleUserPagePermission = (userId: string, path: string) => {
    updateUserPermissionConfig(userId, config => {
      const allowedPages = config.allowedPages.includes(path)
        ? config.allowedPages.filter(item => item !== path)
        : [...config.allowedPages, path];

      return { ...config, isAdmin: false, allowedPages };
    });
  };

  const toggleUserActionPermission = (userId: string, actionId: string) => {
    updateUserPermissionConfig(userId, config => {
      const allowedActions = config.allowedActions.includes(actionId)
        ? config.allowedActions.filter(item => item !== actionId)
        : [...config.allowedActions, actionId];

      return { ...config, isAdmin: false, allowedActions };
    });
  };

  // Bir islem yetkisi "Tam sureli" ile "Zaman araligi" arasinda gecis yapar.
  // "Zaman araligi" secildiginde actionSchedules'a bos bir obje eklenir (bu,
  // henuz hicbir alan doldurulmamis olsa da modun "Zaman araligi" oldugunu
  // isaretler); "Tam sureli"ye donulunce kayit tamamen silinir.
  const setUserActionScheduleMode = (userId: string, actionId: string, mode: 'always' | 'window') => {
    updateUserPermissionConfig(userId, config => {
      const nextSchedules = { ...(config.actionSchedules ?? {}) };
      if (mode === 'window') {
        nextSchedules[actionId] = nextSchedules[actionId] ?? {};
      } else {
        delete nextSchedules[actionId];
      }
      return { ...config, isAdmin: false, actionSchedules: nextSchedules };
    });
  };

  const updateUserActionScheduleField = (
    userId: string,
    actionId: string,
    field: keyof ActionPermissionSchedule,
    value: string,
  ) => {
    updateUserPermissionConfig(userId, config => {
      const current = config.actionSchedules?.[actionId] ?? {};
      return {
        ...config,
        isAdmin: false,
        actionSchedules: {
          ...config.actionSchedules,
          [actionId]: { ...current, [field]: value || undefined },
        },
      };
    });
  };

  // Kullanicinin PROGRAMA GIRIS yapabilecegi gun/saat kisiti (islem
  // yetkilerinden BAGIMSIZ - "hafta sonu giremesin" / "17:00'dan sonra
  // giremesin" gibi hesap bazli bir kisit). toggleUserLoginWeekday bir gunu
  // acar/kapatir; ilk kapatilan gunde (henuz hicbir gun secili degilse)
  // otomatik olarak "diger 6 gun acik" ile baslatilir - boylece kullanici
  // "her gun -> tek bir gunu kapat" seklinde dogal bir akisla kisitlayabilir.
  const toggleUserLoginWeekday = (userId: string, weekday: number) => {
    updateUserPermissionConfig(userId, config => {
      const current = config.loginSchedule?.allowedWeekdays?.length
        ? config.loginSchedule.allowedWeekdays
        : ALL_WEEKDAYS;
      const nextWeekdays = current.includes(weekday)
        ? current.filter(day => day !== weekday)
        : [...current, weekday].sort();

      return {
        ...config,
        isAdmin: false,
        loginSchedule: {
          ...config.loginSchedule,
          allowedWeekdays: nextWeekdays.length === 7 ? undefined : nextWeekdays,
        },
      };
    });
  };

  const updateUserLoginScheduleTime = (userId: string, field: 'timeStart' | 'timeEnd', value: string) => {
    updateUserPermissionConfig(userId, config => ({
      ...config,
      isAdmin: false,
      loginSchedule: { ...config.loginSchedule, [field]: value || undefined },
    }));
  };

  const updateSelectedUserStatus = (userId: string, isActive: boolean) => {
    setSettingsUsers(prev => prev.map(user => (
      user.id === userId ? { ...user, status: isActive ? 1 : 0 } : user
    )));
    updateUserPermissionConfig(userId, config => ({
      ...config,
      isActive,
    }));
  };

  const saveUserPermissions = async () => {
    setIsSavingUserPermissions(true);
    setUserPermissionStatus('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: USER_PERMISSIONS_SETTING_KEY,
          value: userPermissions,
          type: 'json',
        }),
      });
      const payload = (await response.json()) as SettingResponse<UserPermissionsById>;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kullanıcı yetkileri kaydedilemedi.');
      }

      if (selectedPermissionUser) {
        const selectedConfig = ensureUserPermissionConfig(selectedPermissionUser.id);
        const userResponse = await fetch(`/api/users/${selectedPermissionUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: selectedPermissionUser.name,
            username: selectedPermissionUser.username,
            email: selectedPermissionUser.email,
            status: selectedConfig.isActive === false ? 0 : 1,
          }),
        });
        const userPayload = await userResponse.json();

        if (!userResponse.ok || !userPayload.success) {
          throw new Error(userPayload.error || 'Kullanıcı aktif/pasif durumu kaydedilemedi.');
        }
      }

      setUserPermissionStatus('Kullanıcı yetkileri kaydedildi.');
    } catch (saveError) {
      setUserPermissionStatus((saveError as Error).message);
    } finally {
      setIsSavingUserPermissions(false);
    }
  };

  const saveActiveSettings = () => {
    // Hata duzeltmesi: "Yardım Kriterleri" sekmesi de AYNI predefinedValues/
    // predefinedValueTitles state'ini kullaniyor (bkz. YardimKriterleriTab) -
    // bu sekme icin ayri bir dal EKSIKTI, bu yuzden o sekmedeyken "Değişiklikleri
    // Kaydet"e basmak HICBIR SEY yapmiyordu (kullanicinin eklediği kriterler
    // hic kaydedilmiyordu).
    if (activeTab === 'predefinedValues' || activeTab === 'yardimKriterleri') {
      savePredefinedValues();
      return;
    }

    if (activeTab === 'online') {
      saveOnlineForms();
      return;
    }

    if (activeTab === 'formDesign') {
      saveFormDesigns();
      return;
    }

    if (activeTab === 'userPermissions') {
      saveUserPermissions();
      return;
    }

    if (activeTab === 'general') {
      saveGeneralSettings();
      return;
    }

    if (activeTab === 'sms') {
      saveSmsSettings();
      return;
    }

    if (activeTab === 'databaseBackups') {
      saveDatabaseBackupSettings();
      return;
    }
  };

  const handleServiceChange = (id: NviService['id'], field: keyof NviService, value: string | boolean) => {
    setServices(currentServices =>
      currentServices.map(s => s.id === id ? { ...s, [field]: value } : s)
    );
  };

  const handlePredefinedValueChange = (category: string, index: number, field: keyof PredefinedValue, value: string) => {
    setPredefinedValues(prev => ({ ...prev, [category]: prev[category].map((item, i) => i === index ? { ...item, [field]: value } : item) }));
  };

  const handlePredefinedTitleChange = (category: string, value: string) => {
    setPredefinedValueTitles(prev => ({ ...prev, [category]: value }));
  };

  const addPredefinedValue = (category: string) => {
    setPredefinedValues(prev => ({ ...prev, [category]: [...prev[category], { id: '', name: '' }] }));
  };

  const refreshScheduledTasks = async () => {
    const response = await fetch('/api/scheduled-sql-tasks');
    const payload = (await response.json()) as ScheduledSqlTasksResponse;

    if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
      throw new Error(payload.error || 'Zamanlanmış görevler alınamadı.');
    }

    setScheduledTasks(payload.data);
  };

  const resetScheduledTaskForm = () => {
    setScheduledTaskForm(emptyScheduledTaskForm);
    setEditingScheduledTaskId(null);
  };

  const editScheduledTask = (task: ScheduledSqlTask) => {
    setEditingScheduledTaskId(task.id);
    setScheduledTaskForm({
      name: task.name,
      query: task.query,
      scheduleType: task.scheduleType,
      dayOfWeek: task.dayOfWeek ?? 1,
      timeOfDay: task.timeOfDay,
      enabled: task.enabled,
    });
    setActiveTab('scheduledTasks');
  };

  const saveScheduledTask = async () => {
    setIsSavingScheduledTask(true);
    setScheduledTaskStatus('');

    try {
      const response = await fetch('/api/scheduled-sql-tasks', {
        method: editingScheduledTaskId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingScheduledTaskId,
          ...scheduledTaskForm,
          dayOfWeek: scheduledTaskForm.scheduleType === 'weekly' ? scheduledTaskForm.dayOfWeek : null,
        }),
      });
      const payload = (await response.json()) as ScheduledSqlTasksResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Görev kaydedilemedi.');
      }

      await refreshScheduledTasks();
      resetScheduledTaskForm();
      setScheduledTaskStatus('Zamanlanmış görev kaydedildi.');
    } catch (saveError) {
      setScheduledTaskStatus((saveError as Error).message);
    } finally {
      setIsSavingScheduledTask(false);
    }
  };

  const deleteScheduledTask = async (id: number) => {
    if (!(await confirmDialog('Bu zamanlanmış görevi silmek istiyor musunuz?'))) return;

    setScheduledTaskStatus('');
    try {
      const response = await fetch(`/api/scheduled-sql-tasks?id=${id}`, { method: 'DELETE' });
      const payload = (await response.json()) as ScheduledSqlTasksResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Görev silinemedi.');
      }

      await refreshScheduledTasks();
      if (editingScheduledTaskId === id) resetScheduledTaskForm();
      setScheduledTaskStatus('Zamanlanmış görev silindi.');
    } catch (deleteError) {
      setScheduledTaskStatus((deleteError as Error).message);
    }
  };

  const runScheduledTaskNow = async (id: number) => {
    setRunningScheduledTaskId(id);
    setScheduledTaskStatus('');

    try {
      const response = await fetch('/api/scheduled-sql-tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json()) as ScheduledSqlTasksResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Görev çalıştırılamadı.');
      }

      await refreshScheduledTasks();
      setScheduledTaskStatus('Görev çalıştırıldı.');
    } catch (runError) {
      setScheduledTaskStatus((runError as Error).message);
    } finally {
      setRunningScheduledTaskId(null);
    }
  };

  const formatScheduledTaskDate = (value: string | null) => {
    if (!value) return '-';
    return new Intl.DateTimeFormat('tr-TR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  };

  const formatBackupSize = (value: number) => {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const getDatabaseOptionLabel = (databaseName: string) => (
    databaseBackupOptions.find(option => option.name === databaseName)?.label || databaseName
  );

  const toggleDatabaseBackupSelection = (databaseName: string) => {
    setDatabaseBackupSettings(current => {
      const isSelected = current.databaseNames.includes(databaseName);
      const databaseNames = isSelected
        ? current.databaseNames.filter(name => name !== databaseName)
        : [...current.databaseNames, databaseName];

      return {
        ...current,
        databaseName: databaseNames[0] || current.databaseName,
        databaseNames,
      };
    });
  };

  const toggleScheduleDatabaseSelection = (scheduleId: string, databaseName: string) => {
    setDatabaseBackupSettings(current => ({
      ...current,
      schedules: current.schedules.map(schedule => {
        if (schedule.id !== scheduleId) return schedule;

        const isSelected = schedule.databaseNames.includes(databaseName);
        return {
          ...schedule,
          databaseNames: isSelected
            ? schedule.databaseNames.filter(name => name !== databaseName)
            : [...schedule.databaseNames, databaseName],
        };
      }),
    }));
  };

  const updateDatabaseBackupSchedule = (scheduleId: string, patch: Partial<DatabaseBackupSchedule>) => {
    setDatabaseBackupSettings(current => ({
      ...current,
      schedules: current.schedules.map(schedule => (
        schedule.id === scheduleId ? { ...schedule, ...patch } : schedule
      )),
    }));
  };

  const addDatabaseBackupSchedule = () => {
    setDatabaseBackupSettings(current => ({
      ...current,
      schedules: [
        ...current.schedules,
        {
          id: `schedule-${Date.now()}`,
          name: `Program ${current.schedules.length + 1}`,
          enabled: true,
          databaseNames: current.databaseNames.length > 0 ? current.databaseNames : databaseBackupOptions.slice(0, 1).map(option => option.name),
          scheduleType: 'daily',
          dayOfWeek: null,
          timeOfDay: '02:00',
          lastRunAt: null,
          lastStatus: 'idle',
          lastMessage: null,
        },
      ],
    }));
  };

  const removeDatabaseBackupSchedule = (scheduleId: string) => {
    setDatabaseBackupSettings(current => ({
      ...current,
      schedules: current.schedules.filter(schedule => schedule.id !== scheduleId),
    }));
  };

  const applyDatabaseBackupPayload = (data: NonNullable<DatabaseBackupsResponse['data']>) => {
    setDatabaseBackupSettings(data.settings);
    setDatabaseBackups(data.backups);
    setDatabaseBackupOptions(data.databaseOptions ?? (
      data.settings.databaseName
        ? [{ name: data.settings.databaseName, label: data.settings.databaseName, isCurrent: true }]
        : []
    ));
  };

  const refreshDatabaseBackups = async () => {
    setIsLoadingDatabaseBackups(true);

    try {
      const response = await fetch('/api/settings/database-backups');
      const payload = (await response.json()) as DatabaseBackupsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Veritabani yedekleri alinamadi.');
      }

      applyDatabaseBackupPayload(payload.data);
      setSelectedRestoreBackup(current => (
        current && payload.data?.backups.some(backup => backup.fileName === current)
          ? current
          : payload.data?.backups[0]?.fileName ?? ''
      ));
    } catch (refreshError) {
      setDatabaseBackupStatus((refreshError as Error).message);
    } finally {
      setIsLoadingDatabaseBackups(false);
    }
  };

  const loadFolderPicker = async (folderPath?: string) => {
    setIsLoadingFolderPicker(true);
    setFolderPickerStatus('');

    try {
      const query = folderPath ? `?path=${encodeURIComponent(folderPath)}` : '';
      const response = await fetch(`/api/settings/folders${query}`);
      const payload = (await response.json()) as FolderPickerResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Klasorler alinamadi.');
      }

      setFolderPickerData(payload.data);
    } catch (folderError) {
      setFolderPickerStatus((folderError as Error).message);
    } finally {
      setIsLoadingFolderPicker(false);
    }
  };

  const openFolderPicker = () => {
    setIsFolderPickerOpen(true);
    void loadFolderPicker(databaseBackupSettings.backupDirectory);
  };

  const selectCurrentBackupFolder = () => {
    if (!folderPickerData?.currentPath) return;

    setDatabaseBackupSettings(current => ({
      ...current,
      backupDirectory: folderPickerData.currentPath,
    }));
    setIsFolderPickerOpen(false);
  };

  const saveDatabaseBackupSettings = async () => {
    setIsSavingDatabaseBackupSettings(true);
    setDatabaseBackupStatus('');

    try {
      const response = await fetch('/api/settings/database-backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-settings',
          settings: databaseBackupSettings,
        }),
      });
      const payload = (await response.json()) as DatabaseBackupsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Veritabani yedekleme ayarlari kaydedilemedi.');
      }

      applyDatabaseBackupPayload(payload.data);
      setDatabaseBackupStatus(payload.message || 'Veritabani yedekleme ayarlari kaydedildi.');
      return true;
    } catch (saveError) {
      setDatabaseBackupStatus((saveError as Error).message);
      return false;
    } finally {
      setIsSavingDatabaseBackupSettings(false);
    }
  };

  const runDatabaseBackupNow = async () => {
    setIsRunningDatabaseBackup(true);
    setDatabaseBackupStatus('');

    try {
      const settingsSaved = await saveDatabaseBackupSettings();
      if (!settingsSaved) return;

      const response = await fetch('/api/settings/database-backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backup-now' }),
      });
      const payload = (await response.json()) as DatabaseBackupsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Veritabani yedegi alinamadi.');
      }

      applyDatabaseBackupPayload(payload.data);
      setSelectedRestoreBackup(payload.data.backups[0]?.fileName ?? '');
      setDatabaseBackupStatus(payload.message || 'Veritabani yedegi alindi.');
    } catch (backupError) {
      setDatabaseBackupStatus((backupError as Error).message);
    } finally {
      setIsRunningDatabaseBackup(false);
    }
  };

  const restoreDatabaseBackup = async () => {
    if (!selectedRestoreBackup) {
      setDatabaseBackupStatus('Geri yuklenecek yedek dosyasini secin.');
      return;
    }

    const selectedBackup = databaseBackups.find(backup => backup.fileName === selectedRestoreBackup);
    if (!(await confirmDialog(`Secili yedek "${selectedBackup?.databaseName || databaseBackupSettings.databaseName || '-'}" veritabani uzerine geri yuklenecek. Devam etmek istiyor musunuz?`))) return;

    setIsRestoringDatabaseBackup(true);
    setDatabaseBackupStatus('');

    try {
      const response = await fetch('/api/settings/database-backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore',
          fileName: selectedRestoreBackup,
        }),
      });
      const payload = (await response.json()) as DatabaseBackupsResponse;

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Veritabani yedegi geri yuklenemedi.');
      }

      applyDatabaseBackupPayload(payload.data);
      setDatabaseBackupStatus(payload.message || 'Veritabani yedegi geri yuklendi.');
    } catch (restoreError) {
      setDatabaseBackupStatus((restoreError as Error).message);
    } finally {
      setIsRestoringDatabaseBackup(false);
    }
  };

  const formatPersonnelDate = (value: string | null) => {
    if (!value) return '-';
    return new Intl.DateTimeFormat('tr-TR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  };

  const getPersonnelBreakdowns = (rows: PersonnelPerformanceBreakdown[], userName: string, limit = 5) =>
    rows.filter((row) => row.userName === userName).slice(0, limit);

  const personnelTotals = personnelPerformance?.users.reduce(
    (acc, user) => ({
      total: acc.total + user.total,
      daily: acc.daily + user.daily,
      weekly: acc.weekly + user.weekly,
      monthly: acc.monthly + user.monthly,
    }),
    { total: 0, daily: 0, weekly: 0, monthly: 0 },
  ) ?? { total: 0, daily: 0, weekly: 0, monthly: 0 };

  const removePredefinedValue = (category: string, index: number) => {
    setPredefinedValues(prev => ({ ...prev, [category]: prev[category].filter((_, i) => i !== index) }));
  };

  const removePredefinedValueList = (category: string) => {
    setPredefinedValueTitles(prev => {
      const next = { ...prev };
      delete next[category];
      return next;
    });
    setPredefinedValues(prev => {
      const next = { ...prev };
      delete next[category];
      return next;
    });
  };

  const addNewPredefinedValueList = () => {
    if (!newCategoryTitle.trim()) return;
    const categoryKey = 'custom_' + Date.now();
    setPredefinedValueTitles(prev => ({ ...prev, [categoryKey]: newCategoryTitle }));
    setPredefinedValues(prev => ({ ...prev, [categoryKey]: [] }));
    setNewCategoryTitle('');
  };

  const addNewOnlineForm = () => {
    const newForm: OnlineApplication = {
      id: 'app_' + Date.now(),
      title: 'Yeni Başvuru Formu',
      active: false,
      criteria: normalizeOnlineApplicationCriteria(),
      intro: normalizeOnlineApplicationIntro(),
      fields: [
        { id: 'f_tc', label: 'T.C. Kimlik No', required: true, type: 'text', isFixed: true },
        { id: 'f_name', label: 'Ad Soyad', required: true, type: 'text', isFixed: true },
        { id: 'f_phone', label: 'Telefon', required: true, type: 'text' },
      ]
    };
    setOnlineForms(prev => [newForm, ...prev]);
    setSelectedOnlineFormId(newForm.id);
  };

  const updateOnlineForm = <K extends keyof OnlineApplication>(id: string, field: K, value: OnlineApplication[K]) => {
    setOnlineForms(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  // Kullanici istegi (2026-09-22, devam): "zamanı ve tarihi ayarladım
  // yayına girmedi" - kok neden: "Form Yayında" ana anahtari KAPALIYKEN
  // sadece zamanlama tarihi girmek YETERLI degildi (isFormCurrentlyPublished
  // once "active"i kontrol ediyor). Kullanicinin beklentisi "tarihi
  // girince otomatik yayina girsin" oldugundan, artik baslangic/bitis
  // tarihinden BIRINE (bos olmayan) deger girilince "Form Yayında"
  // otomatik ACILIR - kullanicinin ayrica hatirlayip checkbox'i isaretlemesi
  // GEREKMEZ. Tarihi TEMIZLEMEK (bos birakmak) ise "active"i OTOMATIK
  // KAPATMAZ - sadece manuel checkbox ile kapatilir (surpriz olmasin diye).
  const updateOnlineFormSchedule = (id: string, field: 'publishStartAt' | 'publishEndAt', value: string | null) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== id) return f;
      return { ...f, [field]: value, active: value ? true : f.active };
    }));
  };

  const updateOnlineFormCriteria = <K extends keyof OnlineApplicationCriteria>(id: string, field: K, value: OnlineApplicationCriteria[K]) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== id) return f;
      return {
        ...f,
        criteria: {
          ...normalizeOnlineApplicationCriteria(f.criteria),
          [field]: value,
        },
      };
    }));
  };

  const addOnlineFormCriterion = (id: string) => {
    const form = onlineForms.find(f => f.id === id);
    const criteria = normalizeOnlineApplicationCriteria(form?.criteria);
    const nextOption = ONLINE_CRITERION_OPTIONS.find(option => !criteria[option.enabledField]);
    if (!nextOption) return;

    setOnlineForms(prev => prev.map(f => {
      if (f.id !== id) return f;
      const nextCriteria = normalizeOnlineApplicationCriteria(f.criteria);
      return {
        ...f,
        criteria: {
          ...nextCriteria,
          [nextOption.enabledField]: true,
          ...(nextOption.valueField ? { [nextOption.valueField]: nextCriteria[nextOption.valueField] || nextOption.defaultValue || 1 } : {}),
        },
      };
    }));
  };

  const removeOnlineFormCriterion = (id: string, type: OnlineCriterionType) => {
    const option = ONLINE_CRITERION_OPTIONS.find(candidate => candidate.type === type);
    if (!option) return;

    updateOnlineFormCriteria(id, option.enabledField, false as OnlineApplicationCriteria[typeof option.enabledField]);
  };

  const changeOnlineFormCriterion = (id: string, currentType: OnlineCriterionType, nextType: OnlineCriterionType) => {
    if (currentType === nextType) return;
    const currentOption = ONLINE_CRITERION_OPTIONS.find(option => option.type === currentType);
    const nextOption = ONLINE_CRITERION_OPTIONS.find(option => option.type === nextType);
    if (!currentOption || !nextOption) return;

    setOnlineForms(prev => prev.map(f => {
      if (f.id !== id) return f;
      const nextCriteria = normalizeOnlineApplicationCriteria(f.criteria);
      return {
        ...f,
        criteria: {
          ...nextCriteria,
          [currentOption.enabledField]: false,
          [nextOption.enabledField]: true,
          ...(nextOption.valueField ? { [nextOption.valueField]: nextCriteria[nextOption.valueField] || nextOption.defaultValue || 1 } : {}),
        },
      };
    }));
  };

  const addOnlineManualCriterion = (id: string) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== id) return f;
      const nextCriteria = normalizeOnlineApplicationCriteria(f.criteria);
      return {
        ...f,
        criteria: {
          ...nextCriteria,
          manualInfoCriteria: [...nextCriteria.manualInfoCriteria, ''],
        },
      };
    }));
  };

  const updateOnlineManualCriterion = (id: string, index: number, value: string) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== id) return f;
      const nextCriteria = normalizeOnlineApplicationCriteria(f.criteria);
      return {
        ...f,
        criteria: {
          ...nextCriteria,
          manualInfoCriteria: nextCriteria.manualInfoCriteria.map((item, itemIndex) => itemIndex === index ? value : item),
        },
      };
    }));
  };

  const removeOnlineManualCriterion = (id: string, index: number) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== id) return f;
      const nextCriteria = normalizeOnlineApplicationCriteria(f.criteria);
      return {
        ...f,
        criteria: {
          ...nextCriteria,
          manualInfoCriteria: nextCriteria.manualInfoCriteria.filter((_, itemIndex) => itemIndex !== index),
        },
      };
    }));
  };

  const updateOnlineFormIntro = <K extends keyof OnlineApplicationIntro>(id: string, field: K, value: OnlineApplicationIntro[K]) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== id) return f;
      return {
        ...f,
        intro: {
          ...normalizeOnlineApplicationIntro(f.intro),
          [field]: value,
        },
      };
    }));
  };

  const handleOnlineIntroImageUpload = (formId: string, file?: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateOnlineFormIntro(formId, 'imageUrl', String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const removeOnlineForm = (id: string) => {
    setOnlineForms(prev => prev.filter(f => f.id !== id));
    if (selectedOnlineFormId === id) setSelectedOnlineFormId(null);
  };

  const addFieldToForm = (formId: string) => {
    if (!newFieldName.trim()) return;
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== formId) return f;
      return {
        ...f,
        fields: [...f.fields, {
          id: 'f_' + Date.now(),
          label: newFieldName,
          required: false,
          type: newFieldType,
          options: newFieldType === 'select' ? ['Var', 'Yok'] : undefined,
        }]
      };
    }));
    setNewFieldName('');
  };

  const removeFieldFromForm = (formId: string, fieldId: string) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== formId) return f;
      return { ...f, fields: f.fields.filter(field => field.id !== fieldId) };
    }));
  };

  const updateFieldInForm = <K extends keyof OnlineFormField>(formId: string, fieldId: string, key: K, value: OnlineFormField[K]) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== formId) return f;
      return {
        ...f,
        fields: f.fields.map(field => field.id === fieldId ? { ...field, [key]: value } : field)
      };
    }));
  };

  const updateFieldOptions = (formId: string, fieldId: string, rawValue: string) => {
    const options = rawValue
      .split(/[\n,]/)
      .map(option => option.trim())
      .filter(Boolean);
    updateFieldInForm(formId, fieldId, 'options', options);
  };

  const updateFieldCondition = (formId: string, fieldId: string, fieldKey: 'fieldId' | 'value', value: string) => {
    setOnlineForms(prev => prev.map(f => {
      if (f.id !== formId) return f;
      return {
        ...f,
        fields: f.fields.map(field => {
          if (field.id !== fieldId) return field;
          const current = field.showWhen || { fieldId: '', value: '' };
          const next = { ...current, [fieldKey]: value };
          return {
            ...field,
            showWhen: next.fieldId ? next : undefined,
          };
        }),
      };
    }));
  };

  const handleFormDesignChange = (id: string, field: keyof FormDesign, value: string) => {
    setFormDesigns(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  };

  const addNewFormDesign = () => {
    const newId = 'custom_' + Date.now();
    setFormDesigns(prev => [
      {
        id: newId, name: 'Yeni Tasarım', type: 'label', linkedAssistance: 'Tümü', content: '',
        bands: [{ id: 'bnd_' + Date.now(), type: 'MasterData', name: 'Ana Veri', height: 151 }], 
        blocks: []
      },
      ...prev
    ]);
    setSelectedFormDesignId(newId);
  };

  const removeFormDesign = (id: string) => {
    setFormDesigns(prev => prev.filter(d => d.id !== id));
    if (selectedFormDesignId === id) setSelectedFormDesignId(null);
  };

  const createBlockFromField = (field: ReportField, x = 24, y = 48): DesignBlock => ({
    id: 'blk_' + Date.now() + Math.random().toString(36).substring(2, 9),
    type: field.token.includes('barkod') || field.token.includes('qr') ? 'barcode' : 'variable',
    x,
    y,
    value: `{{${field.token}}}`,
    fontSize: 13,
    fontWeight: 'normal',
  });

  const addFieldToDesign = (designId: string, field: ReportField) => {
    setFormDesigns(prev => prev.map(design => {
      if (design.id !== designId) return design;
      const targetBandId = design.bands?.[0]?.id;
      const fieldCount = (design.blocks || []).length;
      return {
        ...design,
        blocks: [
          ...(design.blocks || []),
          { ...createBlockFromField(field, 24, 48 + fieldCount * 28), bandId: targetBandId }
        ]
      };
    }));
  };

  const handleDragStartTool = (toolType: DesignBlock['type']) => {
    setDraggedTool(toolType);
    setDraggedField(null);
  };

  const handleDragStartField = (field: ReportField) => {
    setDraggedField(field);
    setDraggedTool(null);
  };

  const handleDragStartBlock = (e: React.DragEvent, designId: string, block: DesignBlock) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDraggedBlock({ designId, blockId: block.id, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top });
    setSelectedBlockId(block.id);
  };

  const handleDropOnBand = (e: React.DragEvent, design: FormDesign, bandId: string) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (draggedField) {
      const newBlock: DesignBlock = {
        ...createBlockFromField(draggedField, Math.round(x), Math.round(y)),
        bandId,
      };
      setFormDesigns(prev => prev.map(d => d.id === design.id ? { ...d, blocks: [...(d.blocks || []), newBlock] } : d));
      setDraggedField(null);
    } else if (draggedTool) {
      const newBlock: DesignBlock = {
        id: 'blk_' + Date.now() + Math.random().toString(36).substring(2, 9),
        bandId,
        type: draggedTool,
        x: Math.round(x),
        y: Math.round(y),
        value: draggedTool === 'variable' ? '{{kisi.ad_soyad}}' : draggedTool === 'line' ? '200' : draggedTool === 'qrcode' ? '{{dosya.dosyano}}' : 'Yeni Metin',
        fontSize: 14,
        fontWeight: 'normal'
      };
      setFormDesigns(prev => prev.map(d => d.id === design.id ? { ...d, blocks: [...(d.blocks || []), newBlock] } : d));
      setDraggedTool(null);
    } else if (draggedBlock && draggedBlock.designId === design.id) {
      const finalX = Math.round(x - draggedBlock.offsetX);
      const finalY = Math.round(y - draggedBlock.offsetY);
      setFormDesigns(prev => prev.map(d => {
        if (d.id !== design.id) return d;
        return { ...d, blocks: (d.blocks || []).map(b => b.id === draggedBlock.blockId ? { ...b, x: finalX, y: finalY, bandId } : b) };
      }));
      setDraggedBlock(null);
    }
  };

  const addBand = (designId: string, type: ReportBand['type']) => {
    const bandNames = {
      ReportTitle: 'Rapor Başlığı',
      PageHeader: 'Sayfa Üstbilgisi',
      MasterData: 'Ana Veri (Data)',
      PageFooter: 'Sayfa Altbilgisi'
    };
    setFormDesigns(prev => prev.map(d => {
      if (d.id !== designId) return d;
      const newBand: ReportBand = { id: 'bnd_' + Date.now(), type, name: bandNames[type], height: 100 };
      return { ...d, bands: [...(d.bands || []), newBand] };
    }));
  };

  const updateBand = <K extends keyof ReportBand>(designId: string, bandId: string, field: K, value: ReportBand[K]) => {
    setFormDesigns(prev => prev.map(d => d.id === designId ? {
      ...d, bands: (d.bands || []).map(b => b.id === bandId ? { ...b, [field]: value } : b)
    } : d));
  };
  
  const selectedFormDesign = formDesigns.find(d => d.id === selectedFormDesignId);

  const deleteBand = (designId: string, bandId: string) => {
    setFormDesigns(prev => prev.map(d => d.id === designId ? {
      ...d,
      bands: (d.bands || []).filter(b => b.id !== bandId),
      blocks: (d.blocks || []).filter(b => b.bandId !== bandId)
    } : d));
  };

  const handleBlockUpdate = <K extends keyof DesignBlock>(designId: string, blockId: string, field: K, value: DesignBlock[K]) => {
    setFormDesigns(prev => prev.map(d => d.id === designId ? {
      ...d, blocks: (d.blocks || []).map(b => b.id === blockId ? { ...b, [field]: value } : b)
    } : d));
  };

  const removeBlock = (designId: string, blockId: string) => {
    setFormDesigns(prev => prev.map(d => d.id === designId ? { ...d, blocks: (d.blocks || []).filter(b => b.id !== blockId) } : d));
    setSelectedBlockId(null);
  };

  const generalContactItems = [
    { label: 'Adres', value: generalSettings.address },
    { label: 'Telefon', value: [generalSettings.phone1, generalSettings.phone2].filter(Boolean).join(' / ') },
    { label: 'E-posta', value: generalSettings.email },
    { label: 'Web', value: generalSettings.website, href: formatExternalUrl(generalSettings.website) },
  ].filter(item => item.value);
  const smsProviderMeta: Array<{ id: SmsProviderId; name: string; description: string }> = [
    {
      id: 'mutlucell',
      name: 'Mutlucell',
      description: 'Mutlucell SMS servis bilgileri ve gönderici başlığı.',
    },
    {
      id: 'ileti',
      name: 'İleti Bilgi Teknolojileri',
      description: 'İleti Bilgi Teknolojileri SMS API erişim bilgileri.',
    },
    {
      id: 'netgsm',
      name: 'NetGSM',
      description: 'NetGSM SMS API erişim bilgileri.',
    },
  ];
  // Filtre (mahalle adina gore) + siralama - "Sistem Ayarlari > Mahalle
  // Listesi"nde kullanicinin acikca istedigi gibi basliklara tiklanarak
  // siralanabilir, ust taraftaki arama kutusuyla da filtrelenebilir.
  const toggleNeighborhoodSort = (key: 'name' | 'paymentDay' | 'paymentEndDay') => {
    if (neighborhoodSortKey === key) {
      setNeighborhoodSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setNeighborhoodSortKey(key);
      setNeighborhoodSortDir('asc');
    }
  };
  const filteredSortedNeighborhoods = (() => {
    const term = neighborhoodSearchTerm.trim().toLocaleLowerCase('tr-TR');
    const filtered = term
      ? neighborhoods.filter(n => (n.name || '').toLocaleLowerCase('tr-TR').includes(term))
      : neighborhoods;
    const dir = neighborhoodSortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (neighborhoodSortKey === 'name') {
        return dir * (a.name || '').localeCompare(b.name || '', 'tr-TR');
      }
      const aVal = a[neighborhoodSortKey];
      const bVal = b[neighborhoodSortKey];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return dir * (aVal - bVal);
    });
  })();
  const neighborhoodSortIcon = (key: 'name' | 'paymentDay' | 'paymentEndDay') => (
    <span className="text-[10px] opacity-80">
      {neighborhoodSortKey === key ? (neighborhoodSortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  const neighborhoodListPanel = (
    <div className="overflow-hidden rounded-2xl border border-slate-300 shadow-[0_18px_45px_rgba(15,30,43,0.10)] ring-1 ring-slate-200">
      <div className="flex items-center gap-3 bg-[#1E2A38] px-6 py-5 text-white">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.752a1.125 1.125 0 00-1.006 0L3.622 6.189C3.24 6.38 3 6.77 3 7.195v11.485c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
          </svg>
        </div>
        <div>
          <p className="text-base font-black uppercase tracking-wide text-white/80">Sistem Ayarları</p>
          <h3 className="text-3xl font-black leading-tight">Mahalle Listesi ve Ödeme Günleri</h3>
        </div>
        <span className="ml-auto rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xl font-black">
          {neighborhoods.length} mahalle
        </span>
      </div>

      <div className="space-y-5 bg-white p-6">
        {neighborhoodStatus && (
          <div className="rounded-lg border-2 border-sky-200 bg-sky-50 px-4 py-3 text-xl font-bold text-[#005f95]">
            {neighborhoodStatus}
          </div>
        )}

        {/* Yeni mahalle ekleme ve toplu guncelleme, kullanicinin acikca
            istegi uzerine listenin SAGINDA sabit bir panelde - listenin
            USTUNDE ayri bir "ekle" alani KASTEN yok, tek ekleme yolu bu
            sag panel. */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
          <div className="overflow-hidden rounded-xl border-2 border-slate-300 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="h-6 w-1.5 rounded-full bg-[#1E2A38]" />
                <span className="text-xl font-black uppercase text-slate-500">Toplam kayıt</span>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-lg font-black text-[#005f95]">
                  {filteredSortedNeighborhoods.length}/{neighborhoods.length} mahalle
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                      <circle cx="9" cy="9" r="6" />
                      <path d="M17 17l-3.5-3.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={neighborhoodSearchTerm}
                    onChange={(event) => setNeighborhoodSearchTerm(event.target.value)}
                    placeholder="Mahalle ara..."
                    className="w-52 rounded-lg border-2 border-slate-300 bg-white py-2 pl-9 pr-3 text-xl font-bold text-slate-800 outline-none focus:border-[#1E2A38]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void refreshNeighborhoods()}
                  disabled={isLoadingNeighborhoods}
                  className="rounded-lg border-2 border-slate-300 bg-white px-4 py-2 text-lg font-black text-slate-500 shadow-sm hover:border-[#1E2A38] hover:text-[#1E2A38] disabled:cursor-wait disabled:opacity-60"
                >
                  {isLoadingNeighborhoods ? 'Yükleniyor...' : 'Listeyi Yenile'}
                </button>
              </div>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-xl">
                <thead className="sticky top-0 bg-[#1E2A38] text-lg font-black uppercase text-white shadow-sm">
                  <tr>
                    <th className="w-16 px-4 py-3">Sıra</th>
                    <th className="px-4 py-3">
                      <button type="button" onClick={() => toggleNeighborhoodSort('name')} className="inline-flex items-center gap-1.5 hover:text-sky-200">
                        Mahalle Adı {neighborhoodSortIcon('name')}
                      </button>
                    </th>
                    <th className="w-52 px-4 py-3">
                      <button type="button" onClick={() => toggleNeighborhoodSort('paymentDay')} className="inline-flex items-center gap-1.5 hover:text-emerald-200">
                        Ödeme Başlangıç Günü {neighborhoodSortIcon('paymentDay')}
                      </button>
                    </th>
                    <th className="w-48 px-4 py-3">
                      <button type="button" onClick={() => toggleNeighborhoodSort('paymentEndDay')} className="inline-flex items-center gap-1.5 hover:text-amber-200" title="Başlangıca eklenecek gün sayısı - sonuç bir sonraki aya sarkmaz.">
                        Ödeme Bitiş Günü (Kaç Gün) {neighborhoodSortIcon('paymentEndDay')}
                      </button>
                    </th>
                    <th className="w-52 px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredSortedNeighborhoods.length > 0 ? (
                    filteredSortedNeighborhoods.map((neighborhood, index) => {
                      const isSaving = savingNeighborhoodId === neighborhood.id
                      const nameValue = neighborhood.name || ''
                      const paymentDayValue = neighborhood.paymentDay === null ? '' : String(neighborhood.paymentDay)
                      const paymentEndDayValue = neighborhood.paymentEndDay === null ? '' : String(neighborhood.paymentEndDay)

                      return (
                        <tr key={neighborhood.id} className="hover:bg-sky-50/50">
                          <td className="px-4 py-3 text-lg font-black text-slate-400">{index + 1}</td>
                          <td className="px-4 py-3">
                            <input
                              defaultValue={nameValue}
                              disabled={isSaving}
                              data-field="name"
                              className="w-full min-w-[140px] rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xl font-black text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white disabled:opacity-60"
                              onBlur={(event) => {
                                if (event.target.value.trim() && event.target.value !== nameValue) {
                                  void updateNeighborhood(neighborhood, event.target.value, paymentDayValue, paymentEndDayValue)
                                }
                              }}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={1}
                              max={31}
                              defaultValue={paymentDayValue}
                              disabled={isSaving}
                              data-field="paymentDay"
                              className="w-24 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-xl font-black text-emerald-700 outline-none focus:border-emerald-500 focus:bg-white disabled:opacity-60"
                              onBlur={(event) => {
                                if (event.target.value !== paymentDayValue) {
                                  void updateNeighborhoodPaymentDay(neighborhood, event.target.value)
                                }
                              }}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={1}
                              max={31}
                              defaultValue={paymentEndDayValue}
                              disabled={isSaving}
                              data-field="paymentEndDay"
                              title="Başlangıca eklenecek gün sayısı - sonuç bir sonraki aya sarkmaz."
                              className="w-24 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xl font-black text-amber-700 outline-none focus:border-amber-500 focus:bg-white disabled:opacity-60"
                              onBlur={(event) => {
                                if (event.target.value !== paymentEndDayValue) {
                                  void updateNeighborhoodPaymentEndDay(neighborhood, event.target.value)
                                }
                              }}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  const row = event.currentTarget.closest('tr')
                                  const nameInput = row?.querySelector('input[data-field="name"]') as HTMLInputElement | null
                                  const paymentDayInput = row?.querySelector('input[data-field="paymentDay"]') as HTMLInputElement | null
                                  const paymentEndDayInput = row?.querySelector('input[data-field="paymentEndDay"]') as HTMLInputElement | null
                                  void updateNeighborhood(
                                    neighborhood,
                                    nameInput?.value ?? nameValue,
                                    paymentDayInput?.value ?? '',
                                    paymentEndDayInput?.value ?? '',
                                  )
                                }}
                                disabled={isSaving}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-lg font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                              >
                                Güncelle
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteNeighborhood(neighborhood)}
                                disabled={isSaving}
                                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-lg font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                              >
                                Sil
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-xl font-bold text-slate-500">
                        {isLoadingNeighborhoods
                          ? 'Mahalle listesi yükleniyor.'
                          : neighborhoods.length === 0
                            ? 'Mahalle kaydı bulunamadı.'
                            : 'Aramanızla eşleşen mahalle bulunamadı.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sag panel: Yeni Mahalle Ekle + Toplu Guncelleme */}
          <div className="space-y-4 xl:sticky xl:top-4">
            <div className="rounded-xl border-2 border-slate-300 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1E2A38] text-white">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                  </svg>
                </span>
                <h4 className="text-xl font-black text-slate-900">Yeni Mahalle Ekle</h4>
              </div>
              <div className="space-y-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xl font-black uppercase text-slate-500">Mahalle adı</span>
                  <input
                    value={neighborhoodForm.name}
                    onChange={(event) => setNeighborhoodForm(prev => ({ ...prev, name: event.target.value }))}
                    className="rounded-lg border-2 border-slate-300 bg-white px-4 py-2.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38]"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-lg font-black uppercase text-emerald-700">Başlangıç günü</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={neighborhoodForm.paymentDay}
                      onChange={(event) => setNeighborhoodForm(prev => ({ ...prev, paymentDay: event.target.value }))}
                      className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 px-3 py-2.5 text-xl font-black text-emerald-800 outline-none focus:border-emerald-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-lg font-black uppercase text-amber-700" title="Başlangıç tarihine eklenecek gün sayısı. Sonuç bir sonraki aya sarkmaz, ay sonunda sabitlenir.">Bitiş günü (kaç gün)</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={neighborhoodForm.paymentEndDay}
                      onChange={(event) => setNeighborhoodForm(prev => ({ ...prev, paymentEndDay: event.target.value }))}
                      title="Başlangıç tarihine eklenecek gün sayısı. Sonuç bir sonraki aya sarkmaz, ay sonunda sabitlenir."
                      className="rounded-lg border-2 border-amber-200 bg-amber-50/40 px-3 py-2.5 text-xl font-black text-amber-800 outline-none focus:border-amber-500"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void addNeighborhood()}
                  disabled={savingNeighborhoodId === 'new'}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1E2A38] px-5 py-3 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D] disabled:cursor-wait disabled:opacity-60"
                >
                  {savingNeighborhoodId === 'new' ? 'Ekleniyor' : 'Mahalle Ekle'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-5">
              <div className="mb-2">
                <h4 className="text-xl font-black text-amber-900">Toplu Güncelleme</h4>
                <p className="mt-1.5 text-lg font-semibold text-amber-700">Aşağıda girilen gün(ler), <span className="font-black">tüm mahallelere</span> tek seferde uygulanır.</p>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-lg font-black uppercase text-emerald-700">Başlangıç günü</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={bulkPaymentDayForm.paymentDay}
                      onChange={(event) => setBulkPaymentDayForm(prev => ({ ...prev, paymentDay: event.target.value }))}
                      className="rounded-lg border-2 border-emerald-200 bg-white px-3 py-2.5 text-xl font-black text-emerald-800 outline-none focus:border-emerald-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-lg font-black uppercase text-amber-700" title="Başlangıç tarihine eklenecek gün sayısı. Sonuç bir sonraki aya sarkmaz, ay sonunda sabitlenir.">Bitiş günü (kaç gün)</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={bulkPaymentDayForm.paymentEndDay}
                      onChange={(event) => setBulkPaymentDayForm(prev => ({ ...prev, paymentEndDay: event.target.value }))}
                      title="Başlangıç tarihine eklenecek gün sayısı. Sonuç bir sonraki aya sarkmaz, ay sonunda sabitlenir."
                      className="rounded-lg border-2 border-amber-300 bg-white px-3 py-2.5 text-xl font-black text-amber-800 outline-none focus:border-amber-500"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void applyPaymentDayToAllNeighborhoods()}
                  disabled={isApplyingBulkPaymentDay}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-5 py-3 text-xl font-black text-white shadow-sm hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {isApplyingBulkPaymentDay ? 'Uygulanıyor...' : 'Tüm Mahallelere Uygula'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // "Yetkili Personeller" - mevcut kullanicilardan onay yetkisi verilecek
  // kisileri secip listeleyen panel. Sol tarafta TUM kullanicilar aranip
  // "Ekle" ile listeye eklenebiliyor; sag/ana tarafta zaten yetkili olan
  // personel bir tablo halinde, unvan/rol notu duzenlenebilir sekilde
  // gosteriliyor. Bu ekran SADECE listeyi yonetir - hangi islemlerin bu
  // listeden onay isteyecegi ayri bir asamada (ilgili islem gelistirilirken)
  // baglanacaktir.
  const authorizedPersonnelSearchNormalized = authorizedPersonnelSearchTerm.trim().toLocaleLowerCase('tr-TR');
  const authorizedPersonnelCandidateUsers = settingsUsers.filter(user => {
    if (authorizedPersonnel.some(entry => entry.userId === user.id)) return false;
    if (!authorizedPersonnelSearchNormalized) return true;
    const haystack = [user.name, user.username, user.email].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
    return haystack.includes(authorizedPersonnelSearchNormalized);
  });

  const authorizedPersonnelPanel = (
    <div className="overflow-hidden rounded-2xl border border-slate-300 shadow-[0_18px_45px_rgba(15,30,43,0.10)] ring-1 ring-slate-200">
      <div className="flex items-center gap-3 bg-[#1E2A38] px-6 py-5 text-white">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75l2.25 2.25L15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
          </svg>
        </div>
        <div>
          <p className="text-base font-black uppercase tracking-wide text-white/80">Sistem Ayarları</p>
          <h3 className="text-3xl font-black leading-tight">Yetkili Personeller</h3>
        </div>
        <span className="ml-auto rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xl font-black">
          {authorizedPersonnel.length} kişi
        </span>
      </div>

      <div className="space-y-5 bg-white p-6">
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 px-4 py-3 text-xl font-semibold text-slate-700">
          Burada listelenen personel, ilerleyen zamanda bazı işlemler için (ör. istisnai yazdırma, iptal/onay gerektiren işlemler) <span className="font-black text-[#1E2A38]">onay yetkisine</span> sahip olacak şekilde kullanılacaktır. Bu ekrandan sadece yetkili personel listesini yönetebilirsiniz.
        </div>

        {authorizedPersonnelStatus && (
          <div className="rounded-lg border-2 border-sky-200 bg-sky-50 px-4 py-3 text-xl font-bold text-[#005f95]">
            {authorizedPersonnelStatus}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="overflow-hidden rounded-xl border-2 border-slate-300 shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-6 w-1.5 rounded-full bg-[#1E2A38]" />
                <span className="text-xl font-black uppercase text-slate-500">Yetkili Personel Listesi</span>
              </div>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[700px] border-collapse text-left text-xl">
                <thead className="sticky top-0 bg-[#1E2A38] text-lg font-black uppercase text-white shadow-sm">
                  <tr>
                    <th className="w-16 px-4 py-3">Sıra</th>
                    <th className="px-4 py-3">Ad Soyad</th>
                    <th className="px-4 py-3">Kullanıcı Adı</th>
                    <th className="w-56 px-4 py-3">Ünvan / Not</th>
                    <th className="w-36 px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {authorizedPersonnel.length > 0 ? (
                    authorizedPersonnel.map((entry, index) => {
                      const user = settingsUsers.find(u => u.id === entry.userId);
                      return (
                        <tr key={entry.userId} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-lg font-black text-slate-400">{index + 1}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-[#1E2A38]">
                                {(user?.name || user?.username || '?').slice(0, 1).toLocaleUpperCase('tr-TR')}
                              </span>
                              <span className="text-xl font-black text-slate-900">{user?.name || user?.username || 'Bilinmeyen kullanıcı'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-lg font-bold text-slate-500">{user?.username || '-'}</td>
                          <td className="px-4 py-3">
                            <input
                              defaultValue={entry.title || ''}
                              disabled={isSavingAuthorizedPersonnel}
                              placeholder="ör. Şube Müdürü"
                              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xl font-bold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white disabled:opacity-60"
                              onBlur={(event) => {
                                if (event.target.value !== (entry.title || '')) {
                                  void updateAuthorizedPersonnelTitle(entry.userId, event.target.value);
                                }
                              }}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => void removeAuthorizedPersonnel(entry)}
                              disabled={isSavingAuthorizedPersonnel}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-lg font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              Kaldır
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-xl font-bold text-slate-500">
                        Henüz yetkili personel eklenmedi. Sağdaki listeden kullanıcı ekleyebilirsiniz.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sag panel: kullanicilardan yetkili personel ekleme */}
          <div className="space-y-4 xl:sticky xl:top-4">
            <div className="rounded-xl border-2 border-slate-300 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1E2A38] text-white">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                  </svg>
                </span>
                <h4 className="text-xl font-black text-slate-900">Kullanıcılardan Ekle</h4>
              </div>
              <div className="relative mb-3">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <circle cx="9" cy="9" r="6" />
                    <path d="M17 17l-3.5-3.5" strokeLinecap="round" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={authorizedPersonnelSearchTerm}
                  onChange={(event) => setAuthorizedPersonnelSearchTerm(event.target.value)}
                  placeholder="Kullanıcı ara..."
                  className="w-full rounded-lg border-2 border-slate-300 bg-white py-2.5 pl-9 pr-3 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38]"
                />
              </div>
              <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                {authorizedPersonnelCandidateUsers.map(user => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => void addAuthorizedPersonnel(user.id)}
                    disabled={isSavingAuthorizedPersonnel}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-xl font-bold text-slate-700 shadow-sm hover:border-[#1E2A38] hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-slate-500">
                      {(user.name || user.username || '?').slice(0, 1).toLocaleUpperCase('tr-TR')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{user.name || user.username || 'İsimsiz kullanıcı'}</span>
                      <span className="block truncate text-lg font-black text-slate-400">{user.username || `ID: ${user.id}`}</span>
                    </span>
                    <span className="shrink-0 text-2xl leading-none text-[#1E2A38]">+</span>
                  </button>
                ))}
                {authorizedPersonnelCandidateUsers.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-center text-xl font-bold text-slate-400">
                    {authorizedPersonnelSearchTerm ? 'Aramanızla eşleşen kullanıcı bulunamadı.' : 'Eklenebilecek kullanıcı kalmadı.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const whatsappSettingsDirty = whatsappSettingsForm.phoneNumber !== whatsappSettings.phoneNumber
    || (whatsappSettingsForm.note || '') !== (whatsappSettings.note || '');

  const whatsappPanel = (
    <div className="overflow-hidden rounded-2xl border border-slate-300 shadow-[0_18px_45px_rgba(15,30,43,0.10)] ring-1 ring-slate-200">
      <div className="flex items-center gap-3 bg-[#1E2A38] px-6 py-5 text-white">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 text-3xl">
          💬
        </div>
        <div>
          <p className="text-base font-black uppercase tracking-wide text-white/80">Sistem Ayarları</p>
          <h3 className="text-3xl font-black leading-tight">WhatsApp Web</h3>
        </div>
      </div>

      <div className="space-y-5 bg-white p-6">
        <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/60 px-5 py-4 text-xl font-semibold text-emerald-900">
          Bu entegrasyon, yetkili bir kullanıcının burada <span className="font-black">BİR KEZ</span> QR kod okutarak kurumun WhatsApp hesabını sunucuya bağlamasıyla çalışır. Bağlandıktan sonra hiçbir kullanıcının kendi WhatsApp Web&apos;ine girmesine gerek kalmaz - dosya ekranındaki <span className="font-black">&quot;WhatsApp&apos;tan Gönder&quot;</span> butonuna basan HERKESİN mesajı, otomatik olarak bu TEK kurum numarası üzerinden gönderilir. Bağlantı sunucuda saklanır; sunucu yeniden başlasa bile QR&apos;ı tekrar okutmaya gerek yoktur.
        </div>

        <div className="rounded-lg border-2 border-amber-200 bg-amber-50/70 px-5 py-4 text-xl font-semibold text-amber-900">
          Not: whatsapp-web.js, WhatsApp&apos;ın resmi desteklediği bir API değildir (WhatsApp Web arayüzünü otomatikleştiren gayri-resmi bir yöntemdir). Kurulumu ücretsiz ve basittir, ancak çok yoğun otomatik gönderimde numara nadiren geçici kısıtlamaya uğrayabilir.
        </div>

        <div className="rounded-xl border-2 border-slate-300 bg-white p-6 shadow-sm">
          {!whatsappConnection && (
            <p className="text-xl font-bold text-slate-500">Bağlantı durumu yükleniyor...</p>
          )}

          {whatsappConnection?.status === 'ready' && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500" />
                <div>
                  <p className="text-xl font-black text-emerald-800">Bağlı</p>
                  <p className="text-xl font-semibold text-slate-500">
                    {whatsappConnection.connectedNumber ? `+${whatsappConnection.connectedNumber}` : 'Numara bilgisi alınamadı'}
                    {whatsappConnection.connectedName ? ` — ${whatsappConnection.connectedName}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void disconnectWhatsapp()}
                disabled={isWhatsappLoggingOut}
                className="inline-flex items-center gap-2 self-start rounded-lg border-2 border-rose-200 bg-rose-50 px-5 py-3 text-xl font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isWhatsappLoggingOut ? 'Kesiliyor...' : 'Bağlantıyı Kes'}
              </button>
            </div>
          )}

          {whatsappConnection?.status === 'ready' && (
            <div className="mt-4 border-t-2 border-slate-100 pt-4">
              <label className="flex flex-col gap-2">
                <span className="text-xl font-black uppercase tracking-wide text-slate-500">Kurum Görünen Adı</span>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={whatsappDisplayNameForm}
                    onChange={(event) => setWhatsappDisplayNameForm(event.target.value)}
                    placeholder="Örn: Sivas Belediyesi Sosyal Yardım"
                    className="flex-1 rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-xl font-bold text-slate-950 outline-none focus:border-[#1E2A38]"
                  />
                  <button
                    type="button"
                    onClick={() => void saveWhatsappDisplayName()}
                    disabled={isSavingWhatsappDisplayName || !whatsappDisplayNameForm.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1E2A38] px-6 py-3 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingWhatsappDisplayName ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                </div>
                <span className="text-xl font-semibold text-slate-400">
                  Numarayı rehberine kaydetmemiş alıcılar, mesajı çıplak telefon numarası yerine bu isimle görür. (Rehberine kaydetmiş olanlar için her zaman kendi verdikleri isim görünür - bu WhatsApp&apos;ın kendi kuralıdır, değiştirilemez.)
                </span>
              </label>
              {whatsappDisplayNameStatus && (
                <p className={`mt-2 text-xl font-bold ${whatsappDisplayNameStatus.includes('güncellendi') ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {whatsappDisplayNameStatus}
                </p>
              )}
            </div>
          )}

          {whatsappConnection?.status === 'qr' && whatsappConnection.qrDataUrl && (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-xl font-black text-slate-700">Kurumun WhatsApp hesabıyla bu kodu okutun</p>
              <img src={whatsappConnection.qrDataUrl} alt="WhatsApp QR Kod" className="h-56 w-56 rounded-lg border-2 border-slate-200 p-2" />
              <p className="max-w-md text-xl font-semibold text-slate-500">
                Telefonda WhatsApp &gt; Ayarlar &gt; Bağlı Cihazlar &gt; Cihaz Bağla yolunu izleyip bu QR kodu okutun. Kod süresi dolarsa birkaç saniye içinde otomatik yenilenir.
              </p>
              <button
                type="button"
                onClick={() => void connectWhatsapp(true)}
                disabled={isWhatsappConnecting}
                className="inline-flex items-center gap-2 rounded-lg border-2 border-emerald-200 bg-emerald-50 px-5 py-3 text-xl font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
                {isWhatsappConnecting ? 'Yenileniyor...' : 'QR Kodu Yenile'}
              </button>
            </div>
          )}

          {(whatsappConnection?.status === 'initializing' || whatsappConnection?.status === 'authenticated') && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                <p className="text-xl font-black text-amber-700">
                  {whatsappConnection.status === 'authenticated' ? 'Kimlik doğrulandı, bağlanılıyor...' : 'Başlatılıyor...'}
                </p>
              </div>
              <p className="text-xl font-semibold text-slate-400">
                Bu ekran normalde birkaç saniye sürer. Uzun süre (1-2 dakikadan fazla) takılı kalırsa, aşağıdaki butonla tekrar QR okutmadan yeniden deneyebilirsiniz - sistem de kendiliğinden yeniden dener.
              </p>
              <button
                type="button"
                onClick={() => void connectWhatsapp(true)}
                disabled={isWhatsappConnecting}
                className="inline-flex items-center gap-2 self-start rounded-lg border-2 border-amber-200 bg-amber-50 px-5 py-3 text-xl font-black text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isWhatsappConnecting ? 'Yeniden Deneniyor...' : 'Yeniden Dene'}
              </button>
            </div>
          )}

          {(whatsappConnection?.status === 'disconnected' || whatsappConnection?.status === 'auth_failure') && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-3.5 w-3.5 shrink-0 rounded-full bg-slate-300" />
                <p className="text-xl font-black text-slate-600">Bağlı Değil</p>
              </div>
              {whatsappConnection.lastError && (
                <p className="text-xl font-semibold text-rose-600">{whatsappConnection.lastError}</p>
              )}
              {whatsappConnection.reconnectCooldownUntil && whatsappConnection.reconnectCooldownUntil > Date.now() && (
                <p className="max-w-md rounded-lg border-2 border-amber-200 bg-amber-50 px-4 py-3 text-xl font-semibold text-amber-800">
                  QR art arda birkaç kez tamamlanamadan koptu - bu genelde WhatsApp&apos;ın geçici hız sınırlamasına işaret eder. Sistemin arka planda kendiliğinden tekrar denemesi yaklaşık {Math.ceil((whatsappConnection.reconnectCooldownUntil - Date.now()) / 60000)} dakika durduruldu (numarayı daha fazla yormamak için). Telefonunuzda WhatsApp &gt; Bağlı Cihazlar listesinde eski/askıda bir kayıt varsa kaldırıp birkaç dakika bekledikten sonra aşağıdaki butonla elle tekrar deneyebilirsiniz.
                </p>
              )}
              <button
                type="button"
                onClick={() => void connectWhatsapp(true)}
                disabled={isWhatsappConnecting}
                className="inline-flex items-center gap-2 self-start rounded-lg bg-[#1E2A38] px-6 py-3 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isWhatsappConnecting ? 'Başlatılıyor...' : 'Bağlan'}
              </button>
            </div>
          )}
        </div>

        {whatsappStatus && (
          <div className={`rounded-lg border-2 px-5 py-4 text-xl font-bold ${whatsappStatus.includes('kaydedildi') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {whatsappStatus}
          </div>
        )}

        <div className="grid gap-4 rounded-xl border-2 border-slate-300 bg-white p-5 shadow-sm">
          <label className="flex flex-col gap-2">
            <span className="text-xl font-black uppercase tracking-wide text-slate-500">Not (Opsiyonel)</span>
            <input
              value={whatsappSettingsForm.note || ''}
              onChange={(event) => setWhatsappSettingsForm(prev => ({ ...prev, note: event.target.value }))}
              placeholder="Örn: Bu hat Sosyal Hizmetler bilgi hattıdır"
              className="rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-xl font-bold text-slate-950 outline-none focus:border-[#1E2A38]"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void persistWhatsappSettings()}
            disabled={isSavingWhatsapp || !whatsappSettingsDirty}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1E2A38] px-6 py-3 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSavingWhatsapp ? 'Kaydediliyor...' : 'Notu Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );

  // Kullanici istegi: "Yardım Kriterleri" listesindeki her satira, hangi
  // DÖNEME ozel oldugunu secebilecegimiz bir alan eklenir - secenekler,
  // zaten var olan "Dönem Bilgisi" hazir deger listesinden gelir.
  const yardimKriterleriDonemCategoryKey = findPredefinedCategoryByCandidates(predefinedValues, predefinedValueTitles, ['donem bilgisi', 'donem']);
  const yardimKriterleriDonemOptions = yardimKriterleriDonemCategoryKey ? predefinedValues[yardimKriterleriDonemCategoryKey] ?? [] : [];

  return (
    <div className="space-y-5 text-slate-950">
      {/* Kullanici istegi (2026-09-30): Ayarlar sayfasi diger sayfalarda
          (Dosya Yönetimi, Yardımlar) kullanilan "kurumsal" koyu lacivert
          temaya kavusturuldu - eskiden parlak mavi-yesil degrade bir
          baslikti. SADECE GORUNUM - "işleyişe dokunmayalım" istegi geregi
          hicbir prop/onClick/mantik DEGISMEDI. */}
      <div className="rounded-xl border border-[#2A3B4D] bg-[#1E2A38] p-5 text-white shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.08)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wide text-white/80">{activeHeader.eyebrow}</p>
            <h1 className="mt-1 text-2xl font-semibold uppercase leading-tight tracking-wide md:text-[28px]">{activeHeader.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'userPermissions' && (
              <a
                href="/users"
                className="inline-flex items-center justify-center rounded-lg border border-white/30 bg-white/10 px-5 py-2.5 text-xl font-bold text-white shadow-sm hover:bg-white/20 transition-colors"
              >
                Kullanıcılar sayfasına dön
              </a>
            )}
            <button
              onClick={saveActiveSettings}
              disabled={isSavingPredefinedValues || isSavingFormDesigns || isSavingOnlineForms || isSavingUserPermissions || isSavingGeneralSettings || isSavingSmsSettings || isSavingDatabaseBackupSettings}
              className="rounded-lg bg-white px-6 py-2 text-sm font-bold text-[#1E2A38] shadow-sm hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              {isSavingPredefinedValues || isSavingFormDesigns || isSavingOnlineForms || isSavingUserPermissions || isSavingGeneralSettings || isSavingSmsSettings || isSavingDatabaseBackupSettings ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-5">
        {activeTab !== 'userPermissions' && activeTab !== 'online' && (
        <aside className="w-full md:w-[26rem] shrink-0 space-y-0">
          {[
            { id: 'nvi', label: 'NVİ Entegrasyonu', icon: '🆔' },
            { id: 'sms', label: 'SMS Entegrasyonu', icon: 'SMS' },
            { id: 'whatsapp', label: 'WhatsApp Web', icon: '💬' },
            { id: 'sosyalAsistan', label: 'Sosyal Asistan API', icon: '🤖' },
            { id: 'formDesign', label: 'Form ve Etiket Dizaynı', icon: '🎨' },
            { id: 'evaluationForm', label: 'Tahkikat Formu Tasarımı', icon: '🧮' },
            { id: 'updateForm', label: 'Güncelleme Formu Tasarımı', icon: '🗂️' },
            { id: 'preliminaryReviewForm', label: 'Ön İnceleme Formu Tasarımı', icon: '🔎' },
            { id: 'predefinedValues', label: 'Hazır Değerler', icon: '📝' },
            { id: 'yardimKriterleri', label: 'Yardım Kriterleri', icon: '🎯' },
            { id: 'scheduledTasks', label: 'Zamanlanmış Görevler', icon: '⏰' },
            { id: 'databaseBackups', label: 'Veritabanı İşlemleri', icon: 'DB' },
            { id: 'personnelPerformance', label: 'Personel Performans', icon: 'PP' },
            { id: 'general', label: 'Genel Ayarlar', icon: '⚙️' },
            { id: 'neighborhoods', label: 'Mahalle Listesi', icon: 'ML' },
            { id: 'authorizedPersonnel', label: 'Yetkili Personeller', icon: 'YP' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex w-full items-center gap-3 rounded-lg px-5 py-2.5 text-2xl font-bold leading-snug transition-all ${
                activeTab === tab.id
                ? 'bg-[#1E2A38] text-white shadow-md'
                : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300'
              }`}
            >
              <span className="text-2xl">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </aside>
        )}

        <main className="flex-1 bg-white rounded-lg border border-slate-200 shadow-sm p-6 min-h-[600px]">
          {activeTab === 'nvi' && (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-slate-50 px-6 py-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-black uppercase tracking-wide text-[#1E2A38]">KAPS / NVİ Sorgu Ekranı</p>
                  <p className="mt-2 text-lg font-bold text-slate-700">
                    {typeof window !== 'undefined' ? `${window.location.origin}${kapsUrl}` : kapsUrl}
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-500">Sunucu içi adres: {kapsDirectUrl}</p>
                </div>
                <a
                  href={kapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-[#1E2A38] bg-white px-6 py-3.5 text-lg font-black text-[#1E2A38] shadow-sm hover:bg-slate-100"
                >
                  Yeni Pencerede Aç
                </a>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#f4f7f8] shadow-sm">
                <iframe
                  src={kapsUrl}
                  title="KAPS / NVI Sorgu Ekrani"
                  className="h-[calc(100vh-250px)] min-h-[520px] w-full border-0 bg-[#f4f7f8]"
                />
              </div>
            </div>
          )}

          {false && activeTab === 'nvi' && (
            <div className="space-y-6">
              <h2 className="text-xl font-extrabold text-[#0076b6] border-b pb-2">NVİ / KPS Servis Ayarları</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-black uppercase text-slate-500">Kullanıcı Adı</span>
                  <input 
                    type="text" 
                    value={nviCreds.user} 
                    onChange={e => setNviCreds({...nviCreds, user: e.target.value})}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0076b6]"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-black uppercase text-slate-500">Şifre</span>
                  <input 
                    type="password" 
                    value={nviCreds.pass} 
                    onChange={e => setNviCreds({...nviCreds, pass: e.target.value})}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0076b6]"
                  />
                </label>
              </div>

              <div className="space-y-4">
                {services.map(service => (
                  <div key={service.id} className="flex items-start justify-between p-4 border rounded-lg hover:border-[#0076b6]/30 transition-colors">
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-800">{service.name}</h3>
                      <p className="text-xs text-slate-500">{service.description}</p>
                      <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">{service.url}</code>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input 
                        type="checkbox" 
                        checked={service.enabled} 
                        onChange={e => handleServiceChange(service.id, 'enabled', e.target.checked)}
                        className="peer sr-only" 
                      />
                      <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#6fb744] peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
                    </label>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t flex justify-end">
                <button 
                  onClick={saveNviSettings}
                  disabled={isSavingNvi}
                  className="rounded-md bg-[#0076b6] px-6 py-2 text-sm font-bold text-white hover:bg-[#005c8f] transition-colors disabled:opacity-50"
                >
                  {isSavingNvi ? 'Kaydediliyor...' : 'NVİ Ayarlarını Kaydet'}
                </button>
              </div>
              {nviStatus && <p className="text-xs font-bold text-center text-[#0076b6]">{nviStatus}</p>}
            </div>
          )}

          {activeTab === 'sms' && (
            <div className="space-y-6">
              <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_18px_45px_rgba(15,30,43,0.10)]">
                <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">Mesajlaşma Servisleri</p>
                    <h2 className="mt-1 text-4xl font-black text-slate-900">SMS Entegrasyonu</h2>
                    <p className="mt-1.5 max-w-3xl text-xl font-semibold text-slate-600">
                      Mutlucell, İleti Bilgi Teknolojileri ve NetGSM için API erişim bilgilerini buradan tanımlayabilirsiniz. Bu bölüm ayrı ayar kaydı olarak saklanır.
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-white p-4">
                    <p className="text-xl font-black uppercase tracking-wide text-slate-600">Aktif Sağlayıcı</p>
                    <select
                      value={smsSettings.activeProvider}
                      onChange={event => setSmsSettings(prev => ({ ...prev, activeProvider: event.target.value as SmsProviderId }))}
                      className="mt-1.5 min-w-56 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-xl font-black text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                    >
                      <option value="mutlucell">Mutlucell</option>
                      <option value="ileti">İleti Bilgi Teknolojileri</option>
                      <option value="netgsm">NetGSM</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-5 p-6 xl:grid-cols-3">
                  {smsProviderMeta.map(provider => {
                    const providerSettings = smsSettings.providers[provider.id];
                    const isActiveProvider = smsSettings.activeProvider === provider.id;

                    return (
                      <div
                        key={provider.id}
                        className={`overflow-hidden rounded-xl border bg-white shadow-sm ${isActiveProvider ? 'border-[#1E2A38] ring-2 ring-slate-200' : 'border-slate-300'}`}
                      >
                        <div className={`border-b px-5 py-5 ${isActiveProvider ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-slate-50'}`}>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">SMS Sağlayıcısı</p>
                              <h3 className="mt-1 text-3xl font-black text-slate-900">{provider.name}</h3>
                              <p className="mt-1.5 text-xl font-semibold leading-relaxed text-slate-600">{provider.description}</p>
                            </div>
                            <label className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5">
                              <input
                                type="checkbox"
                                checked={providerSettings.enabled}
                                onChange={event => updateSmsProviderSetting(provider.id, 'enabled', event.target.checked)}
                                className="h-5 w-5"
                              />
                              <span className="text-xl font-black uppercase text-slate-700">Aktif</span>
                            </label>
                          </div>
                        </div>

                        <div className="space-y-5 p-5">
                          <div className="grid gap-4">
                            <label className="flex flex-col gap-2">
                              <span className="text-xl font-black uppercase text-slate-600">Gönderici Başlığı</span>
                              <input
                                value={providerSettings.senderTitle}
                                onChange={event => updateSmsProviderSetting(provider.id, 'senderTitle', event.target.value)}
                                placeholder="Örn. SIVASBLD"
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-xl font-black uppercase text-slate-600">Müşteri / Bayi Kodu</span>
                              <input
                                value={providerSettings.customerCode}
                                onChange={event => updateSmsProviderSetting(provider.id, 'customerCode', event.target.value)}
                                placeholder="Firma tarafından verilen kod"
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                            <label className="flex flex-col gap-2 md:col-span-2">
                              <span className="text-xl font-black uppercase text-slate-600">API Adresi</span>
                              <input
                                value={providerSettings.apiUrl}
                                onChange={event => updateSmsProviderSetting(provider.id, 'apiUrl', event.target.value)}
                                placeholder="https://..."
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-xl font-black uppercase text-slate-600">Kullanıcı Adı</span>
                              <input
                                value={providerSettings.username}
                                onChange={event => updateSmsProviderSetting(provider.id, 'username', event.target.value)}
                                autoComplete="off"
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-xl font-black uppercase text-slate-600">Şifre</span>
                              <input
                                type="password"
                                value={providerSettings.password}
                                onChange={event => updateSmsProviderSetting(provider.id, 'password', event.target.value)}
                                autoComplete="new-password"
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-xl font-black uppercase text-slate-600">API Key</span>
                              <input
                                type="password"
                                value={providerSettings.apiKey}
                                onChange={event => updateSmsProviderSetting(provider.id, 'apiKey', event.target.value)}
                                autoComplete="off"
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-xl font-black uppercase text-slate-600">API Secret / Token</span>
                              <input
                                type="password"
                                value={providerSettings.apiSecret}
                                onChange={event => updateSmsProviderSetting(provider.id, 'apiSecret', event.target.value)}
                                autoComplete="new-password"
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-xl font-black uppercase text-slate-600">Test Telefonu</span>
                              <input
                                value={providerSettings.testPhone}
                                onChange={event => updateSmsProviderSetting(provider.id, 'testPhone', event.target.value)}
                                placeholder="05xx xxx xx xx"
                                inputMode="tel"
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                            <label className="flex flex-col gap-2 md:col-span-2">
                              <span className="text-xl font-black uppercase text-slate-600">Not / Ek Parametreler</span>
                              <textarea
                                value={providerSettings.notes}
                                onChange={event => updateSmsProviderSetting(provider.id, 'notes', event.target.value)}
                                rows={3}
                                placeholder="Firma tarafından verilen özel parametre, başlık veya gönderim tipi notları..."
                                className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                              />
                            </label>
                          </div>

                          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xl font-bold text-slate-600 sm:grid-cols-3">
                            <div>
                              <span className="block text-xl font-black uppercase text-slate-500">Durum</span>
                              <span className={providerSettings.enabled ? 'text-emerald-700' : 'text-slate-500'}>
                                {providerSettings.enabled ? 'Aktif' : 'Pasif'}
                              </span>
                            </div>
                            <div>
                              <span className="block text-xl font-black uppercase text-slate-500">Seçim</span>
                              <span className={isActiveProvider ? 'text-[#1E2A38]' : 'text-slate-500'}>
                                {isActiveProvider ? 'Varsayılan' : 'Yedek'}
                              </span>
                            </div>
                            <div>
                              <span className="block text-xl font-black uppercase text-slate-500">Kimlik</span>
                              <span>{providerSettings.username || providerSettings.apiKey ? 'Girildi' : 'Eksik'}</span>
                            </div>
                          </div>

                          {isActiveProvider && (
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => void testSmsProvider(provider.id)}
                                disabled={smsProviderTestStatus[provider.id]?.status === 'sending'}
                                className="inline-flex items-center justify-center gap-2 self-start rounded-lg border-2 border-[#1E2A38] bg-white px-6 py-3.5 text-xl font-black uppercase text-[#1E2A38] hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                              >
                                {smsProviderTestStatus[provider.id]?.status === 'sending' ? 'Gönderiliyor...' : '📨 Test SMS Gönder'}
                              </button>
                              {smsProviderTestStatus[provider.id] && smsProviderTestStatus[provider.id]?.status !== 'sending' && (
                                <p className={`text-xl font-bold ${smsProviderTestStatus[provider.id]?.status === 'success' ? 'text-emerald-700' : 'text-rose-600'}`}>
                                  {smsProviderTestStatus[provider.id]?.status === 'success' ? '✓ ' : '✗ '}
                                  {smsProviderTestStatus[provider.id]?.message}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-slate-200 p-6">
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">Hazır Mesajlar</p>
                      <h3 className="mt-1 text-3xl font-black text-slate-900">SMS Şablonları</h3>
                      <p className="mt-1.5 text-xl font-semibold text-slate-600">
                        Dosya Ara ekranındaki SMS gönder penceresinde kullanılacak hazır kalıpları buradan yönetin.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addSmsTemplate}
                      className="rounded-lg bg-[#1E2A38] px-6 py-3.5 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D]"
                    >
                      Yeni Şablon Ekle
                    </button>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {smsSettings.templates.map((template) => (
                      <div key={template.id} className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <label className="flex min-w-0 flex-1 flex-col gap-2">
                            <span className="text-xl font-black uppercase text-slate-600">Şablon Adı</span>
                            <input
                              value={template.title}
                              onChange={event => updateSmsTemplate(template.id, { title: event.target.value })}
                              className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-xl font-black text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
                            />
                          </label>
                          <label className="mt-6 flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3">
                            <input
                              type="checkbox"
                              checked={template.active}
                              onChange={event => updateSmsTemplate(template.id, { active: event.target.checked })}
                              className="h-5 w-5"
                            />
                            <span className="text-xl font-black uppercase text-slate-700">Aktif</span>
                          </label>
                        </div>
                        <label className="flex flex-col gap-2">
                          <span className="text-xl font-black uppercase text-slate-600">Mesaj Metni</span>
                          <textarea
                            value={template.text}
                            onChange={event => updateSmsTemplate(template.id, { text: event.target.value })}
                            rows={4}
                            className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-lg font-semibold leading-relaxed text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                          />
                        </label>
                        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xl font-bold text-slate-500">
                            Kullanılabilir alanlar: {'{adSoyad}'}, {'{dosyaNo}'}, {'{tc}'}, {'{kurum}'}
                          </p>
                          <button
                            type="button"
                            onClick={() => removeSmsTemplate(template.id)}
                            disabled={smsSettings.templates.length <= 1}
                            className="rounded-lg border border-rose-300 bg-rose-50 px-5 py-2.5 text-xl font-black text-rose-600 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Sil
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-slate-50 px-6 py-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <p className="text-xl font-semibold leading-relaxed text-slate-600">
                      Bilgiler kaydedildikten sonra SMS gönderim modülleri bu ayar kaydını kullanacak şekilde bağlanabilir. Bu ekranda gerçek SMS gönderimi yapılmaz.
                    </p>
                    {smsSettingsStatus && (
                      <div className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xl font-bold text-[#1E2A38]">
                        {smsSettingsStatus}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'formDesign' && (
            <div className="space-y-6 flex flex-col items-center justify-center py-32">
              <div className="text-center space-y-4 max-w-lg">
                <div className="text-6xl mb-6">📐</div>
                <h2 className="text-2xl font-extrabold text-slate-800">Form ve Etiket Dizayn Aracı</h2>
                <p className="text-slate-500 font-medium">
                  Tasarımlarınızı yapabilmeniz için geniş bir çalışma alanına ihtiyacınız vardır. Tasarım aracını yeni bir sekmede açarak rahatça çalışabilirsiniz.
                </p>
                <div className="pt-6">
                  <button
                    onClick={() => addTab({ title: 'Form Tasarımcısı', path: '/settings/form-designer' })}
                    className="rounded-xl bg-gradient-to-r from-[#0076b6] to-[#6fb744] px-8 py-4 text-sm font-black text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all w-full flex items-center justify-center gap-3"
                  >
                    <span className="text-xl">⛶</span> TASARIM EDİTÖRÜNÜ YENİ SEKMEDE AÇ
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'evaluationForm' && (
            <div className="space-y-6 flex flex-col items-center justify-center py-32">
              <div className="text-center space-y-4 max-w-lg">
                <div className="text-6xl mb-6">🧮</div>
                <h2 className="text-2xl font-extrabold text-slate-800">Tahkikat Formu Tasarımı</h2>
                <p className="text-slate-500 font-medium">
                  Dosya tahkikat formundaki soruları, her soru için verilebilecek cevapları ve bu cevaplara
                  karşılık gelen puanları burada tanımlayabilirsiniz. Geniş bir çalışma alanına ihtiyaç
                  duyduğu için tasarım aracını yeni bir sekmede açabilirsiniz.
                </p>
                <div className="pt-6">
                  <button
                    onClick={() => addTab({ title: 'Tahkikat Formu Tasarımı', path: '/settings/evaluation-form-designer' })}
                    className="rounded-xl bg-gradient-to-r from-teal-700 to-emerald-600 px-8 py-4 text-sm font-black text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all w-full flex items-center justify-center gap-3"
                  >
                    <span className="text-xl">⛶</span> TAHKİKAT FORMU TASARIM ARACINI YENİ SEKMEDE AÇ
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'updateForm' && (
            <div className="space-y-6 flex flex-col items-center justify-center py-32">
              <div className="text-center space-y-4 max-w-lg">
                <div className="text-6xl mb-6">🗂️</div>
                <h2 className="text-2xl font-extrabold text-slate-800">Güncelleme Formu Tasarımı</h2>
                <p className="text-slate-500 font-medium">
                  Dosya &ldquo;Ön İnceleme Yapılmış&rdquo; durumuna alınırken sorulacak soruları ve cevaplarını
                  burada tanımlayabilirsiniz. Form kaydedildiğinde dosyanın durumu otomatik olarak
                  &ldquo;Ön İnceleme Yapılmış&rdquo; olarak güncellenir. Geniş bir çalışma alanına ihtiyaç
                  duyduğu için tasarım aracını yeni bir sekmede açabilirsiniz.
                </p>
                <div className="pt-6">
                  <button
                    onClick={() => addTab({ title: 'Güncelleme Formu Tasarımı', path: '/settings/update-form-designer' })}
                    className="rounded-xl bg-gradient-to-r from-indigo-700 to-violet-600 px-8 py-4 text-sm font-black text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all w-full flex items-center justify-center gap-3"
                  >
                    <span className="text-xl">⛶</span> GÜNCELLEME FORMU TASARIM ARACINI YENİ SEKMEDE AÇ
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preliminaryReviewForm' && (
            <div className="space-y-6 flex flex-col items-center justify-center py-32">
              <div className="text-center space-y-4 max-w-lg">
                <div className="text-6xl mb-6">🔎</div>
                <h2 className="text-2xl font-extrabold text-slate-800">Ön İnceleme Formu Tasarımı</h2>
                <p className="text-slate-500 font-medium">
                  Sorulacak bilgileri (örneğin &ldquo;Araç Bilgisi&rdquo;, &ldquo;Aylık Gelir&rdquo;) ve her biri için
                  örnek bir cevap ipucu (örneğin &ldquo;1 adet araç var&rdquo;, &ldquo;25000 TL&rdquo;) tanımlayın.
                  Bu formun cevapları önceden tanımlı seçeneklerden değil, serbest metin olarak yazılır.
                </p>
                <div className="pt-6">
                  <button
                    onClick={() => addTab({ title: 'Ön İnceleme Formu Tasarımı', path: '/settings/preliminary-review-form-designer' })}
                    className="rounded-xl bg-gradient-to-r from-amber-700 to-orange-600 px-8 py-4 text-sm font-black text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all w-full flex items-center justify-center gap-3"
                  >
                    <span className="text-xl">⛶</span> ÖN İNCELEME FORMU TASARIM ARACINI YENİ SEKMEDE AÇ
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'predefinedValues' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <h2 className="text-2xl font-extrabold text-[#1E2A38]">Hazır Değerler Yönetimi</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Yeni Liste Başlığı..."
                    value={newCategoryTitle}
                    onChange={e => setNewCategoryTitle(e.target.value)}
                    className="rounded-md border border-slate-300 px-4 py-2 text-xl outline-none focus:border-[#1E2A38]"
                  />
                  <button
                    onClick={addNewPredefinedValueList}
                    className="rounded-md bg-[#6fb744] px-4 py-2 text-xl font-bold text-white hover:bg-[#5aa333] transition-colors"
                  >
                    + Ekle
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Kullanici istegi: "Yardım Kriterleri" artik AYRI bir
                    "Yardım Kriterleri" sekmesinde (dönem bazinda panellerle)
                    yonetiliyor - bu genel Hazır Değerler kartlarinda
                    TEKRAR gosterilmez (bkz. activeTab === 'yardimKriterleri'). */}
                {Object.keys(predefinedValueTitles).filter(category => category !== 'yardimKriterleri').map(category => (
                  <div key={category} className="rounded-lg border border-slate-300 p-5 space-y-3 bg-slate-50/50">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2">
                      <input
                        type="text"
                        value={predefinedValueTitles[category]}
                        onChange={e => handlePredefinedTitleChange(category, e.target.value)}
                        className="bg-transparent text-xl font-black text-slate-800 outline-none focus:text-[#1E2A38] transition-colors"
                      />
                      <button
                        onClick={() => removePredefinedValueList(category)}
                        className="text-xl text-slate-400 hover:text-rose-500 transition-colors"
                      >
                        🗑️
                      </button>
                    </div>

                    <div className="space-y-2">
                      {predefinedValues[category]?.map((val, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            type="text"
                            placeholder="ID"
                            value={val.id}
                            onChange={e => handlePredefinedValueChange(category, idx, 'id', e.target.value)}
                            className="w-20 rounded-md border border-slate-300 px-3 py-2 text-xl outline-none focus:border-[#1E2A38]"
                          />
                          <input
                            type="text"
                            placeholder="Değer"
                            value={val.name}
                            onChange={e => handlePredefinedValueChange(category, idx, 'name', e.target.value)}
                            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xl outline-none focus:border-[#1E2A38]"
                          />
                          <button
                            onClick={() => removePredefinedValue(category, idx)}
                            className="text-xl text-slate-300 hover:text-rose-500"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => addPredefinedValue(category)}
                      className="w-full rounded-md border border-dashed border-slate-300 py-2 text-xl font-bold text-slate-500 hover:bg-white hover:border-[#1E2A38] hover:text-[#1E2A38] transition-all mt-2"
                    >
                      + Yeni Satır
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'yardimKriterleri' && (
            <YardimKriterleriTab
              predefinedValues={predefinedValues}
              setPredefinedValues={setPredefinedValues}
              donemOptions={yardimKriterleriDonemOptions}
            />
          )}

          {activeTab === 'online' && (
            <div className="space-y-6">
              {/* Kullanici istegi (2026-09-22, 3. tur): "Başvuru Sorgulamayı
                  aç kapa butonunu Online Başvurular sayfasına değilde sol
                  sidebardaki Ayarlar içinde olan Online Başvuru Formları
                  sayfasına alalım" - bu bilesen daha once app/online/page.tsx
                  (Online Başvurular yonetim listesi) uzerindeydi, artik
                  burada. */}
              <ApplicationStatusLookupToggle />

              <div className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-[0_18px_45px_rgba(2,132,199,0.10)]">
                <div className="flex flex-col gap-4 border-b border-sky-100 bg-sky-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-[#0076b6]">Vatandaş Başvuru Portalı</p>
                    <h2 className="mt-1 text-2xl font-black text-slate-900">Online Başvuru Formları</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">Formu düzenleyin, canlı görünümünü kontrol edin ve bağlantısını paylaşın.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setIsPreviewOpen(true)}
                      disabled={!selectedOnlineForm}
                      className="rounded-lg border border-[#0076b6] bg-white px-4 py-2 text-xs font-black text-[#0076b6] shadow-sm hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Ekran Önizlemesi
                    </button>
                    <a
                      href={selectedOnlineFormUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={`rounded-lg bg-[#0076b6] px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-[#005c8f] ${!selectedOnlineForm ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      İnternet Sayfasını Aç
                    </a>
                    <button
                      onClick={addNewOnlineForm}
                      className="rounded-lg bg-[#6fb744] px-4 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-[#5aa333]"
                    >
                      + Yeni Form Oluştur
                    </button>
                  </div>
                </div>

                <div className="grid gap-6 p-5 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
                  <div className="space-y-3">
                    <p className="text-xs font-black uppercase text-slate-500">Mevcut Formlar</p>
                    <div className="space-y-2">
                      {onlineForms.map(form => (
                        <button
                          type="button"
                          key={form.id}
                          onClick={() => setSelectedOnlineFormId(form.id)}
                          className={`w-full rounded-xl border p-3 text-left transition-all ${selectedOnlineFormId === form.id ? 'border-[#0076b6] bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-black leading-tight text-slate-800">{form.title}</span>
                            {/* Kullanici istegi (2026-09-22): zamanlanmis
                                yayin eklendigi icin bu nokta/etiket artik
                                ham "active" DEGIL, isFormCurrentlyPublished
                                (zamanlama dahil) GERCEK durumu gosterir. */}
                            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${isFormCurrentlyPublished(form) ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          </div>
                          <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-400">
                            <span>{form.fields.length} alan</span>
                            <span>{isFormCurrentlyPublished(form) ? 'Yayında' : (form.active ? 'Zamanlanmış' : 'Pasif')}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-5">
                    {selectedOnlineForm ? (
                      <>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <label className="flex flex-1 flex-col gap-1.5">
                              <span className="text-xs font-black uppercase text-slate-500">Form Başlığı</span>
                              {/* Kullanici istegi (2026-09-22): "form başlığının
                                  Ayarlar > Sistem Ayarları > Hazır Değerler
                                  içindeki dönem bilgisindeki dönemler listelensin
                                  ve buradan hangisi seçilir ise o şekilde
                                  başvuru almaya devam edelim" - eskiden serbest
                                  metin girisiydi, artik "Dönem Bilgisi" hazir
                                  deger listesinden secim yapiliyor (ayni liste
                                  Yardım Kriterleri sekmesinde de kullanilan
                                  yardimKriterleriDonemOptions). Formun MEVCUT
                                  basligi listede birebir yoksa (ör. daha once
                                  serbest yazilmis eski bir baslik) sessizce
                                  KAYBOLMASIN diye secenek listesine EKLENIR. */}
                              <select
                                value={selectedOnlineForm.title}
                                onChange={e => updateOnlineForm(selectedOnlineForm.id, 'title', e.target.value)}
                                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-base font-black text-slate-900 outline-none focus:border-[#0076b6] focus:bg-white"
                              >
                                {!yardimKriterleriDonemOptions.some(option => option.name === selectedOnlineForm.title) && (
                                  <option value={selectedOnlineForm.title}>{selectedOnlineForm.title}</option>
                                )}
                                {yardimKriterleriDonemOptions.map(option => (
                                  <option key={option.id} value={option.name}>{option.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedOnlineForm.active}
                                onChange={e => updateOnlineForm(selectedOnlineForm.id, 'active', e.target.checked)}
                                className="h-4 w-4"
                              />
                              <span className="text-xs font-black uppercase text-slate-600">Form Yayında</span>
                            </label>
                          </div>
                        </div>

                        {/* Kullanici istegi (2026-09-22): "yayına çıkacağı
                            tarihi ve saati ve yayından kalkacağı tarih ve
                            saati belirleyelim, o tarih ve saat geldiğinde
                            yayına girsin ve zamanı dolunca yayından çıksın,
                            bunu her yardım türü için yapabilelim" -> devam:
                            "zamanı ve tarihi ayarladım yayına girmedi" - bu
                            alanlardan BIRINE deger girildiginde "Form
                            Yayında" artik OTOMATIK aciliyor (bkz.
                            updateOnlineFormSchedule) - kullanicinin AYRICA
                            checkbox'i hatirlayip isaretlemesi gerekmiyor. */}
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
                          <div className="mb-3">
                            <p className="text-xs font-black uppercase text-indigo-700">Yayın Zamanlaması (opsiyonel)</p>
                            <p className="mt-1 text-xs font-semibold text-indigo-900/70">Bir tarih/saat girdiğinizde "Form Yayında" otomatik açılır; belirtilen saatte yayına girer, bitiş saatinde otomatik yayından kalkar. Boş bırakılan alan sınır oluşturmaz.</p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1.5">
                              <span className="text-xs font-black uppercase text-slate-500">Yayın Başlangıcı</span>
                              <div className="flex gap-2">
                                <input
                                  type="datetime-local"
                                  value={selectedOnlineForm.publishStartAt || ''}
                                  onChange={e => updateOnlineFormSchedule(selectedOnlineForm.id, 'publishStartAt', e.target.value || null)}
                                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                                />
                                {selectedOnlineForm.publishStartAt && (
                                  <button
                                    type="button"
                                    onClick={() => updateOnlineForm(selectedOnlineForm.id, 'publishStartAt', null)}
                                    className="rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-black text-slate-500 hover:bg-slate-50"
                                    aria-label="Başlangıcı temizle"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            </label>
                            <label className="flex flex-col gap-1.5">
                              <span className="text-xs font-black uppercase text-slate-500">Yayın Bitişi</span>
                              <div className="flex gap-2">
                                <input
                                  type="datetime-local"
                                  value={selectedOnlineForm.publishEndAt || ''}
                                  onChange={e => updateOnlineFormSchedule(selectedOnlineForm.id, 'publishEndAt', e.target.value || null)}
                                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                                />
                                {selectedOnlineForm.publishEndAt && (
                                  <button
                                    type="button"
                                    onClick={() => updateOnlineForm(selectedOnlineForm.id, 'publishEndAt', null)}
                                    className="rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-black text-slate-500 hover:bg-slate-50"
                                    aria-label="Bitişi temizle"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            </label>
                          </div>
                          {(() => {
                            const status = getPublishScheduleStatus(selectedOnlineForm);
                            const toneClass = {
                              slate: 'border-slate-200 bg-slate-100 text-slate-600',
                              amber: 'border-amber-200 bg-amber-100 text-amber-800',
                              rose: 'border-rose-200 bg-rose-100 text-rose-700',
                              emerald: 'border-emerald-200 bg-emerald-100 text-emerald-700',
                            }[status.tone];
                            return (
                              <p className={`mt-3 rounded-lg border px-3 py-2 text-xs font-black ${toneClass}`}>
                                Şu an: {status.label}
                              </p>
                            );
                          })()}
                        </div>

                        <div className="rounded-2xl border border-sky-200 bg-white shadow-sm">
                          <div className="rounded-t-2xl border-b border-sky-100 bg-gradient-to-r from-sky-500 to-[#0076b6] px-4 py-3">
                            <p className="text-xs font-black uppercase tracking-wide text-white/80">Vatandaşın İlk Göreceği Ekran</p>
                            <h4 className="text-base font-black text-white">Popup Bilgileri</h4>
                            <p className="mt-0.5 text-xs font-semibold text-white/85">Başvuru sayfası ilk açıldığında vatandaşın göreceği bilgilendirme ekranını buradan düzenleyin.</p>
                          </div>
                          {/* Kullanici istegi (2026-09-22, 4. tur): "logo ve
                              görsel bilgisi alanın sol başında, diğer
                              açıklama bilgileri ise logonun sağında ve daha
                              geniş olsun" - eskiden gorsel EN ALTTA, TAM
                              GENISLIK bir satirda; baslik/aciklama ise
                              onun USTUNDE ayri ayri tam genislik
                              satirlardaydi. Artik gorsel SOL sabit
                              sutunda, baslik+aciklama SAGDA (kalan/daha
                              genis alanda) yan yana. */}
                          <div className="grid gap-5 p-4 md:grid-cols-[200px_minmax(0,1fr)] md:items-start">
                            <div className="space-y-3">
                              <div className="mx-auto flex h-36 w-36 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm md:mx-0 md:h-44 md:w-full">
                                <img
                                  src={selectedOnlineIntro.imageUrl || generalSettings.logoDataUrl || '/sivas-belediyesi-logo.png'}
                                  alt="Popup görseli"
                                  className="h-full w-full object-contain"
                                />
                              </div>
                              <label className="flex flex-col gap-1.5">
                                <span className="text-xs font-black uppercase text-slate-500">Popup Görseli URL</span>
                                <input
                                  type="text"
                                  value={selectedOnlineIntro.imageUrl}
                                  onChange={e => updateOnlineFormIntro(selectedOnlineForm.id, 'imageUrl', e.target.value)}
                                  placeholder="Boş bırakılırsa kurum logosu kullanılır"
                                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-[#0076b6] focus:bg-white"
                                />
                              </label>
                              <div className="flex flex-col gap-2">
                                <label className="cursor-pointer rounded-lg bg-[#0076b6] px-3 py-2 text-center text-xs font-black text-white hover:bg-[#005c8f]">
                                  Resim Yükle
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={e => handleOnlineIntroImageUpload(selectedOnlineForm.id, e.target.files?.[0])}
                                    className="hidden"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => updateOnlineFormIntro(selectedOnlineForm.id, 'imageUrl', '')}
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
                                >
                                  Görseli Temizle
                                </button>
                              </div>
                            </div>

                            <div className="grid gap-4">
                              <label className="flex flex-col gap-1.5">
                                <span className="text-xs font-black uppercase text-slate-500">Popup Başlığı</span>
                                <input
                                  type="text"
                                  value={selectedOnlineIntro.title}
                                  onChange={e => updateOnlineFormIntro(selectedOnlineForm.id, 'title', e.target.value)}
                                  placeholder={selectedOnlineForm.title}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base font-black text-slate-900 outline-none focus:border-[#0076b6]"
                                />
                              </label>
                              <label className="flex flex-col gap-1.5">
                                <span className="text-xs font-black uppercase text-slate-500">Popup Açıklaması</span>
                                <textarea
                                  rows={10}
                                  value={selectedOnlineIntro.description}
                                  onChange={e => updateOnlineFormIntro(selectedOnlineForm.id, 'description', e.target.value)}
                                  placeholder="Başvuruya devam etmeden önce vatandaşın okumasını istediğiniz bilgilendirme metnini yazın."
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold leading-relaxed text-slate-900 outline-none focus:border-[#0076b6]"
                                />
                              </label>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                          <div className="mb-3">
                            <p className="text-xs font-black uppercase text-amber-700">Başvuru Kriterleri</p>
                            <p className="mt-1 text-xs font-semibold text-amber-800/80">Sadece işaretli kriterler başvuru sırasında uygulanır.</p>
                          </div>
                          <div className="grid gap-3">
                            {selectedOnlineCriteriaRows.map(option => {
                              const selectedTypes = selectedOnlineCriteriaRows.map(row => row.type);
                              const selectableOptions = ONLINE_CRITERION_OPTIONS.filter(candidate => candidate.type === option.type || !selectedTypes.includes(candidate.type));
                              return (
                                <div key={option.type} className="grid gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_32px] sm:items-center">
                                  <select
                                    value={option.type}
                                    onChange={e => changeOnlineFormCriterion(selectedOnlineForm.id, option.type, e.target.value as OnlineCriterionType)}
                                    className="min-w-0 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm font-bold text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                                  >
                                    {selectableOptions.map(candidate => (
                                      <option key={candidate.type} value={candidate.type}>{candidate.label}</option>
                                    ))}
                                  </select>
                                  {option.valueField ? (
                                    <input
                                      type="number"
                                      min={option.min || 1}
                                      value={Number(selectedOnlineCriteria[option.valueField]) || option.defaultValue || 1}
                                      onChange={e => updateOnlineFormCriteria(
                                        selectedOnlineForm.id,
                                        option.valueField!,
                                        Math.max(option.min || 1, Number(e.target.value) || option.defaultValue || 1) as OnlineApplicationCriteria[typeof option.valueField],
                                      )}
                                      className={`${option.widthClassName || 'w-24'} rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm font-black text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white`}
                                      aria-label={option.ariaLabel || option.label}
                                    />
                                  ) : (
                                    <span className="hidden sm:block" />
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeOnlineFormCriterion(selectedOnlineForm.id, option.type)}
                                    className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-black text-rose-500 hover:bg-rose-50"
                                    aria-label="Kriteri kaldir"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                            {selectedOnlineManualCriteria.map((criterion, index) => (
                              <div key={`manual-info-${index}`} className="grid gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_32px] sm:items-center">
                                <input
                                  type="text"
                                  value={criterion}
                                  onChange={e => updateOnlineManualCriterion(selectedOnlineForm.id, index, e.target.value)}
                                  placeholder="Bilgilendirme kriteri yazin. Orn: Sahsin vergi mukellefi olmamasi gerekir."
                                  className="min-w-0 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm font-bold text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeOnlineManualCriterion(selectedOnlineForm.id, index)}
                                  className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-black text-rose-500 hover:bg-rose-50"
                                  aria-label="Bilgilendirme kriterini kaldir"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => addOnlineFormCriterion(selectedOnlineForm.id)}
                              disabled={selectedOnlineCriteriaRows.length >= ONLINE_CRITERION_OPTIONS.length}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-300 bg-white text-lg font-black text-amber-700 hover:bg-amber-100 disabled:pointer-events-none disabled:opacity-50"
                              aria-label="Kriter ekle"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => addOnlineManualCriterion(selectedOnlineForm.id)}
                              className="w-fit rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100"
                            >
                              + Bilgilendirme kriteri
                            </button>
                          </div>
                          <div className="hidden">
                            <label className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={selectedOnlineCriteria.minAgeEnabled}
                                  onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'minAgeEnabled', e.target.checked)}
                                  className="h-4 w-4"
                                />
                                Belirlenen yaşın altındakiler başvuramasın
                              </span>
                              <input
                                type="number"
                                min={1}
                                value={selectedOnlineCriteria.minAge}
                                onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'minAge', Math.max(1, Number(e.target.value) || 18))}
                                className="w-24 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm font-black text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                                aria-label="Minimum yaş"
                              />
                            </label>
                            <label className="hidden">
                              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={selectedOnlineCriteria.maxIncomeEnabled}
                                  onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'maxIncomeEnabled', e.target.checked)}
                                  className="h-4 w-4"
                                />
                                Geliri ust siniri asanlari otomatik uygun degil yap
                              </span>
                              <input
                                type="number"
                                min={1}
                                value={selectedOnlineCriteria.maxIncome}
                                onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'maxIncome', Math.max(1, Number(e.target.value) || 10000))}
                                className="w-28 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm font-black text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                                aria-label="Gelir ust siniri"
                              />
                            </label>
                            <label className="hidden">
                              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={selectedOnlineCriteria.maxVehicleModelYearEnabled}
                                  onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'maxVehicleModelYearEnabled', e.target.checked)}
                                  className="h-4 w-4"
                                />
                                Arac modeli ust siniri asanlari otomatik uygun degil yap
                              </span>
                              <input
                                type="number"
                                min={1900}
                                value={selectedOnlineCriteria.maxVehicleModelYear}
                                onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'maxVehicleModelYear', Math.max(1900, Number(e.target.value) || 2005))}
                                className="w-24 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm font-black text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                                aria-label="Arac model ust siniri"
                              />
                            </label>
                            <label className="hidden">
                              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={selectedOnlineCriteria.maxAgeEnabled}
                                  onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'maxAgeEnabled', e.target.checked)}
                                  className="h-4 w-4"
                                />
                                Yas ust siniri asanlari otomatik uygun degil yap
                              </span>
                              <input
                                type="number"
                                min={1}
                                value={selectedOnlineCriteria.maxAge}
                                onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'maxAge', Math.max(1, Number(e.target.value) || 65))}
                                className="w-24 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm font-black text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                                aria-label="Yas ust siniri"
                              />
                            </label>
                            <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700">
                              <input
                                type="checkbox"
                                checked={selectedOnlineCriteria.uniqueAddressNoEnabled}
                                onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'uniqueAddressNoEnabled', e.target.checked)}
                                className="h-4 w-4"
                              />
                              Aynı adres no ile aynı forma ikinci başvuruyu engelle
                            </label>
                            <label className="hidden">
                              <input
                                type="checkbox"
                                checked={selectedOnlineCriteria.uniqueIdentityEnabled}
                                onChange={e => updateOnlineFormCriteria(selectedOnlineForm.id, 'uniqueIdentityEnabled', e.target.checked)}
                                className="h-4 w-4"
                              />
                              Aynı TC kimlik no ile aynı forma ikinci başvuruyu engelle
                            </label>
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-xs font-black uppercase text-slate-500">Form Alanları</p>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-500">{selectedOnlineForm.fields.length} alan</span>
                          </div>
                          <div className="space-y-3">
                            {selectedOnlineForm.fields.map(field => (
                              <div key={field.id} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_150px_96px_32px] md:items-center">
                                <input
                                  type="text"
                                  value={field.label}
                                  disabled={field.isFixed}
                                  onChange={e => updateFieldInForm(selectedOnlineForm.id, field.id, 'label', e.target.value)}
                                  className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm font-bold outline-none disabled:bg-slate-100 disabled:text-slate-500"
                                />
                                <select
                                  value={field.type}
                                  disabled={field.isFixed}
                                  onChange={e => updateFieldInForm(selectedOnlineForm.id, field.id, 'type', e.target.value as OnlineFormField['type'])}
                                  className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm font-bold outline-none disabled:bg-slate-100"
                                >
                                  <option value="text">Kısa Metin</option>
                                  <option value="number">Sayı</option>
                                  <option value="select">Seçenekli</option>
                                  <option value="textarea">Uzun Metin</option>
                                  <option value="file">Dosya Yükleme</option>
                                </select>
                                <label className="flex items-center gap-2 text-xs font-black uppercase text-slate-500">
                                  <input
                                    type="checkbox"
                                    checked={field.required}
                                    onChange={e => updateFieldInForm(selectedOnlineForm.id, field.id, 'required', e.target.checked)}
                                  />
                                  Zorunlu
                                </label>
                                {!field.isFixed ? (
                                  <button
                                    onClick={() => removeFieldFromForm(selectedOnlineForm.id, field.id)}
                                    className="flex h-8 w-8 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50"
                                    title="Alanı sil"
                                  >
                                    ×
                                  </button>
                                ) : (
                                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-[10px] font-black text-slate-400">S</span>
                                )}
                                {field.type === 'select' && (
                                  <label className="flex flex-col gap-1 md:col-span-4">
                                    <span className="text-xs font-black uppercase text-slate-500">Seçenekler</span>
                                    <textarea
                                      rows={2}
                                      value={(field.options ?? []).join('\n')}
                                      onChange={e => updateFieldOptions(selectedOnlineForm.id, field.id, e.target.value)}
                                      placeholder="Her satıra bir seçenek yazın. Örn: Var / Yok"
                                      className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm font-bold outline-none focus:border-[#0076b6]"
                                    />
                                  </label>
                                )}
                                {!field.isFixed && (
                                  <div className="grid gap-2 rounded-lg border border-dashed border-slate-300 bg-white p-3 md:col-span-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <label className="flex flex-col gap-1">
                                      <span className="text-xs font-black uppercase text-slate-500">Bu alan ne zaman görünsün?</span>
                                      <select
                                        value={field.showWhen?.fieldId || ''}
                                        onChange={e => updateFieldCondition(selectedOnlineForm.id, field.id, 'fieldId', e.target.value)}
                                        className="rounded border border-slate-300 bg-slate-50 px-2.5 py-2 text-sm font-bold outline-none focus:border-[#0076b6] focus:bg-white"
                                      >
                                        <option value="">Her zaman görünsün</option>
                                        {selectedOnlineForm.fields
                                          .filter(candidate => candidate.id !== field.id && candidate.type === 'select')
                                          .map(candidate => (
                                            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                                          ))}
                                      </select>
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      <span className="text-xs font-black uppercase text-slate-500">Seçilen değer</span>
                                      {selectedOnlineForm.fields.find(candidate => candidate.id === field.showWhen?.fieldId)?.options?.length ? (
                                        <select
                                          value={field.showWhen?.value || ''}
                                          onChange={e => updateFieldCondition(selectedOnlineForm.id, field.id, 'value', e.target.value)}
                                          disabled={!field.showWhen?.fieldId}
                                          className="rounded border border-slate-300 bg-slate-50 px-2.5 py-2 text-sm font-bold outline-none disabled:opacity-50 focus:border-[#0076b6] focus:bg-white"
                                        >
                                          <option value="">Değer seçin</option>
                                          {(selectedOnlineForm.fields.find(candidate => candidate.id === field.showWhen?.fieldId)?.options ?? []).map(option => (
                                            <option key={option} value={option}>{option}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          type="text"
                                          value={field.showWhen?.value || ''}
                                          onChange={e => updateFieldCondition(selectedOnlineForm.id, field.id, 'value', e.target.value)}
                                          disabled={!field.showWhen?.fieldId}
                                          placeholder="Örn: Var"
                                          className="rounded border border-slate-300 bg-slate-50 px-2.5 py-2 text-sm font-bold outline-none disabled:opacity-50 focus:border-[#0076b6] focus:bg-white"
                                        />
                                      )}
                                    </label>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          <div className="mt-4 grid gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_150px_auto]">
                            <input
                              type="text"
                              placeholder="Yeni alan adı..."
                              value={newFieldName}
                              onChange={e => setNewFieldName(e.target.value)}
                              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[#0076b6]"
                            />
                            <select
                              value={newFieldType}
                              onChange={e => setNewFieldType(e.target.value as OnlineFormField['type'])}
                              className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm font-bold outline-none"
                            >
                              <option value="text">Kısa Metin</option>
                              <option value="number">Sayı</option>
                              <option value="select">Seçenekli</option>
                              <option value="textarea">Uzun Metin</option>
                              <option value="file">Dosya Yükleme</option>
                            </select>
                            <button
                              onClick={() => addFieldToForm(selectedOnlineForm.id)}
                              className="rounded bg-[#0076b6] px-4 py-2 text-xs font-black text-white hover:bg-[#005c8f]"
                            >
                              Alan Ekle
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
                          <span className="text-xs font-bold text-rose-700">Bu formu ve alanlarını tamamen kaldırır.</span>
                          <button
                            onClick={() => removeOnlineForm(selectedOnlineForm.id)}
                            className="rounded border border-rose-200 bg-white px-3 py-1.5 text-xs font-black text-rose-600 hover:bg-rose-100"
                          >
                            Formu Sil
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-20 text-center text-sm font-bold text-slate-400">
                        Lütfen düzenlemek için bir form seçin.
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border border-[#0076b6]/20 bg-[#f2fbff] p-4 shadow-sm">
                      <p className="text-xs font-black uppercase text-[#0076b6]">Yayın ve Yönlendirme</p>
                      <h3 className="mt-1 text-lg font-black text-slate-900">Başvuru Linki</h3>
                      <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">
                        Bu bağlantıyı web sitesindeki butonlara, QR kodlara veya duyuru metinlerine ekleyebilirsiniz.
                      </p>
                      <div className="mt-3 rounded-lg border border-sky-200 bg-white p-2">
                        <input
                          readOnly
                          value={selectedOnlineFormUrl}
                          className="w-full bg-transparent text-xs font-bold text-slate-700 outline-none"
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void copyOnlineFormUrl()}
                          disabled={!selectedOnlineForm}
                          className="rounded-lg bg-[#0076b6] px-3 py-2 text-xs font-black text-white hover:bg-[#005c8f] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Linki Kopyala
                        </button>
                        <a
                          href={selectedOnlineFormUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`rounded-lg border border-[#0076b6] bg-white px-3 py-2 text-center text-xs font-black text-[#0076b6] hover:bg-sky-50 ${!selectedOnlineForm ? 'pointer-events-none opacity-50' : ''}`}
                        >
                          Yeni Sekmede Aç
                        </a>
                      </div>
                      {onlineFormStatus && (
                        <div className="mt-3 rounded border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-[#005f95]">
                          {onlineFormStatus}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-[#6fb744]/25 bg-[#f5fbf0] p-4 shadow-sm">
                      <p className="text-xs font-black uppercase text-[#4c8f2b]">Tüm Formlar</p>
                      <h3 className="mt-1 text-lg font-black text-slate-900">Başvuru Ana Sayfası</h3>
                      <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">
                        Bu sabit bağlantı, o an aktif olan TÜM online başvuru türlerini listeler; vatandaş buradan hangisine
                        başvuracağını seçer. Tek bir başvuru türü aktifse doğrudan o forma yönlendirir. Genel duyurularda
                        (afiş, SMS, web sitesi ana menüsü) bu linki kullanın.
                      </p>
                      <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-2">
                        <input
                          readOnly
                          value={onlineFormsHubUrl}
                          className="w-full bg-transparent text-xs font-bold text-slate-700 outline-none"
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void copyOnlineFormsHubUrl()}
                          className="rounded-lg bg-[#6fb744] px-3 py-2 text-xs font-black text-white hover:bg-[#5aa333]"
                        >
                          Linki Kopyala
                        </button>
                        <a
                          href={onlineFormsHubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-[#6fb744] bg-white px-3 py-2 text-center text-xs font-black text-[#4c8f2b] hover:bg-emerald-50"
                        >
                          Yeni Sekmede Aç
                        </a>
                      </div>
                    </div>

                    <div
                      role="button"
                      tabIndex={selectedOnlineForm ? 0 : -1}
                      onClick={() => selectedOnlineForm && window.open(selectedOnlineFormUrl, '_blank', 'noopener,noreferrer')}
                      onKeyDown={event => {
                        if (!selectedOnlineForm) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          window.open(selectedOnlineFormUrl, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      title="İnternet sayfasını yeni sekmede aç"
                      className={`group block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#0076b6]/40 hover:shadow-lg ${!selectedOnlineForm ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
                    >
                      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-black uppercase text-slate-500">Canlı Sayfa Önizlemesi</p>
                          <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black uppercase text-[#0076b6] group-hover:bg-[#0076b6] group-hover:text-white">
                            Yeni sekmede aç
                          </span>
                        </div>
                      </div>
                      <div className="bg-slate-100 p-3">
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                          <div className="bg-[#003f82] px-4 py-5 text-white">
                            <div className="flex items-center gap-3">
                              <img src={generalSettings.logoDataUrl || '/sivas-belediyesi-logo.png'} alt={generalSettings.institutionName || 'Kurum logosu'} className="h-11 w-11 object-contain" />
                              <div>
                                <p className="text-[10px] font-black uppercase text-white/70">{generalSettings.institutionName || 'Sivas Belediyesi'}</p>
                                <h4 className="text-sm font-black leading-tight">{generalSettings.departmentName || 'Sosyal Hizmetler Müdürlüğü'}</h4>
                              </div>
                            </div>
                            {generalContactItems.length > 0 && (
                              <div className="mt-3 grid gap-1.5 rounded-lg border border-white/10 bg-white/10 px-2 py-2">
                                {generalContactItems.slice(0, 3).map((item, index) => (
                                  <div key={`${item.label}-${index}`} className="min-w-0">
                                    <span className="block text-[8px] font-black uppercase tracking-wide text-white/50">{item.label}</span>
                                    {item.href ? (
                                      <button
                                        type="button"
                                        onClick={event => {
                                          event.stopPropagation();
                                          window.open(item.href, '_blank', 'noopener,noreferrer');
                                        }}
                                        className="block max-w-full truncate text-left text-[10px] font-black text-white underline-offset-2 hover:underline"
                                      >
                                        {item.value}
                                      </button>
                                    ) : (
                                      <p className="truncate text-[10px] font-semibold text-white/85">{item.value}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="space-y-3 p-4">
                            <h4 className="text-lg font-black leading-tight text-slate-900">{selectedOnlineForm?.title || 'Başvuru Formu'}</h4>
                            <div className="grid grid-cols-2 gap-2 rounded-lg border border-sky-100 bg-sky-50 p-2">
                              <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-slate-500">T.C. Kimlik No *</label>
                                <div className="h-9 rounded-lg border border-slate-200 bg-white" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-slate-500">Doğum Tarihi *</label>
                                <div className="h-9 rounded-lg border border-slate-200 bg-white" />
                              </div>
                            </div>
                            {(selectedOnlineForm?.fields ?? []).filter(field => {
                              const label = field.label.toLocaleLowerCase('tr-TR')
                              return !label.includes('tc') && !label.includes('kimlik') && !label.includes('doğum')
                            }).slice(0, 4).map(field => (
                              <div key={field.id} className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-slate-500">{field.label} {field.required && <span className="text-rose-500">*</span>}</label>
                                <div className="h-9 rounded-lg border border-slate-200 bg-slate-50" />
                              </div>
                            ))}
                            <div className="rounded-lg bg-[#6fb744] py-2 text-center text-xs font-black text-white">Başvuruyu Gönder</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'userPermissions' && (
            <div className="space-y-6">
              <p className="max-w-3xl border-b border-slate-200 pb-4 text-xl font-semibold text-slate-500">
                Kullanıcılar `kullanicilar` tablosundan alınır. Seçilen kullanıcı için görülebilecek sayfaları ve yapılabilecek işlemleri buradan sınırlandırabilirsiniz.
              </p>

              <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-lg font-black uppercase text-slate-500">Kullanıcılar</p>
                    <span className="rounded-full bg-white px-2.5 py-1 text-base font-black text-slate-500">{filteredPermissionUsers.length}/{settingsUsers.length}</span>
                  </div>
                  <div className="relative mb-3">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                        <circle cx="9" cy="9" r="6" />
                        <path d="M17 17l-3.5-3.5" strokeLinecap="round" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      value={permissionUserSearchTerm}
                      onChange={(event) => setPermissionUserSearchTerm(event.target.value)}
                      placeholder="Kullanıcı ara..."
                      className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-lg font-bold text-slate-900 outline-none focus:border-[#1E2A38]"
                    />
                    {permissionUserSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setPermissionUserSearchTerm('')}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                      >
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                    {filteredPermissionUsers.map(user => {
                      const isSelected = selectedPermissionUserId === user.id;
                      const config = userPermissions[user.id];
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => setSelectedPermissionUserId(user.id)}
                          className={`w-full rounded-lg border p-3 text-left transition-all ${isSelected ? 'border-[#1E2A38] bg-white shadow-sm' : 'border-slate-300 bg-white hover:border-slate-400'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-lg font-black text-slate-900">{user.name || user.username || 'İsimsiz kullanıcı'}</p>
                              <p className="truncate text-base font-bold text-slate-400">{user.username || user.email || `ID: ${user.id}`}</p>
                            </div>
                            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${config?.isActive === false || user.status === 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                          </div>
                          <p className="mt-2 text-base font-bold text-slate-500">
                            {config?.isActive === false || user.status === 0 ? 'Pasif kullanıcı' : config?.isAdmin === false ? 'Kısıtlı yetki' : 'Tam yetki'}
                          </p>
                        </button>
                      );
                    })}
                    {filteredPermissionUsers.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-lg font-bold text-slate-400">
                        {settingsUsers.length === 0 ? 'Kullanıcı bulunamadı.' : 'Aramanızla eşleşen kullanıcı bulunamadı.'}
                      </div>
                    )}
                  </div>
                </div>

                {selectedPermissionUser ? (
                  <div className="space-y-5">
                    {(() => {
                      // Kullanici istegi (28 Agu 2026): bu baslik alani "sekilsiz
                      // ve karmasik" duruyordu (kimlik + dikey gun listesi + 4
                      // genis onay kutusu ayni degrade seride sikismisti). Daha
                      // profesyonel: (1) ust degrade seritte SADECE kimlik +
                      // durum rozetleri, (2) altta beyaz govdede 2 duzenli
                      // bolum - "Giriş İzni" (7 gun + saat) ve "Hesap ve Erişim"
                      // (4 secim, aciklamali dikey liste).
                      const cfg = ensureUserPermissionConfig(selectedPermissionUser.id);
                      const loginSchedule = cfg.loginSchedule;
                      const allowedWeekdays = loginSchedule?.allowedWeekdays?.length ? loginSchedule.allowedWeekdays : ALL_WEEKDAYS;
                      const isRestricted = !isLoginScheduleEmpty(loginSchedule);
                      const isActive = cfg.isActive !== false;
                      const toggleRow = (opts: {
                        checked: boolean;
                        onChange: (next: boolean) => void;
                        title: string;
                        desc?: string;
                        accent: string;
                      }) => (
                        <label className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-white px-4 py-3 transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 ${opts.checked ? opts.accent : 'border-slate-300 dark:border-slate-700'}`}>
                          <input
                            type="checkbox"
                            checked={opts.checked}
                            onChange={(event) => opts.onChange(event.target.checked)}
                            className="mt-0.5 h-5 w-5 shrink-0 accent-[#1E2A38]"
                          />
                          <span className="min-w-0">
                            <span className="block text-lg font-black text-slate-800 dark:text-slate-100">{opts.title}</span>
                            {opts.desc && <span className="mt-1 block text-base font-semibold leading-snug text-slate-400 dark:text-slate-500">{opts.desc}</span>}
                          </span>
                        </label>
                      );

                      return (
                        <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                          {/* Kimlik seridi */}
                          <div className="flex flex-wrap items-center gap-3 bg-[#1E2A38] px-5 py-4">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-xl font-black text-white ring-1 ring-white/30">
                              {(selectedPermissionUser.name || selectedPermissionUser.username || '?').slice(0, 1).toLocaleUpperCase('tr-TR')}
                            </span>
                            <div className="min-w-0">
                              <p className="text-base font-black uppercase tracking-wide text-white/75">Seçili Kullanıcı</p>
                              <h3 className="truncate text-2xl font-black text-white">{selectedPermissionUser.name || selectedPermissionUser.username}</h3>
                              <p className="truncate text-lg font-bold text-white/80">{selectedPermissionUser.email || selectedPermissionUser.username || `ID: ${selectedPermissionUser.id}`}</p>
                            </div>
                            <div className="ml-auto flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full px-3 py-1.5 text-base font-black uppercase ${isActive ? 'bg-emerald-400 text-emerald-950' : 'bg-slate-200 text-slate-600'}`}>
                                {isActive ? 'Aktif' : 'Pasif'}
                              </span>
                              {cfg.isAdmin && (
                                <span className="rounded-full bg-white px-3 py-1.5 text-base font-black uppercase text-[#1E2A38]">Tam Yetkili</span>
                              )}
                              {isRestricted && (
                                <span className="rounded-full bg-amber-400 px-3 py-1.5 text-base font-black uppercase text-amber-950">Giriş Kısıtlı</span>
                              )}
                            </div>
                          </div>

                          {/* Govde: iki bolum */}
                          <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                            {/* Giriş İzni */}
                            <div className="rounded-lg border border-slate-300 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                              <p className="mb-2 text-lg font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Giriş İzni — Gün ve Saat</p>
                              <div className="grid grid-cols-7 gap-1">
                                {LOGIN_WEEKDAY_LABELS.map(({ day, label }) => {
                                  const isOn = allowedWeekdays.includes(day);
                                  return (
                                    <button
                                      key={day}
                                      type="button"
                                      title={isOn ? `${label} günü girişe açık - kapatmak için tıklayın` : `${label} günü girişe kapalı - açmak için tıklayın`}
                                      onClick={() => toggleUserLoginWeekday(selectedPermissionUser.id, day)}
                                      className={`h-10 rounded-md text-sm font-black uppercase transition ${isOn ? 'bg-[#1E2A38] text-white shadow-sm' : 'bg-white text-slate-400 ring-1 ring-slate-300 line-through dark:bg-slate-900 dark:text-slate-600 dark:ring-slate-700'}`}
                                    >
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="mt-3 flex items-end gap-2">
                                <label className="flex-1">
                                  <span className="mb-1 block text-sm font-black uppercase text-slate-400">Başlangıç</span>
                                  <input
                                    type="time"
                                    value={loginSchedule?.timeStart ?? ''}
                                    onChange={(event) => updateUserLoginScheduleTime(selectedPermissionUser.id, 'timeStart', event.target.value)}
                                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-lg font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </label>
                                <span className="pb-2 text-lg font-black text-slate-400">–</span>
                                <label className="flex-1">
                                  <span className="mb-1 block text-sm font-black uppercase text-slate-400">Bitiş</span>
                                  <input
                                    type="time"
                                    value={loginSchedule?.timeEnd ?? ''}
                                    onChange={(event) => updateUserLoginScheduleTime(selectedPermissionUser.id, 'timeEnd', event.target.value)}
                                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-lg font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </label>
                              </div>
                              <p className="mt-2 text-base font-semibold text-slate-400">Gün seçilmezse her gün, saat boş bırakılırsa tüm saatler açık sayılır.</p>
                            </div>

                            {/* Hesap ve Erişim */}
                            <div>
                              <p className="mb-2 text-lg font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Hesap ve Erişim</p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {toggleRow({
                                  checked: isActive,
                                  onChange: (next) => updateSelectedUserStatus(selectedPermissionUser.id, next),
                                  title: isActive ? 'Aktif kullanıcı' : 'Pasif kullanıcı',
                                  desc: 'Pasif kullanıcı sisteme hiç giriş yapamaz.',
                                  accent: 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800',
                                })}
                                {toggleRow({
                                  checked: cfg.isAdmin,
                                  onChange: (next) => updateUserPermissionConfig(selectedPermissionUser.id, config => ({
                                    ...config,
                                    isAdmin: next,
                                    allowedPages: next ? permissionPages.map(page => page.path) : config.allowedPages,
                                    allowedActions: next ? USER_ACTION_PERMISSION_DEFINITIONS.map(action => action.id) : config.allowedActions,
                                  })),
                                  title: 'Tam yetkili kullanıcı',
                                  desc: 'Tüm sayfa ve işlemlere sınırsız erişir, kısıtlardan muaftır.',
                                  accent: 'border-sky-300 bg-sky-50/50 dark:border-sky-800',
                                })}
                                {toggleRow({
                                  checked: cfg.whatsappNotifications === true,
                                  onChange: (next) => updateUserPermissionConfig(selectedPermissionUser.id, config => ({ ...config, whatsappNotifications: next })),
                                  title: 'Onay bildirimlerini WhatsApp’tan da alsın',
                                  desc: 'Kayıtlı telefon numarasına gönderilir; kapalıysa sadece bilgisayar bildirimi gelir.',
                                  accent: 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800',
                                })}
                                {toggleRow({
                                  checked: cfg.allowRemoteMobileAccess === true,
                                  onChange: (next) => updateUserPermissionConfig(selectedPermissionUser.id, config => ({ ...config, allowRemoteMobileAccess: next })),
                                  title: 'Uzaktan / mobil cihazdan erişebilsin',
                                  desc: 'Kapalıysa yalnızca yerel ağdaki masaüstü bilgisayardan girer; internet (kurum dışı adres) veya telefon/tablet tarayıcısı engellenir. Tam yetkililer muaftır.',
                                  accent: 'border-amber-300 bg-amber-50/50 dark:border-amber-800',
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="grid gap-5 2xl:grid-cols-2">
                      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="h-6 w-1.5 rounded-full bg-[#1E2A38]" />
                            <h3 className="text-xl font-black text-slate-900">Görebileceği Sayfalar</h3>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-base font-black text-slate-500">
                              {ensureUserPermissionConfig(selectedPermissionUser.id).allowedPages.length}/{permissionPages.length}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => updateUserPermissionConfig(selectedPermissionUser.id, config => ({
                              ...config,
                              isAdmin: false,
                              allowedPages: permissionPages.map(page => page.path),
                            }))}
                            className="rounded border border-slate-300 px-3 py-1.5 text-base font-black text-slate-500 hover:bg-slate-50"
                          >
                            Tümünü Seç
                          </button>
                        </div>
                        <div className="max-h-[480px] space-y-3 overflow-y-auto p-3">
                          {permissionPageGroupOrder.map((groupName, groupIndex) => {
                            const theme = PERMISSION_GROUP_COLOR_THEMES[groupIndex % PERMISSION_GROUP_COLOR_THEMES.length];
                            const pagesInGroup = groupedPermissionPages[groupName];
                            const permissionConfig = ensureUserPermissionConfig(selectedPermissionUser.id);
                            const allChecked = pagesInGroup.every(page => permissionConfig.allowedPages.includes(page.path));

                            return (
                              <div key={groupName} className={`overflow-hidden rounded-lg border ${theme.border}`}>
                                <div className={`flex items-center justify-between gap-2 bg-gradient-to-r px-3 py-2 ${theme.header}`}>
                                  <span className="text-base font-black uppercase tracking-wide text-white">{groupName}</span>
                                  <button
                                    type="button"
                                    onClick={() => updateUserPermissionConfig(selectedPermissionUser.id, config => ({
                                      ...config,
                                      isAdmin: false,
                                      allowedPages: allChecked
                                        ? config.allowedPages.filter(path => !pagesInGroup.some(page => page.path === path))
                                        : Array.from(new Set([...config.allowedPages, ...pagesInGroup.map(page => page.path)])),
                                    }))}
                                    className={`rounded-full px-2.5 py-1 text-sm font-black uppercase text-white transition ${theme.chipBg} ${theme.chipHover}`}
                                  >
                                    {allChecked ? 'Temizle' : 'Tümünü Seç'}
                                  </button>
                                </div>
                                <div className={`grid gap-2 p-3 sm:grid-cols-2 ${theme.bg}`}>
                                  {pagesInGroup.map(page => (
                                    <label key={page.path} className="flex items-center gap-2 rounded-lg border border-white bg-white px-3 py-2.5 text-lg font-bold text-slate-700 shadow-sm transition hover:border-slate-300">
                                      <input
                                        type="checkbox"
                                        checked={permissionConfig.allowedPages.includes(page.path)}
                                        onChange={() => toggleUserPagePermission(selectedPermissionUser.id, page.path)}
                                        className="h-5 w-5"
                                      />
                                      <span className="min-w-0">
                                        <span className="block truncate">{page.name}</span>
                                        <span className="block truncate text-sm font-black text-slate-400">{page.path}</span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="h-6 w-1.5 rounded-full bg-[#1E2A38]" />
                            <h3 className="text-xl font-black text-slate-900">Yapabileceği İşlemler</h3>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-base font-black text-slate-500">
                              {ensureUserPermissionConfig(selectedPermissionUser.id).allowedActions.length}/{USER_ACTION_PERMISSION_DEFINITIONS.length}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => updateUserPermissionConfig(selectedPermissionUser.id, config => ({
                              ...config,
                              isAdmin: false,
                              allowedActions: USER_ACTION_PERMISSION_DEFINITIONS.map(action => action.id),
                            }))}
                            className="rounded border border-slate-300 px-3 py-1.5 text-base font-black text-slate-500 hover:bg-slate-50"
                          >
                            Tümünü Seç
                          </button>
                        </div>
                        <div className="max-h-[480px] space-y-3 overflow-y-auto p-3">
                          {permissionActionGroupOrder.map((groupName, groupIndex) => {
                            const theme = PERMISSION_GROUP_COLOR_THEMES[groupIndex % PERMISSION_GROUP_COLOR_THEMES.length];
                            const actionsInGroup = groupedPermissionActions[groupName];
                            const permissionConfig = ensureUserPermissionConfig(selectedPermissionUser.id);
                            const allChecked = actionsInGroup.every(action => permissionConfig.allowedActions.includes(action.id));

                            return (
                              <div key={groupName} className={`overflow-hidden rounded-lg border ${theme.border}`}>
                                <div className={`flex items-center justify-between gap-2 bg-gradient-to-r px-3 py-2 ${theme.header}`}>
                                  <span className="text-base font-black uppercase tracking-wide text-white">{groupName}</span>
                                  <button
                                    type="button"
                                    onClick={() => updateUserPermissionConfig(selectedPermissionUser.id, config => ({
                                      ...config,
                                      isAdmin: false,
                                      allowedActions: allChecked
                                        ? config.allowedActions.filter(id => !actionsInGroup.some(action => action.id === id))
                                        : Array.from(new Set([...config.allowedActions, ...actionsInGroup.map(action => action.id)])),
                                    }))}
                                    className={`rounded-full px-2.5 py-1 text-sm font-black uppercase text-white transition ${theme.chipBg} ${theme.chipHover}`}
                                  >
                                    {allChecked ? 'Temizle' : 'Tümünü Seç'}
                                  </button>
                                </div>
                                <div className={`space-y-2 p-3 ${theme.bg}`}>
                                  {actionsInGroup.map(action => {
                                    const isAllowed = permissionConfig.allowedActions.includes(action.id);
                                    const schedule = permissionConfig.actionSchedules?.[action.id];
                                    const isWindowMode = schedule !== undefined;

                                    return (
                                      <div key={action.id} className="rounded-lg border border-white bg-white px-3 py-2.5 shadow-sm">
                                        <label className="flex items-center gap-3">
                                          <input
                                            type="checkbox"
                                            checked={isAllowed}
                                            onChange={() => toggleUserActionPermission(selectedPermissionUser.id, action.id)}
                                            className="h-5 w-5"
                                          />
                                          <span className="min-w-0 text-lg font-black text-slate-800">{action.label}</span>
                                        </label>

                                        {isAllowed && (
                                          <div className="ml-8 mt-2 space-y-2 border-t border-slate-200 pt-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={() => setUserActionScheduleMode(selectedPermissionUser.id, action.id, 'always')}
                                                className={`rounded px-3 py-1.5 text-sm font-black uppercase transition ${!isWindowMode ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white text-slate-500 hover:bg-slate-100'}`}
                                              >
                                                Tam süreli
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setUserActionScheduleMode(selectedPermissionUser.id, action.id, 'window')}
                                                className={`rounded px-3 py-1.5 text-sm font-black uppercase transition ${isWindowMode ? 'bg-amber-600 text-white' : 'border border-slate-300 bg-white text-slate-500 hover:bg-slate-100'}`}
                                              >
                                                Zaman aralığı
                                              </button>
                                              {isWindowMode && !isScheduleEmpty(schedule) && (
                                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-black uppercase text-amber-700">Kısıtlı</span>
                                              )}
                                            </div>

                                            {isWindowMode && (
                                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                                <label className="block">
                                                  <span className="mb-1 block text-sm font-black uppercase text-slate-400">Saat Başlangıç</span>
                                                  <input
                                                    type="time"
                                                    value={schedule?.timeStart ?? ''}
                                                    onChange={(event) => updateUserActionScheduleField(selectedPermissionUser.id, action.id, 'timeStart', event.target.value)}
                                                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-base font-bold text-slate-800"
                                                  />
                                                </label>
                                                <label className="block">
                                                  <span className="mb-1 block text-sm font-black uppercase text-slate-400">Saat Bitiş</span>
                                                  <input
                                                    type="time"
                                                    value={schedule?.timeEnd ?? ''}
                                                    onChange={(event) => updateUserActionScheduleField(selectedPermissionUser.id, action.id, 'timeEnd', event.target.value)}
                                                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-base font-bold text-slate-800"
                                                  />
                                                </label>
                                                <label className="block">
                                                  <span className="mb-1 block text-sm font-black uppercase text-slate-400">Tarih Başlangıç</span>
                                                  <input
                                                    type="date"
                                                    value={schedule?.dateStart ?? ''}
                                                    onChange={(event) => updateUserActionScheduleField(selectedPermissionUser.id, action.id, 'dateStart', event.target.value)}
                                                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-base font-bold text-slate-800"
                                                  />
                                                </label>
                                                <label className="block">
                                                  <span className="mb-1 block text-sm font-black uppercase text-slate-400">Tarih Bitiş</span>
                                                  <input
                                                    type="date"
                                                    value={schedule?.dateEnd ?? ''}
                                                    onChange={(event) => updateUserActionScheduleField(selectedPermissionUser.id, action.id, 'dateEnd', event.target.value)}
                                                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-base font-bold text-slate-800"
                                                  />
                                                </label>
                                              </div>
                                            )}
                                            <p className="text-sm font-bold text-slate-400">
                                              Saat ve tarih alanlarının hepsi opsiyoneldir - sadece saat, sadece tarih ya da ikisi birden ayarlanabilir. Boş bırakılan alan kısıtlama uygulamaz.
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {userPermissionStatus && (
                      <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-xl font-bold text-[#1E2A38]">
                        {userPermissionStatus}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-20 text-center text-xl font-bold text-slate-400">
                    Yetki düzenlemek için bir kullanıcı seçin.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'scheduledTasks' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h2 className="text-2xl font-extrabold text-[#1E2A38]">Zamanlanmış SQL Görevleri</h2>
                <button
                  onClick={resetScheduledTaskForm}
                  className="rounded-md bg-[#6fb744] px-5 py-2.5 text-xl font-bold text-white hover:bg-[#5aa333]"
                >
                  + Yeni Görev
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                 {/* Görev Formu */}
                 <div className="space-y-4 p-5 border border-slate-300 rounded-xl bg-slate-50/50">
                    <h3 className="text-xl font-bold text-slate-800 border-b border-slate-200 pb-2">{editingScheduledTaskId ? 'Görevi Düzenle' : 'Yeni Görev Tanımı'}</h3>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xl font-black uppercase text-slate-500">Görev Adı</span>
                      <input
                        type="text"
                        value={scheduledTaskForm.name}
                        onChange={e => setScheduledTaskForm({...scheduledTaskForm, name: e.target.value})}
                        className="rounded-md border border-slate-300 px-4 py-2.5 text-xl outline-none focus:border-[#1E2A38]"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xl font-black uppercase text-slate-500">SQL Sorgusu</span>
                      <textarea
                        rows={6}
                        value={scheduledTaskForm.query}
                        onChange={e => setScheduledTaskForm({...scheduledTaskForm, query: e.target.value})}
                        className="rounded-md border border-slate-300 px-4 py-2.5 text-lg font-mono outline-none focus:border-[#1E2A38]"
                      />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                       <label className="flex flex-col gap-1.5">
                          <span className="text-xl font-black uppercase text-slate-500">Periyot</span>
                          <select
                            value={scheduledTaskForm.scheduleType}
                            onChange={e => setScheduledTaskForm({...scheduledTaskForm, scheduleType: e.target.value as ScheduledSqlTaskType})}
                            className="rounded-md border border-slate-300 px-3 py-2.5 text-xl outline-none focus:border-[#1E2A38]"
                          >
                             <option value="daily">Günlük</option>
                             <option value="weekly">Haftalık</option>
                          </select>
                       </label>
                       <label className="flex flex-col gap-1.5">
                          <span className="text-xl font-black uppercase text-slate-500">Günü</span>
                          <select
                            disabled={scheduledTaskForm.scheduleType === 'daily'}
                            value={scheduledTaskForm.dayOfWeek}
                            onChange={e => setScheduledTaskForm({...scheduledTaskForm, dayOfWeek: parseInt(e.target.value)})}
                            className="rounded-md border border-slate-300 px-3 py-2.5 text-xl outline-none focus:border-[#1E2A38] disabled:bg-slate-100"
                          >
                             {weekdayOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                       </label>
                       <label className="flex flex-col gap-1.5">
                          <span className="text-xl font-black uppercase text-slate-500">Saat</span>
                          <input
                            type="time"
                            value={scheduledTaskForm.timeOfDay}
                            onChange={e => setScheduledTaskForm({...scheduledTaskForm, timeOfDay: e.target.value})}
                            className="rounded-md border border-slate-300 px-3 py-2.5 text-xl outline-none focus:border-[#1E2A38]"
                          />
                       </label>
                    </div>
                    <div className="pt-2 flex justify-between items-center">
                       <button
                         onClick={resetScheduledTaskForm}
                         className="text-xl font-bold text-slate-400 hover:text-slate-600"
                       >
                         İptal
                       </button>
                       <button
                         onClick={saveScheduledTask}
                         disabled={isSavingScheduledTask}
                         className="rounded-md bg-[#1E2A38] px-8 py-3 text-xl font-bold text-white shadow-md hover:bg-[#2A3B4D]"
                       >
                         {isSavingScheduledTask ? 'Kaydediliyor...' : 'Kaydet'}
                       </button>
                    </div>
                 </div>

                 {/* Görev Listesi */}
                 <div className="space-y-4">
                    <p className="text-xl font-black uppercase text-slate-500">Tanımlı Görevler ({scheduledTasks.length})</p>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                       {scheduledTasks.map(task => (
                         <div key={task.id} className="p-4 border border-slate-300 rounded-xl bg-white shadow-sm hover:border-[#1E2A38]/30 transition-all">
                            <div className="flex items-center justify-between mb-2">
                               <h4 className="text-xl font-bold text-slate-800">{task.name}</h4>
                               <div className="flex gap-2">
                                  <button onClick={() => runScheduledTaskNow(task.id)} className="text-lg bg-slate-100 text-[#1E2A38] px-3 py-1.5 rounded-md font-bold hover:bg-slate-200">Çalıştır</button>
                                  <button onClick={() => editScheduledTask(task)} className="text-lg bg-slate-100 text-slate-600 px-3 py-1.5 rounded-md font-bold hover:bg-slate-200">Düzenle</button>
                                  <button onClick={() => deleteScheduledTask(task.id)} className="text-lg bg-rose-50 text-rose-500 px-3 py-1.5 rounded-md font-bold hover:bg-rose-100">Sil</button>
                               </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 text-lg font-bold text-slate-500 border-t border-slate-200 pt-2">
                               <span>Periyot: {task.scheduleType === 'daily' ? 'Günlük' : `Haftalık (${weekdayOptions.find(w => w.value === task.dayOfWeek)?.label})`}</span>
                               <span>Saat: {task.timeOfDay}</span>
                               <span>Son Çalışma: {formatScheduledTaskDate(task.lastRunAt)}</span>
                               <span className={task.lastStatus === 'success' ? 'text-green-600' : task.lastStatus === 'error' ? 'text-rose-600' : ''}>
                                 Durum: {task.lastStatus === 'idle' ? 'Beklemede' : task.lastStatus === 'success' ? 'Başarılı' : 'Hata!'}
                               </span>
                            </div>
                         </div>
                       ))}
                    </div>
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'databaseBackups' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-2xl font-extrabold text-[#1E2A38]">Veritabanı İşlemleri</h2>
                  <p className="text-xl font-semibold text-slate-500">PostgreSQL yedek alma, geri yükleme ve zamanlı yedekleme ayarları</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void refreshDatabaseBackups()}
                    disabled={isLoadingDatabaseBackups}
                    className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-xl font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {isLoadingDatabaseBackups ? 'Yenileniyor...' : 'Yedekleri Yenile'}
                  </button>
                  <button
                    onClick={runDatabaseBackupNow}
                    disabled={isRunningDatabaseBackup || isSavingDatabaseBackupSettings || databaseBackupSettings.databaseNames.length === 0}
                    className="rounded-md bg-[#1E2A38] px-5 py-2.5 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D] disabled:opacity-50"
                  >
                    {isRunningDatabaseBackup ? 'Yedek Alınıyor...' : 'Şimdi Yedek Al'}
                  </button>
                </div>
              </div>

              {databaseBackupStatus && (
                <div className={`rounded-lg border px-4 py-3 text-xl font-bold ${
                  databaseBackupStatus.toLocaleLowerCase('tr-TR').includes('hata') || databaseBackupStatus.toLocaleLowerCase('tr-TR').includes('kontrol')
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : 'border-sky-200 bg-sky-50 text-[#005f95]'
                }`}>
                  {databaseBackupStatus}
                </div>
              )}

              <div className="grid gap-5 xl:grid-cols-[minmax(400px,540px)_minmax(0,1fr)]">
                <div className="space-y-4 rounded-xl border border-slate-300 bg-slate-50/60 p-5">
                  <div>
                    <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">Yedekleme Ayarları</p>
                    <p className="mt-1.5 text-xl font-semibold text-slate-500">Klasör yolu sunucunun/uygulamanın çalıştığı bilgisayara göre yazılır.</p>
                  </div>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xl font-black uppercase text-slate-500">Yedek Klasörü</span>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={databaseBackupSettings.backupDirectory}
                        onChange={event => setDatabaseBackupSettings(current => ({ ...current, backupDirectory: event.target.value }))}
                        placeholder="C:\Yedekler veya backups/database"
                        className="min-w-0 flex-1 rounded-md border border-slate-300 px-4 py-2.5 text-xl outline-none focus:border-[#1E2A38]"
                      />
                      <button
                        type="button"
                        onClick={openFolderPicker}
                        className="whitespace-nowrap rounded-md border border-[#1E2A38] bg-white px-4 py-2.5 text-xl font-black text-[#1E2A38] hover:bg-slate-100"
                      >
                        Klasor Sec
                      </button>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xl font-black uppercase text-slate-500">Manuel Yedek Alinacak Veritabanlari</span>
                    <div className="grid gap-2 rounded-lg border border-slate-300 bg-white p-3">
                      {databaseBackupOptions.map(option => (
                        <label key={option.name} className="flex items-center gap-2 text-xl font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={databaseBackupSettings.databaseNames.includes(option.name)}
                            onChange={() => toggleDatabaseBackupSelection(option.name)}
                            className="h-5 w-5"
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                      {databaseBackupOptions.length === 0 && (
                        <span className="text-xl font-bold text-slate-400">Veritabani listesi alinamadi.</span>
                      )}
                    </div>
                    <span className="text-lg font-semibold text-slate-400">Simdi yedek al butonu isaretli tum veritabanlarini yedekler.</span>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xl font-black uppercase text-slate-500">PostgreSQL Bin Klasörü</span>
                    <input
                      type="text"
                      value={databaseBackupSettings.postgresBinDirectory}
                      onChange={event => setDatabaseBackupSettings(current => ({ ...current, postgresBinDirectory: event.target.value }))}
                      placeholder="C:\Program Files\PostgreSQL\16\bin"
                      className="rounded-md border border-slate-300 px-4 py-2.5 text-xl outline-none focus:border-[#1E2A38]"
                    />
                    <span className="text-lg font-semibold text-slate-400">pg_dump ve psql PATH içinde değilse bu alan gereklidir.</span>
                  </label>

                  <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={databaseBackupSettings.scheduleEnabled}
                      onChange={event => setDatabaseBackupSettings(current => ({ ...current, scheduleEnabled: event.target.checked }))}
                      className="h-5 w-5"
                    />
                    <span className="text-xl font-bold text-slate-700">Otomatik yedekleme aktif</span>
                  </label>

                  {/* Kullanici istegi: eski TEK programli (Periyot/Gunu/Saat +
                      "Son Calisma" durumu) yedekleme arayuzu buradaydi -
                      yerini asagidaki COKLU program listesi ("Program Ekle")
                      aldigi icin (backend zamanlayicisi - bkz.
                      lib/services/databaseBackup.service.ts startScheduler -
                      SADECE settings.schedules dizisindeki her programin
                      KENDI scheduleType/dayOfWeek/timeOfDay alanlarini okur,
                      asagida kaldirilan bu ust-seviye tekil alanlari ASLA
                      okumaz) kullanilmayan/erisilemez hale gelmisti, kaldirildi. */}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xl font-black uppercase text-slate-500">Otomatik Yedekleme Programlari</span>
                      <button
                        type="button"
                        onClick={addDatabaseBackupSchedule}
                        className="rounded-md border border-[#1E2A38] bg-white px-4 py-2 text-xl font-black text-[#1E2A38] hover:bg-slate-100"
                      >
                        Program Ekle
                      </button>
                    </div>

                    {databaseBackupSettings.schedules.map((schedule, index) => (
                      <div key={schedule.id} className="space-y-3 rounded-lg border border-slate-300 bg-white p-3">
                        <div className="flex items-center justify-between gap-3">
                          <label className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={schedule.enabled}
                              onChange={event => updateDatabaseBackupSchedule(schedule.id, { enabled: event.target.checked })}
                              className="h-5 w-5"
                            />
                            <input
                              type="text"
                              value={schedule.name}
                              onChange={event => updateDatabaseBackupSchedule(schedule.id, { name: event.target.value })}
                              placeholder={`Program ${index + 1}`}
                              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-xl font-bold outline-none focus:border-[#1E2A38]"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => removeDatabaseBackupSchedule(schedule.id)}
                            disabled={databaseBackupSettings.schedules.length <= 1}
                            className="rounded-md border border-rose-300 px-3 py-2 text-xl font-black text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                          >
                            Sil
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className="flex flex-col gap-1.5">
                            <span className="text-lg font-black uppercase text-slate-500">Periyot</span>
                            <select
                              value={schedule.scheduleType}
                              onChange={event => updateDatabaseBackupSchedule(schedule.id, {
                                scheduleType: event.target.value as DatabaseBackupScheduleType,
                                dayOfWeek: event.target.value === 'weekly' ? schedule.dayOfWeek ?? 1 : null,
                              })}
                              className="rounded-md border border-slate-300 px-3 py-2 text-xl outline-none focus:border-[#1E2A38]"
                            >
                              <option value="daily">Gunluk</option>
                              <option value="weekly">Haftalik</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-lg font-black uppercase text-slate-500">Gunu</span>
                            <select
                              disabled={schedule.scheduleType === 'daily'}
                              value={schedule.dayOfWeek ?? 1}
                              onChange={event => updateDatabaseBackupSchedule(schedule.id, { dayOfWeek: parseInt(event.target.value) })}
                              className="rounded-md border border-slate-300 px-3 py-2 text-xl outline-none focus:border-[#1E2A38] disabled:bg-slate-100"
                            >
                              {weekdayOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-lg font-black uppercase text-slate-500">Saat</span>
                            <input
                              type="time"
                              value={schedule.timeOfDay}
                              onChange={event => updateDatabaseBackupSchedule(schedule.id, { timeOfDay: event.target.value })}
                              className="rounded-md border border-slate-300 px-3 py-2 text-xl outline-none focus:border-[#1E2A38]"
                            />
                          </label>
                        </div>

                        <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                          <span className="text-lg font-black uppercase text-slate-500">Bu Programda Yedeklenecekler</span>
                          {databaseBackupOptions.map(option => (
                            <label key={`${schedule.id}-${option.name}`} className="flex items-center gap-2 text-xl font-bold text-slate-700">
                              <input
                                type="checkbox"
                                checked={schedule.databaseNames.includes(option.name)}
                                onChange={() => toggleScheduleDatabaseSelection(schedule.id, option.name)}
                                className="h-5 w-5"
                              />
                              <span>{getDatabaseOptionLabel(option.name)}</span>
                            </label>
                          ))}
                        </div>

                        <div className="grid gap-1 text-lg font-bold text-slate-500">
                          <span>Son Calisma: {formatScheduledTaskDate(schedule.lastRunAt)}</span>
                          <span className={schedule.lastStatus === 'success' ? 'text-emerald-700' : schedule.lastStatus === 'error' ? 'text-rose-600' : ''}>
                            Durum: {schedule.lastStatus === 'idle' ? 'Beklemede' : schedule.lastStatus === 'success' ? 'Basarili' : 'Hata'}
                          </span>
                          {schedule.lastMessage && <span>Mesaj: {schedule.lastMessage}</span>}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={saveDatabaseBackupSettings}
                    disabled={isSavingDatabaseBackupSettings}
                    className="w-full rounded-md bg-[#6fb744] px-4 py-3 text-xl font-black text-white shadow-sm hover:bg-[#5aa333] disabled:opacity-50"
                  >
                    {isSavingDatabaseBackupSettings ? 'Kaydediliyor...' : 'Yedekleme Ayarlarını Kaydet'}
                  </button>
                </div>

                <div className="space-y-4 rounded-xl border border-slate-300 bg-white p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">Yedek Dosyaları</p>
                      <p className="mt-1.5 text-xl font-semibold text-slate-500">{databaseBackups.length} yedek listeleniyor.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={selectedRestoreBackup}
                        onChange={event => setSelectedRestoreBackup(event.target.value)}
                        className="min-w-56 rounded-md border border-slate-300 px-3 py-2 text-xl font-bold outline-none focus:border-[#1E2A38]"
                      >
                        <option value="">Yedek seçin</option>
                        {databaseBackups.map(backup => (
                          <option key={backup.fileName} value={backup.fileName}>{backup.fileName}</option>
                        ))}
                      </select>
                      <button
                        onClick={restoreDatabaseBackup}
                        disabled={isRestoringDatabaseBackup || !selectedRestoreBackup}
                        className="rounded-md bg-rose-600 px-5 py-2 text-xl font-black text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
                      >
                        {isRestoringDatabaseBackup ? 'Yükleniyor...' : 'Restore'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto overflow-hidden rounded-lg border border-slate-300">
                    <table className="w-full min-w-[900px] text-left text-xl">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5 font-black uppercase">Dosya</th>
                          <th className="px-3 py-2.5 font-black uppercase">Veritabani</th>
                          <th className="px-3 py-2.5 font-black uppercase">Boyut</th>
                          <th className="px-3 py-2.5 font-black uppercase">Tarih</th>
                          <th className="px-3 py-2.5 font-black uppercase">Klasör</th>
                        </tr>
                      </thead>
                      <tbody>
                        {databaseBackups.map(backup => (
                          <tr key={backup.fileName} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                            <td className="px-3 py-2.5 font-black text-slate-800">{backup.fileName}</td>
                            <td className="px-3 py-2.5 font-bold text-slate-600">{backup.databaseName || '-'}</td>
                            <td className="px-3 py-2.5 font-bold text-slate-600">{formatBackupSize(backup.size)}</td>
                            <td className="px-3 py-2.5 font-bold text-slate-600">{formatScheduledTaskDate(backup.createdAt)}</td>
                            <td className="max-w-72 truncate px-3 py-2.5 font-mono text-lg text-slate-500" title={backup.fullPath}>{backup.fullPath}</td>
                          </tr>
                        ))}
                        {databaseBackups.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-xl font-bold text-slate-400">
                              Henüz yedek dosyası bulunamadı.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xl font-semibold leading-6 text-amber-800">
                    Restore işlemi mevcut veritabanı üzerine uygulanır. İşlem öncesinde güncel bir yedek alınması önerilir.
                  </div>
                </div>
              </div>
            </div>
          )}

          {isFolderPickerOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
              <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">Yedek Klasoru</p>
                    <p className="mt-1.5 break-all font-mono text-xl font-bold text-slate-600">
                      {folderPickerData?.currentPath || databaseBackupSettings.backupDirectory || '-'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsFolderPickerOpen(false)}
                    className="rounded-md border border-slate-300 px-4 py-2 text-xl font-black text-slate-600 hover:bg-slate-50"
                  >
                    Kapat
                  </button>
                </div>

                <div className="space-y-3 overflow-y-auto p-5">
                  {folderPickerStatus && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xl font-bold text-rose-700">
                      {folderPickerStatus}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {folderPickerData?.roots.map(root => (
                      <button
                        key={root.fullPath}
                        type="button"
                        onClick={() => void loadFolderPicker(root.fullPath)}
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xl font-black text-slate-600 hover:bg-slate-50"
                      >
                        {root.name}
                      </button>
                    ))}
                    {folderPickerData?.parentPath && (
                      <button
                        type="button"
                        onClick={() => void loadFolderPicker(folderPickerData.parentPath || undefined)}
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xl font-black text-slate-600 hover:bg-slate-50"
                      >
                        Ust Klasor
                      </button>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    {isLoadingFolderPicker ? (
                      <div className="px-3 py-8 text-center text-xl font-bold text-slate-400">Klasorler yukleniyor...</div>
                    ) : folderPickerData && folderPickerData.directories.length > 0 ? (
                      <div className="divide-y divide-slate-100">
                        {folderPickerData.directories.map(directory => (
                          <button
                            key={directory.fullPath}
                            type="button"
                            onClick={() => void loadFolderPicker(directory.fullPath)}
                            className="block w-full px-3 py-2.5 text-left text-xl font-bold text-slate-700 hover:bg-sky-50"
                          >
                            <span className="block truncate">{directory.name}</span>
                            <span className="block truncate font-mono text-lg text-slate-400">{directory.fullPath}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 py-8 text-center text-xl font-bold text-slate-400">Bu klasorde alt klasor yok.</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="break-all font-mono text-lg font-bold text-slate-500">
                    Secilecek klasor: {folderPickerData?.currentPath || '-'}
                  </p>
                  <button
                    type="button"
                    onClick={selectCurrentBackupFolder}
                    disabled={!folderPickerData?.currentPath}
                    className="rounded-md bg-[#1E2A38] px-5 py-2.5 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D] disabled:opacity-50"
                  >
                    Bu Klasoru Sec
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'personnelPerformance' && (
            <div className="space-y-6">
              <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_18px_45px_rgba(15,30,43,0.10)]">
                <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">Personel Analiz Merkezi</p>
                    <h2 className="mt-1 text-3xl font-black text-slate-900">Personel Performans</h2>
                    <p className="mt-1.5 text-xl font-semibold text-slate-500">Gunluk, haftalik ve aylik islem yogunlugu tek ekranda izlenir.</p>
                  </div>
                  <button
                    onClick={() => {
                      setPersonnelPerformance(null);
                      setPersonnelPerformanceStatus('');
                      setHasLoadedPersonnelPerformance(false);
                    }}
                    disabled={isLoadingPersonnelPerformance}
                    className="rounded-lg border border-[#1E2A38] bg-white px-5 py-3 text-xl font-black text-[#1E2A38] shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoadingPersonnelPerformance ? 'Yukleniyor...' : 'Verileri Yenile'}
                  </button>
                </div>

                <div className="grid gap-3 p-5 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-300 bg-slate-50 p-4">
                    <p className="text-lg font-black uppercase text-slate-400">Veri Kaynagi</p>
                    <p className="mt-1.5 text-xl font-black text-slate-800">Hareket ve audit kayitlari</p>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-slate-50 p-4">
                    <p className="text-lg font-black uppercase text-slate-400">Donem</p>
                    <p className="mt-1.5 text-xl font-black text-slate-800">Bu ay</p>
                  </div>
                  <div className="rounded-xl border border-slate-300 bg-slate-50 p-4">
                    <p className="text-lg font-black uppercase text-slate-400">Durum</p>
                    <p className={`mt-1.5 text-xl font-black ${personnelPerformanceStatus ? 'text-rose-600' : isLoadingPersonnelPerformance ? 'text-[#1E2A38]' : personnelPerformance ? 'text-emerald-700' : 'text-slate-600'}`}>
                      {personnelPerformanceStatus ? 'Hata var' : isLoadingPersonnelPerformance ? 'Veri aliniyor' : personnelPerformance ? 'Hazir' : 'Beklemede'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="hidden">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0076b6]">Personel Performans</h2>
                  <p className="text-xs font-semibold text-slate-500">Kullanıcıların günlük, haftalık ve aylık işlem analizleri</p>
                </div>
                <button
                  onClick={() => {
                    setPersonnelPerformance(null);
                    setPersonnelPerformanceStatus('');
                    setHasLoadedPersonnelPerformance(false);
                  }}
                  disabled={isLoadingPersonnelPerformance}
                  className="rounded-md border border-[#0076b6] px-4 py-2 text-xs font-black text-[#0076b6] hover:bg-sky-50 disabled:opacity-50"
                >
                  Yenile
                </button>
              </div>

              {isLoadingPersonnelPerformance && (
                <div className="rounded-lg border border-slate-300 bg-slate-50 p-6 text-center text-xl font-bold text-slate-500">
                  Performans verileri yükleniyor...
                </div>
              )}

              {personnelPerformanceStatus && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xl font-bold text-rose-700">
                  {personnelPerformanceStatus}
                </div>
              )}

              {personnelPerformance && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: 'Toplam İşlem', value: personnelTotals.total },
                      { label: 'Bugün', value: personnelTotals.daily },
                      { label: 'Bu Hafta', value: personnelTotals.weekly },
                      { label: 'Bu Ay', value: personnelTotals.monthly },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-slate-300 bg-slate-50 p-4">
                        <p className="text-lg font-black uppercase text-slate-500">{item.label}</p>
                        <p className="mt-2 text-3xl font-black text-slate-900">{item.value.toLocaleString('tr-TR')}</p>
                      </div>
                    ))}
                  </div>

                  {personnelPerformance.users.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-xl font-bold text-slate-400">
                      Henüz performans kaydı bulunamadı.
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto overflow-hidden rounded-lg border border-slate-300">
                        <table className="w-full min-w-[700px] text-left text-xl">
                          <thead className="bg-slate-50 text-lg font-black uppercase text-slate-500">
                            <tr>
                              <th className="px-4 py-3">Kullanıcı</th>
                              <th className="px-4 py-3 text-right">Günlük</th>
                              <th className="px-4 py-3 text-right">Haftalık</th>
                              <th className="px-4 py-3 text-right">Aylık</th>
                              <th className="px-4 py-3">Son İşlem</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {personnelPerformance.users.map((user) => (
                              <tr key={user.userName} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-black text-slate-800">{user.userName}</td>
                                <td className="px-4 py-3 text-right font-bold text-slate-700">
                                  <a
                                    href={`/settings/personnel-performance-report?user=${encodeURIComponent(user.userName)}&period=daily`}
                                    className="inline-flex min-w-16 justify-center rounded-full bg-emerald-50 px-3 py-1.5 font-black text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900"
                                    title="Gunluk islem raporunu ac"
                                  >
                                    {user.daily.toLocaleString('tr-TR')}
                                  </a>
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-slate-700">{user.weekly.toLocaleString('tr-TR')}</td>
                                <td className="px-4 py-3 text-right font-bold text-slate-700">{user.monthly.toLocaleString('tr-TR')}</td>
                                <td className="px-4 py-3 text-lg font-semibold text-slate-500">{formatPersonnelDate(user.lastActivity)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {personnelPerformance.users.map((user) => {
                          const categories = getPersonnelBreakdowns(personnelPerformance.categories, user.userName, 4);
                          const operations = getPersonnelBreakdowns(personnelPerformance.operations, user.userName, 4);
                          const fields = getPersonnelBreakdowns(personnelPerformance.fields, user.userName, 4);

                          return (
                            <div key={`${user.userName}-analysis`} className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
                              <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
                                <div>
                                  <h3 className="text-xl font-black text-slate-900">{user.userName}</h3>
                                  <p className="text-lg font-semibold text-slate-500">{user.monthly.toLocaleString('tr-TR')} aylık işlem</p>
                                </div>
                                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-lg font-black text-[#1E2A38]">
                                  {user.monthly.toLocaleString('tr-TR')} / ay
                                </span>
                              </div>

                              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                {[
                                  { title: 'Kategoriler', rows: categories },
                                  { title: 'İşlem Türleri', rows: operations },
                                  { title: 'Alanlar', rows: fields },
                                ].map((section) => (
                                  <div key={section.title} className="space-y-2">
                                    <p className="text-lg font-black uppercase text-slate-500">{section.title}</p>
                                    {section.rows.length > 0 ? (
                                      section.rows.map((row) => (
                                        <div key={`${section.title}-${row.label}`} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                                          <span className="truncate text-lg font-bold text-slate-700">{row.label}</span>
                                          <span className="text-lg font-black text-slate-900">{row.count.toLocaleString('tr-TR')}</span>
                                        </div>
                                      ))
                                    ) : (
                                      <p className="rounded-md bg-slate-50 px-3 py-2 text-lg font-semibold text-slate-400">Kayıt yok</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {personnelPerformance.recent.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-slate-300">
                      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <h3 className="text-xl font-black text-slate-800">Son İşlemler</h3>
                        <span className="text-lg font-black uppercase text-slate-500">{personnelPerformance.recent.length} kayıt</span>
                      </div>
                      <div className="max-h-[360px] overflow-y-auto overflow-x-auto">
                        <table className="w-full min-w-[700px] text-left text-lg">
                          <thead className="sticky top-0 bg-white font-black uppercase text-slate-500 shadow-sm">
                            <tr>
                              <th className="px-4 py-3">Tarih</th>
                              <th className="px-4 py-3">Kullanıcı</th>
                              <th className="px-4 py-3">İşlem</th>
                              <th className="px-4 py-3">Alan</th>
                              <th className="px-4 py-3">Açıklama</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {personnelPerformance.recent.map((activity, index) => (
                              <tr key={`${activity.userName}-${activity.activityDate}-${index}`} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-semibold text-slate-500">{formatPersonnelDate(activity.activityDate)}</td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-lg font-black text-[#1E2A38]">
                                    {activity.userName}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-bold text-[#1E2A38]">{activity.operationType}</td>
                                <td className="px-4 py-3 font-semibold text-slate-600">{activity.tableName}</td>
                                <td className="max-w-[360px] truncate px-4 py-3 font-semibold text-slate-500">{activity.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'neighborhoods' && (
            <div className="space-y-6">
              {neighborhoodListPanel}
            </div>
          )}

          {activeTab === 'authorizedPersonnel' && (
            <div className="space-y-6">
              {authorizedPersonnelPanel}
            </div>
          )}

          {activeTab === 'whatsapp' && (
            <div className="space-y-6">
              {whatsappPanel}
            </div>
          )}

          {activeTab === 'sosyalAsistan' && <SosyalAsistanPanel />}

          {activeTab === 'general' && (
            <div className="space-y-6">
              <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_18px_45px_rgba(15,30,43,0.10)]">
                <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">Genel Sistem Ayarları</p>
                    <h2 className="mt-1 text-3xl font-black text-slate-900">Kurum ve Çıktı Bilgileri</h2>
                    <p className="mt-1.5 text-xl font-semibold text-slate-500">Kurum bilgileri, rapor metinleri ve online başvuru bilgilendirmesi burada yönetilir.</p>
                  </div>
                  <div className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-xl font-bold text-slate-600">
                    Kaydetmek için üstteki <span className="font-black text-[#1E2A38]">Değişiklikleri Kaydet</span> butonunu kullanın.
                  </div>
                </div>

                <div className="grid gap-6 p-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-300 bg-slate-50 p-4">
                      <p className="text-xl font-black uppercase tracking-wide text-slate-500">Kurum logosu</p>
                      <div className="mt-4 flex justify-center">
                        <div className="flex h-36 w-36 items-center justify-center rounded-2xl border border-slate-300 bg-white p-3 shadow-sm">
                          {generalSettings.logoDataUrl ? (
                            <img src={generalSettings.logoDataUrl} alt="Kurum logosu" className="max-h-full max-w-full object-contain" />
                          ) : (
                            <span className="text-xl font-bold text-slate-400">Logo yok</span>
                          )}
                        </div>
                      </div>
                      <label className="mt-4 block">
                        <span className="sr-only">Logo seç</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={event => handleGeneralLogoChange(event.target.files?.[0])}
                          className="block w-full text-xl font-bold text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#1E2A38] file:px-4 file:py-2.5 file:text-xl file:font-black file:text-white hover:file:bg-[#2A3B4D]"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => updateGeneralSetting('logoDataUrl', '/sivas-belediyesi-logo.png')}
                        className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xl font-black text-slate-600 hover:border-[#1E2A38] hover:text-[#1E2A38]"
                      >
                        Varsayılan logoya dön
                      </button>
                      <p className="mt-3 text-lg font-semibold leading-6 text-slate-500">PNG/JPG/SVG görseller kullanılabilir. Büyük dosyalar yerine 2 MB altı logo önerilir.</p>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="text-xl font-black uppercase tracking-wide text-emerald-700">Önizleme</p>
                      <div className="mt-3 rounded-xl border border-emerald-100 bg-white p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white p-1.5">
                            <img src={generalSettings.logoDataUrl || '/sivas-belediyesi-logo.png'} alt="Kurum logosu önizleme" className="h-full w-full object-contain" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xl font-black text-slate-900">{generalSettings.institutionName || 'Kurum adı'}</p>
                            <p className="truncate text-lg font-bold text-emerald-700">{generalSettings.departmentName || 'Müdürlük adı'}</p>
                          </div>
                        </div>
                        {generalContactItems.length > 0 && (
                          <div className="mt-3 grid gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                            {generalContactItems.slice(0, 4).map((item, index) => (
                              <div key={`${item.label}-${index}`} className="min-w-0">
                                <span className="block text-lg font-black uppercase tracking-wide text-emerald-700">{item.label}</span>
                                {item.href ? (
                                  <a
                                    href={item.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block truncate text-lg font-black text-[#005f95] underline-offset-2 hover:underline"
                                    title="Web sitesini yeni sekmede aç"
                                  >
                                    {item.value}
                                  </a>
                                ) : (
                                  <p className="truncate text-lg font-bold text-slate-600" title={item.value}>
                                    {item.value}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                      <div className="mb-4 border-b border-slate-200 pb-3">
                        <h3 className="text-2xl font-black text-slate-900">Kurum Bilgileri</h3>
                        <p className="mt-1.5 text-xl font-semibold text-slate-500">Çıktılar, önizlemeler ve kurum iletişim bilgileri için kullanılır.</p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {[
                          ['institutionName', 'Kurum adı'],
                          ['departmentName', 'Müdürlük adı'],
                          ['phone1', 'Telefon 1'],
                          ['phone2', 'Telefon 2'],
                          ['email', 'E-posta'],
                          ['website', 'Web sitesi'],
                        ].map(([key, label]) => (
                          <label key={key} className="flex flex-col gap-1.5">
                            <span className="text-xl font-black uppercase text-slate-500">{label}</span>
                            <input
                              value={String(generalSettings[key as keyof GeneralSettings] || '')}
                              onChange={event => updateGeneralSetting(key as keyof GeneralSettings, event.target.value)}
                              className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                            />
                          </label>
                        ))}
                        <label className="flex flex-col gap-1.5 md:col-span-2">
                          <span className="text-xl font-black uppercase text-slate-500">Adres</span>
                          <textarea
                            value={generalSettings.address}
                            onChange={event => updateGeneralSetting('address', event.target.value)}
                            rows={3}
                            className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold text-slate-800 outline-none focus:border-[#1E2A38] focus:bg-white"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                      <div className="mb-4 border-b border-slate-200 pb-3">
                        <h3 className="text-2xl font-black text-slate-900">Çıktı ve Rapor Bilgileri</h3>
                        <p className="mt-1.5 text-xl font-semibold text-slate-500">Form tasarımlarında kullanılacak kurum ve açıklama metinleri.</p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xl font-black uppercase text-slate-500">Çıktı kurum adı</span>
                          <input value={generalSettings.printInstitutionName} onChange={event => updateGeneralSetting('printInstitutionName', event.target.value)} className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold outline-none focus:border-[#1E2A38] focus:bg-white" />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xl font-black uppercase text-slate-500">Varsayılan hazırlayan birim</span>
                          <input value={generalSettings.defaultPreparedByUnit} onChange={event => updateGeneralSetting('defaultPreparedByUnit', event.target.value)} className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold outline-none focus:border-[#1E2A38] focus:bg-white" />
                        </label>
                        <label className="flex flex-col gap-1.5 md:col-span-2">
                          <span className="text-xl font-black uppercase text-slate-500">Çıktı alt bilgi metni</span>
                          <textarea value={generalSettings.printFooterText} onChange={event => updateGeneralSetting('printFooterText', event.target.value)} rows={3} className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold outline-none focus:border-[#1E2A38] focus:bg-white" />
                        </label>
                        <label className="flex flex-col gap-1.5 md:col-span-2">
                          <span className="text-xl font-black uppercase text-slate-500">Barkod / QR açıklama metni</span>
                          <textarea value={generalSettings.barcodeInfoText} onChange={event => updateGeneralSetting('barcodeInfoText', event.target.value)} rows={2} className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold outline-none focus:border-[#1E2A38] focus:bg-white" />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                      <div className="mb-4 border-b border-slate-200 pb-3">
                        <h3 className="text-2xl font-black text-slate-900">Online Başvuru Bilgilendirmesi</h3>
                        <p className="mt-1.5 text-xl font-semibold text-slate-500">Başvuru ekranında kullanılabilecek kurum mesajları.</p>
                      </div>
                      <div className="grid gap-4">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xl font-black uppercase text-slate-500">Başvuru bilgilendirme metni</span>
                          <textarea value={generalSettings.onlineApplicationInfoText} onChange={event => updateGeneralSetting('onlineApplicationInfoText', event.target.value)} rows={3} className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold outline-none focus:border-[#1E2A38] focus:bg-white" />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xl font-black uppercase text-slate-500">Başvuru sonrası mesaj</span>
                          <textarea value={generalSettings.onlineApplicationSuccessMessage} onChange={event => updateGeneralSetting('onlineApplicationSuccessMessage', event.target.value)} rows={3} className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold outline-none focus:border-[#1E2A38] focus:bg-white" />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xl font-black uppercase text-slate-500">Çalışma saatleri</span>
                          <input value={generalSettings.workingHours} onChange={event => updateGeneralSetting('workingHours', event.target.value)} className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-semibold outline-none focus:border-[#1E2A38] focus:bg-white" />
                        </label>
                      </div>
                    </div>

                    {generalSettingsStatus && (
                      <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-xl font-bold text-[#1E2A38]">
                        {generalSettingsStatus}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm md:p-8">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-[#0076b6]">İnternet Görünümü</p>
                <h3 className="text-lg font-black text-slate-900">Online Başvuru Sayfası Önizlemesi</h3>
              </div>
              <button onClick={() => setIsPreviewOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-2xl font-black text-slate-400 hover:bg-rose-50 hover:text-rose-500">×</button>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-100 p-5">
              <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="bg-[#003f82] px-6 py-6 text-white">
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white p-1.5 shadow-lg">
                      <img src={generalSettings.logoDataUrl || '/sivas-belediyesi-logo.png'} alt={generalSettings.institutionName || 'Kurum logosu'} className="h-full w-full object-contain" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-white/70">{generalSettings.institutionName || 'Sivas Belediyesi'}</p>
                      <h4 className="text-2xl font-black leading-tight">{generalSettings.departmentName || 'Sosyal Hizmetler Müdürlüğü'}</h4>
                      {generalContactItems.length > 0 && (
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {generalContactItems.map((item, index) => (
                            <div key={`${item.label}-${index}`} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
                              <span className="block text-[10px] font-black uppercase tracking-wide text-white/55">{item.label}</span>
                              {item.href ? (
                                <a
                                  href={item.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-0.5 block text-xs font-black leading-snug text-white underline-offset-2 hover:underline"
                                >
                                  {item.value}
                                </a>
                              ) : (
                                <span className="mt-0.5 block text-xs font-bold leading-snug text-white/90">{item.value}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="border-b border-slate-100 bg-sky-50 px-6 py-5">
                  <p className="text-xs font-black uppercase tracking-wide text-[#0076b6]">Online Başvuru</p>
                  <h4 className="mt-1 text-2xl font-black text-slate-950">{selectedOnlineForm?.title}</h4>
                  <p className="mt-2 text-sm font-semibold text-slate-600">{generalSettings.onlineApplicationInfoText || 'Başvurunuzun değerlendirilebilmesi için bilgilerinizi eksiksiz doldurun.'}</p>
                </div>
                <div className="grid gap-4 p-6 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-black uppercase text-slate-500">T.C. Kimlik No <span className="text-rose-500">*</span></span>
                    <input className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm outline-none focus:border-[#0076b6]" />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-black uppercase text-slate-500">Doğum Tarihi <span className="text-rose-500">*</span></span>
                    <input type="date" className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm outline-none focus:border-[#0076b6]" />
                  </label>
                  {selectedOnlineForm?.fields.filter(field => {
                    const label = field.label.toLocaleLowerCase('tr-TR')
                    return !label.includes('tc') && !label.includes('kimlik') && !label.includes('doğum')
                  }).map(field => (
                    <label key={field.id} className={`flex flex-col gap-1.5 ${field.type === 'textarea' || field.type === 'file' ? 'md:col-span-2' : ''}`}>
                      <span className="text-xs font-black uppercase text-slate-500">{field.label} {field.required && <span className="text-rose-500">*</span>}</span>
                      {field.type === 'textarea' ? (
                        <textarea className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm outline-none focus:border-[#0076b6]" rows={4} />
                      ) : field.type === 'select' ? (
                        <select className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm outline-none focus:border-[#0076b6]">
                          <option value="">Seçiniz</option>
                          {(field.options ?? []).map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      ) : field.type === 'file' ? (
                        <input type="file" className="w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500" />
                      ) : (
                        <input type={field.type === 'number' ? 'number' : 'text'} className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm outline-none focus:border-[#0076b6]" />
                      )}
                    </label>
                  ))}
                  <div className="border-t border-slate-100 pt-5 md:col-span-2">
                    <button className="rounded-lg bg-[#6fb744] px-6 py-3 text-sm font-black text-white shadow-sm hover:bg-[#5aa333]">Başvuruyu Gönder</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {isFormPreviewOpen && selectedFormDesign && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm print:bg-white print:static print:z-auto print:block">
          <div className="w-full max-w-4xl bg-slate-100 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] print:shadow-none print:max-h-none print:bg-white">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-white print:hidden">
              <h3 className="text-lg font-extrabold text-slate-800">Baskı Önizleme - {selectedFormDesign.name}</h3>
              <div className="flex gap-2">
                <button 
                  onClick={() => setTimeout(() => window.print(), 100)}
                  className="rounded bg-[#0076b6] px-6 py-2 text-sm font-extrabold text-white shadow hover:bg-[#005f95]"
                >
                  YAZDIR
                </button>
                <button onClick={() => setIsFormPreviewOpen(false)} className="text-2xl font-black text-slate-400 hover:text-rose-500 px-2">×</button>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto p-8 flex justify-center print:p-0 print:overflow-visible print:bg-white">
              <div className="print-content">
                <FormDesignRenderer design={selectedFormDesign} data={dummyPrintData} preview={true} />
              </div>
            </div>
          </div>
          <style dangerouslySetInnerHTML={{__html: `
            @media print {
              body * { visibility: hidden !important; }
              .print-content, .print-content * { visibility: visible !important; }
              .print-content {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
              }
              .print\\:hidden { display: none !important; }
              @page { margin: 0; }
            }
          `}} />
        </div>
      )}
    </div>
  )
}

export default function SystemSettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm font-semibold text-slate-500">Ayarlar yükleniyor…</div>}>
      <SystemSettingsPageInner />
    </Suspense>
  )
}
