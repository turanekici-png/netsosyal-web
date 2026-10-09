'use client'

import { useEffect, useState } from 'react'
import { FormDesignRenderer } from '@/components/shared/FormDesignRenderer'

export const dynamic = "force-dynamic"

type TabType = 'nvi' | 'general' | 'integrations' | 'online' | 'formDesign' | 'predefinedValues' | 'scheduledTasks' | 'advanced';

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

interface OnlineFormField {
  id: string;
  label: string;
  required: boolean;
  type: 'text' | 'number' | 'select' | 'file' | 'textarea';
  isFixed?: boolean;
}

interface OnlineApplication {
  id: string;
  title: string;
  active: boolean;
  fields: OnlineFormField[];
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

interface SettingResponse<T> {
  success: boolean;
  data?: {
    value?: T;
  };
  error?: string;
}

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

export default function SystemSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('nvi')
  const [nviCreds, setNviCreds] = useState<NviCredentials>({ 
    user: '', 
    pass: '', 
    useBridge: true,
    bridgeUrl: 'http://localhost:51331/master.asmx', 
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

  // Online Başvuru Durumları
  const [onlineForms, setOnlineForms] = useState<OnlineApplication[]>([
    {
      id: 'app_1',
      title: 'Gıda Yardımı Başvurusu',
      active: true,
      fields: [
        { id: 'f_tc', label: 'T.C. Kimlik No', required: true, type: 'text', isFixed: true },
        { id: 'f_name', label: 'Ad Soyad', required: true, type: 'text', isFixed: true },
        { id: 'f_phone', label: 'Cep Telefonu', required: true, type: 'text' },
        { id: 'f_address', label: 'Açık Adres', required: true, type: 'textarea' },
        { id: 'f_income', label: 'Aylık Hane Geliri', required: false, type: 'number' },
      ]
    },
    {
      id: 'app_2',
      title: 'Kırtasiye (Eğitim) Yardımı Başvurusu',
      active: false,
      fields: [
        { id: 'f_tc', label: 'T.C. Kimlik No', required: true, type: 'text', isFixed: true },
        { id: 'f_name', label: 'Ad Soyad', required: true, type: 'text', isFixed: true },
        { id: 'f_phone', label: 'Cep Telefonu', required: true, type: 'text' },
        { id: 'f_student_cert', label: 'Öğrenci Belgesi (PDF/Görsel)', required: true, type: 'file' },
      ]
    }
  ]);
  const [selectedOnlineFormId, setSelectedOnlineFormId] = useState<string | null>('app_1');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<OnlineFormField['type']>('text');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

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

  const saveActiveSettings = () => {
    if (activeTab === 'predefinedValues') {
      savePredefinedValues();
      return;
    }

    if (activeTab === 'formDesign') {
      saveFormDesigns();
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
    if (!window.confirm('Bu zamanlanmış görevi silmek istiyor musunuz?')) return;

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
        fields: [...f.fields, { id: 'f_' + Date.now(), label: newFieldName, required: false, type: newFieldType }]
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

  return (
    <div className="space-y-5 text-slate-950">
      <div className="rounded-lg border border-[#9bd36f] bg-gradient-to-r from-[#0076b6] to-[#6fb744] p-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[13px] font-black uppercase tracking-wide text-white/90">Yönetim</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">Sistem Ayarları</h1>
          </div>
          <button 
            onClick={saveActiveSettings}
            disabled={isSavingPredefinedValues || isSavingFormDesigns}
            className="rounded-md bg-white px-6 py-2 text-sm font-extrabold text-[#0076b6] shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {isSavingPredefinedValues || isSavingFormDesigns ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-5">
        <aside className="w-full md:w-64 shrink-0 space-y-1">
          {[
            { id: 'nvi', label: 'NVİ Entegrasyonu', icon: '🆔' },
            { id: 'formDesign', label: 'Form ve Etiket Dizaynı', icon: '🎨' },
            { id: 'predefinedValues', label: 'Hazır Değerler', icon: '📝' },
            { id: 'online', label: 'Online Başvuru Formları', icon: '🌐' },
            { id: 'scheduledTasks', label: 'Zamanlanmış Görevler', icon: '⏰' },
            { id: 'general', label: 'Genel Ayarlar', icon: '⚙️' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-bold transition-all ${
                activeTab === tab.id 
                ? 'bg-[#0076b6] text-white shadow-md' 
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </aside>

        <main className="flex-1 bg-white rounded-lg border border-slate-200 shadow-sm p-6 min-h-[600px]">
          {activeTab === 'nvi' && (
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

          {activeTab === 'formDesign' && (
            <div className={`space-y-6 ${isFullscreenDesigner ? 'fixed inset-0 z-[150] bg-white p-6 overflow-auto' : ''}`}>
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-xl font-extrabold text-[#0076b6]">Form ve Etiket Dizaynı</h2>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setIsFullscreenDesigner(!isFullscreenDesigner)}
                    className="rounded-md border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    {isFullscreenDesigner ? '🗗 Küçült' : '⛶ Tam Ekran'}
                  </button>
                  <button 
                    onClick={() => {
                      if (!selectedFormDesignId) {
                         alert("Lütfen bir tasarım seçin.");
                         return;
                      }
                      setIsFormPreviewOpen(true);
                    }}
                    className="rounded-md border border-[#0076b6] px-4 py-1.5 text-xs font-bold text-[#0076b6] hover:bg-sky-50 transition-colors"
                  >
                    🖨️ Önizle ve Yazdır
                  </button>
                  <button 
                    onClick={addNewFormDesign}
                    className="rounded-md bg-[#6fb744] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#5aa333] transition-colors"
                  >
                    + Yeni Tasarım Ekle
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Sol Panel: Tasarım Listesi ve Ayarları */}
                <div className="lg:col-span-1 space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-slate-500">Seçili Tasarım</label>
                    <select 
                      value={selectedFormDesignId || ''} 
                      onChange={e => setSelectedFormDesignId(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0076b6]"
                    >
                      {formDesigns.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>

                  {selectedFormDesign && (
                    <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-black uppercase text-slate-500">Tasarım Adı</span>
                        <input 
                          type="text" 
                          value={selectedFormDesign.name}
                          onChange={e => handleFormDesignChange(selectedFormDesign.id, 'name', e.target.value)}
                          className="rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0076b6]"
                        />
                      </label>
                      
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-black uppercase text-slate-500">Kağıt/Etiket Türü</span>
                        <select 
                          value={selectedFormDesign.type}
                          onChange={e => handleFormDesignChange(selectedFormDesign.id, 'type', e.target.value as any)}
                          className="rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0076b6]"
                        >
                          <option value="label">Etiket (Barkod Yazıcı)</option>
                          <option value="barcode">Küçük Barkod</option>
                          <option value="a4">A4 Standart Kağıt</option>
                        </select>
                      </label>

                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-black uppercase text-slate-500">İlişkili Yardım</span>
                        <select 
                          value={selectedFormDesign.linkedAssistance}
                          onChange={e => handleFormDesignChange(selectedFormDesign.id, 'linkedAssistance', e.target.value)}
                          className="rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0076b6]"
                        >
                          {assistanceTemplateOptions.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </label>

                      {(selectedFormDesign.type === 'label' || selectedFormDesign.type === 'barcode') && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-black uppercase text-slate-500">Genişlik (mm)</span>
                            <input 
                              type="number" 
                              value={selectedFormDesign.width || '80'}
                              onChange={e => handleFormDesignChange(selectedFormDesign.id, 'width', e.target.value)}
                              className="rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0076b6]"
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-black uppercase text-slate-500">Yükseklik (mm)</span>
                            <input 
                              type="number" 
                              value={selectedFormDesign.height || '40'}
                              onChange={e => handleFormDesignChange(selectedFormDesign.id, 'height', e.target.value)}
                              className="rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-[#0076b6]"
                            />
                          </label>
                        </div>
                      )}

                      <button 
                        onClick={() => removeFormDesign(selectedFormDesign.id)}
                        className="w-full rounded-md border border-rose-200 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        Bu Tasarımı Sil
                      </button>
                    </div>
                  )}
                </div>

                {/* Orta Panel: Editör ve Araçlar */}
                <div className="lg:col-span-2 space-y-4">
                   <div className="flex gap-2 p-2 bg-slate-100 rounded-lg border border-slate-200">
                      {['text', 'variable', 'barcode', 'qrcode', 'line'].map(tool => (
                        <div
                          key={tool}
                          draggable
                          onDragStart={() => handleDragStartTool(tool as any)}
                          className="cursor-move rounded bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm border border-slate-200 hover:border-[#0076b6]"
                        >
                          {tool === 'text' && '📝 Metin'}
                          {tool === 'variable' && '📊 Değişken'}
                          {tool === 'barcode' && '🦓 Barkod'}
                          {tool === 'qrcode' && '🔳 QR Kod'}
                          {tool === 'line' && '📏 Çizgi'}
                        </div>
                      ))}
                   </div>

                   <div className="overflow-auto max-h-[700px] border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 p-10 flex justify-center">
                      {selectedFormDesign ? (
                        <div 
                          className="relative shadow-2xl bg-white"
                          style={{
                            width: selectedFormDesign.type === 'a4' ? '794px' : `${parseInt(selectedFormDesign.width || '80') * 3.78}px`,
                            minHeight: selectedFormDesign.type === 'a4' ? '1123px' : `${parseInt(selectedFormDesign.height || '40') * 3.78}px`
                          }}
                        >
                          {selectedFormDesign.bands?.map(band => (
                            <div
                              key={band.id}
                              onDragOver={e => e.preventDefault()}
                              onDrop={e => handleDropOnBand(e, selectedFormDesign, band.id)}
                              className={`relative border-b border-dashed border-slate-300 hover:bg-sky-50/30 transition-colors ${selectedBandId === band.id ? 'bg-sky-50 ring-1 ring-sky-500' : ''}`}
                              style={{ height: `${band.height}px` }}
                              onClick={() => { setSelectedBandId(band.id); setSelectedBlockId(null); }}
                            >
                              <div className="absolute top-0 right-0 px-2 py-0.5 bg-slate-100 text-[10px] font-bold text-slate-400 select-none">
                                {band.name}
                              </div>

                              {selectedFormDesign.blocks?.filter(b => b.bandId === band.id).map(block => (
                                <div
                                  key={block.id}
                                  draggable
                                  onDragStart={e => handleDragStartBlock(e, selectedFormDesign.id, block)}
                                  onClick={e => { e.stopPropagation(); setSelectedBlockId(block.id); setSelectedBandId(null); }}
                                  className={`absolute cursor-move px-1 whitespace-nowrap border ${selectedBlockId === block.id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500' : 'border-transparent hover:border-slate-300'}`}
                                  style={{
                                    left: `${block.x}px`,
                                    top: `${block.y}px`,
                                    fontSize: `${block.fontSize}px`,
                                    fontWeight: block.fontWeight
                                  }}
                                >
                                  {block.type === 'line' ? (
                                    <div className="bg-slate-900 h-[1px]" style={{ width: `${block.value}px` }} />
                                  ) : block.value}
                                </div>
                              ))}
                            </div>
                          ))}
                          
                          {/* Bant Yoksa Direkt Render */}
                          {!selectedFormDesign.bands?.length && (
                            <div 
                              className="relative w-full h-full"
                              onDragOver={e => e.preventDefault()}
                              onDrop={e => handleDropOnBand(e, selectedFormDesign, '')}
                            >
                               {selectedFormDesign.blocks?.map(block => (
                                <div
                                  key={block.id}
                                  draggable
                                  onDragStart={e => handleDragStartBlock(e, selectedFormDesign.id, block)}
                                  onClick={e => { e.stopPropagation(); setSelectedBlockId(block.id); setSelectedBandId(null); }}
                                  className={`absolute cursor-move px-1 whitespace-nowrap border ${selectedBlockId === block.id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500' : 'border-transparent hover:border-slate-300'}`}
                                  style={{
                                    left: `${block.x}px`,
                                    top: `${block.y}px`,
                                    fontSize: `${block.fontSize}px`,
                                    fontWeight: block.fontWeight
                                  }}
                                >
                                  {block.type === 'line' ? (
                                    <div className="bg-slate-900 h-[1px]" style={{ width: `${block.value}px` }} />
                                  ) : block.value}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="py-20 text-slate-400 font-bold">Lütfen bir tasarım seçin veya yeni bir tane oluşturun.</div>
                      )}
                   </div>
                </div>

                {/* Sağ Panel: Alanlar ve Blok Özellikleri */}
                <div className="lg:col-span-1 space-y-4">
                  {selectedBlockId && selectedFormDesign ? (
                    <div className="space-y-4 p-4 bg-sky-50 rounded-lg border border-sky-200">
                      <h3 className="text-xs font-black uppercase text-sky-700">Blok Özellikleri</h3>
                      {(() => {
                        const block = selectedFormDesign.blocks?.find(b => b.id === selectedBlockId);
                        if (!block) return null;
                        return (
                          <>
                            <label className="flex flex-col gap-1.5">
                              <span className="text-[10px] font-black uppercase text-slate-500">Değer / İçerik</span>
                              <input 
                                type="text" 
                                value={block.value}
                                onChange={e => handleBlockUpdate(selectedFormDesign.id, block.id, 'value', e.target.value)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-sky-500"
                              />
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="flex flex-col gap-1.5">
                                <span className="text-[10px] font-black uppercase text-slate-500">Yazı Boyutu</span>
                                <input 
                                  type="number" 
                                  value={block.fontSize}
                                  onChange={e => handleBlockUpdate(selectedFormDesign.id, block.id, 'fontSize', parseInt(e.target.value))}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-sky-500"
                                />
                              </label>
                              <label className="flex flex-col gap-1.5">
                                <span className="text-[10px] font-black uppercase text-slate-500">Kalınlık</span>
                                <select 
                                  value={block.fontWeight}
                                  onChange={e => handleBlockUpdate(selectedFormDesign.id, block.id, 'fontWeight', e.target.value)}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-sky-500"
                                >
                                  <option value="normal">Normal</option>
                                  <option value="bold">Kalın</option>
                                  <option value="black">Ekstra Kalın</option>
                                </select>
                              </label>
                            </div>
                            <button 
                              onClick={() => removeBlock(selectedFormDesign.id, block.id)}
                              className="w-full rounded bg-rose-500 py-1 text-[10px] font-bold text-white hover:bg-rose-600 transition-colors"
                            >
                              Bloğu Sil
                            </button>
                          </>
                        )
                      })()}
                    </div>
                  ) : selectedBandId && selectedFormDesign ? (
                    <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <h3 className="text-xs font-black uppercase text-slate-700">Bant Özellikleri</h3>
                      {(() => {
                        const band = selectedFormDesign.bands?.find(b => b.id === selectedBandId);
                        if (!band) return null;
                        return (
                          <>
                            <label className="flex flex-col gap-1.5">
                              <span className="text-[10px] font-black uppercase text-slate-500">Yükseklik (px)</span>
                              <input 
                                type="number" 
                                value={band.height}
                                onChange={e => updateBand(selectedFormDesign.id, band.id, 'height', parseInt(e.target.value))}
                                className="rounded border border-slate-300 px-2 py-1 text-xs outline-none"
                              />
                            </label>
                            <button 
                              onClick={() => deleteBand(selectedFormDesign.id, band.id)}
                              className="w-full rounded bg-rose-500 py-1 text-[10px] font-bold text-white hover:bg-rose-600 transition-colors"
                            >
                              Bandı Sil
                            </button>
                          </>
                        )
                      })()}
                    </div>
                  ) : (
                    <div className="space-y-4">
                       <h3 className="text-xs font-black uppercase text-slate-500">Veri Alanları</h3>
                       <div className="overflow-y-auto max-h-[600px] space-y-4 pr-2">
                          {reportFieldGroups.map(group => (
                            <div key={group.id} className="space-y-2">
                               <p className="text-[10px] font-black text-[#0076b6] border-b border-[#0076b6]/20">{group.title}</p>
                               <div className="grid grid-cols-1 gap-1">
                                  {group.fields.map(field => (
                                    <div
                                      key={field.token}
                                      draggable
                                      onDragStart={() => handleDragStartField(field)}
                                      onClick={() => selectedFormDesign && addFieldToDesign(selectedFormDesign.id, field)}
                                      className="cursor-pointer rounded bg-white px-2 py-1 text-[10px] font-bold text-slate-600 border border-slate-200 hover:bg-sky-50 hover:border-sky-300 transition-all select-none"
                                    >
                                      {field.label}
                                    </div>
                                  ))}
                               </div>
                            </div>
                          ))}
                       </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'predefinedValues' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-xl font-extrabold text-[#0076b6]">Hazır Değerler Yönetimi</h2>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Yeni Liste Başlığı..."
                    value={newCategoryTitle}
                    onChange={e => setNewCategoryTitle(e.target.value)}
                    className="rounded border border-slate-300 px-3 py-1 text-xs outline-none focus:border-[#0076b6]"
                  />
                  <button 
                    onClick={addNewPredefinedValueList}
                    className="rounded bg-[#6fb744] px-3 py-1 text-xs font-bold text-white hover:bg-[#5aa333] transition-colors"
                  >
                    + Ekle
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.keys(predefinedValueTitles).map(category => (
                  <div key={category} className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50/50">
                    <div className="flex items-center justify-between border-b pb-1 mb-2">
                      <input 
                        type="text" 
                        value={predefinedValueTitles[category]}
                        onChange={e => handlePredefinedTitleChange(category, e.target.value)}
                        className="bg-transparent font-black text-slate-800 outline-none focus:text-[#0076b6] transition-colors"
                      />
                      <button 
                        onClick={() => removePredefinedValueList(category)}
                        className="text-slate-400 hover:text-rose-500 transition-colors"
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
                            className="w-12 rounded border border-slate-300 px-2 py-1 text-xs outline-none"
                          />
                          <input 
                            type="text" 
                            placeholder="Değer"
                            value={val.name}
                            onChange={e => handlePredefinedValueChange(category, idx, 'name', e.target.value)}
                            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-[#0076b6]"
                          />
                          <button 
                            onClick={() => removePredefinedValue(category, idx)}
                            className="text-slate-300 hover:text-rose-500"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    
                    <button 
                      onClick={() => addPredefinedValue(category)}
                      className="w-full rounded border border-dashed border-slate-300 py-1.5 text-[10px] font-bold text-slate-500 hover:bg-white hover:border-[#0076b6] hover:text-[#0076b6] transition-all mt-2"
                    >
                      + Yeni Satır
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'online' && (
             <div className="space-y-6">
                <div className="flex items-center justify-between border-b pb-2">
                  <h2 className="text-xl font-extrabold text-[#0076b6]">Online Başvuru Formları</h2>
                  <button 
                    onClick={addNewOnlineForm}
                    className="rounded bg-[#6fb744] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#5aa333] transition-colors"
                  >
                    + Yeni Form Oluştur
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1 space-y-2">
                     <p className="text-xs font-black uppercase text-slate-500">Mevcut Formlar</p>
                     <div className="space-y-2">
                        {onlineForms.map(form => (
                          <div 
                            key={form.id} 
                            onClick={() => setSelectedOnlineFormId(form.id)}
                            className={`cursor-pointer rounded-lg border p-3 transition-all ${selectedOnlineFormId === form.id ? 'border-[#0076b6] bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                          >
                            <div className="flex items-center justify-between">
                               <span className="text-sm font-bold text-slate-700">{form.title}</span>
                               <span className={`h-2 w-2 rounded-full ${form.active ? 'bg-green-500' : 'bg-slate-300'}`} />
                            </div>
                          </div>
                        ))}
                     </div>
                  </div>

                  <div className="lg:col-span-2 space-y-6">
                     {onlineForms.find(f => f.id === selectedOnlineFormId) ? (
                        <div className="space-y-6">
                           <div className="flex items-center justify-between border-b pb-2">
                              <input 
                                type="text" 
                                value={onlineForms.find(f => f.id === selectedOnlineFormId)?.title}
                                onChange={e => updateOnlineForm(selectedOnlineFormId!, 'title', e.target.value)}
                                className="text-lg font-bold text-slate-800 outline-none focus:text-[#0076b6]"
                              />
                              <label className="flex items-center gap-2 cursor-pointer">
                                 <span className="text-xs font-bold text-slate-500">Aktif</span>
                                 <input 
                                    type="checkbox" 
                                    checked={onlineForms.find(f => f.id === selectedOnlineFormId)?.active}
                                    onChange={e => updateOnlineForm(selectedOnlineFormId!, 'active', e.target.checked)}
                                 />
                              </label>
                           </div>

                           <div className="space-y-4">
                              <p className="text-xs font-black uppercase text-slate-500">Form Alanları</p>
                              {onlineForms.find(f => f.id === selectedOnlineFormId)?.fields.map(field => (
                                <div key={field.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                                   <input 
                                      type="text" 
                                      value={field.label}
                                      disabled={field.isFixed}
                                      onChange={e => updateFieldInForm(selectedOnlineFormId!, field.id, 'label', e.target.value)}
                                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none bg-white disabled:bg-slate-100"
                                   />
                                   <select 
                                      value={field.type}
                                      disabled={field.isFixed}
                                      onChange={e => updateFieldInForm(selectedOnlineFormId!, field.id, 'type', e.target.value as any)}
                                      className="rounded border border-slate-300 px-2 py-1 text-sm outline-none bg-white disabled:bg-slate-100"
                                   >
                                      <option value="text">Kısa Metin</option>
                                      <option value="number">Sayı</option>
                                      <option value="select">Seçenekli</option>
                                      <option value="textarea">Uzun Metin</option>
                                      <option value="file">Dosya Yükleme</option>
                                   </select>
                                   <label className="flex items-center gap-1">
                                      <input 
                                         type="checkbox" 
                                         checked={field.required}
                                         onChange={e => updateFieldInForm(selectedOnlineFormId!, field.id, 'required', e.target.checked)}
                                      />
                                      <span className="text-[10px] font-bold">Zorunlu</span>
                                   </label>
                                   {!field.isFixed && (
                                     <button 
                                        onClick={() => removeFieldFromForm(selectedOnlineFormId!, field.id)}
                                        className="text-slate-400 hover:text-rose-500"
                                     >
                                        🗑️
                                     </button>
                                   )}
                                </div>
                              ))}
                              
                              <div className="flex gap-2 pt-2">
                                 <input 
                                    type="text" 
                                    placeholder="Yeni Alan Adı..."
                                    value={newFieldName}
                                    onChange={e => setNewFieldName(e.target.value)}
                                    className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#0076b6]"
                                 />
                                 <select 
                                    value={newFieldType}
                                    onChange={e => setNewFieldType(e.target.value as any)}
                                    className="rounded border border-slate-300 px-2 py-1.5 text-sm outline-none"
                                 >
                                    <option value="text">Kısa Metin</option>
                                    <option value="number">Sayı</option>
                                    <option value="select">Seçenekli</option>
                                    <option value="textarea">Uzun Metin</option>
                                    <option value="file">Dosya Yükleme</option>
                                 </select>
                                 <button 
                                    onClick={() => addFieldToForm(selectedOnlineFormId!)}
                                    className="rounded bg-[#0076b6] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#005c8f]"
                                 >
                                    Alan Ekle
                                 </button>
                              </div>
                           </div>

                           <div className="flex justify-between pt-4 border-t">
                              <button 
                                onClick={() => removeOnlineForm(selectedOnlineFormId!)}
                                className="text-xs font-bold text-rose-500 hover:underline"
                              >
                                Formu Tamamen Sil
                              </button>
                              <button 
                                onClick={() => setIsPreviewOpen(true)}
                                className="rounded border border-[#0076b6] px-6 py-2 text-sm font-bold text-[#0076b6] hover:bg-sky-50"
                              >
                                Formu Önizle
                              </button>
                           </div>
                        </div>
                     ) : (
                        <div className="py-20 text-center text-slate-400 font-bold">Lütfen düzenlemek için bir form seçin.</div>
                     )}
                  </div>
                </div>
             </div>
          )}

          {activeTab === 'scheduledTasks' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-xl font-extrabold text-[#0076b6]">Zamanlanmış SQL Görevleri</h2>
                <button 
                  onClick={resetScheduledTaskForm}
                  className="rounded bg-[#6fb744] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#5aa333]"
                >
                  + Yeni Görev
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                 {/* Görev Formu */}
                 <div className="space-y-4 p-5 border rounded-xl bg-slate-50/50">
                    <h3 className="font-bold text-slate-800 border-b pb-1">{editingScheduledTaskId ? 'Görevi Düzenle' : 'Yeni Görev Tanımı'}</h3>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-black uppercase text-slate-500">Görev Adı</span>
                      <input 
                        type="text" 
                        value={scheduledTaskForm.name}
                        onChange={e => setScheduledTaskForm({...scheduledTaskForm, name: e.target.value})}
                        className="rounded border border-slate-300 px-3 py-2 text-sm outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-black uppercase text-slate-500">SQL Sorgusu</span>
                      <textarea 
                        rows={6}
                        value={scheduledTaskForm.query}
                        onChange={e => setScheduledTaskForm({...scheduledTaskForm, query: e.target.value})}
                        className="rounded border border-slate-300 px-3 py-2 text-[12px] font-mono outline-none"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-4">
                       <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-black uppercase text-slate-500">Periyot</span>
                          <select 
                            value={scheduledTaskForm.scheduleType}
                            onChange={e => setScheduledTaskForm({...scheduledTaskForm, scheduleType: e.target.value as any})}
                            className="rounded border border-slate-300 px-2 py-2 text-xs outline-none"
                          >
                             <option value="daily">Günlük</option>
                             <option value="weekly">Haftalık</option>
                          </select>
                       </label>
                       <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-black uppercase text-slate-500">Günü</span>
                          <select 
                            disabled={scheduledTaskForm.scheduleType === 'daily'}
                            value={scheduledTaskForm.dayOfWeek}
                            onChange={e => setScheduledTaskForm({...scheduledTaskForm, dayOfWeek: parseInt(e.target.value)})}
                            className="rounded border border-slate-300 px-2 py-2 text-xs outline-none disabled:bg-slate-100"
                          >
                             {weekdayOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                       </label>
                       <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-black uppercase text-slate-500">Saat</span>
                          <input 
                            type="time" 
                            value={scheduledTaskForm.timeOfDay}
                            onChange={e => setScheduledTaskForm({...scheduledTaskForm, timeOfDay: e.target.value})}
                            className="rounded border border-slate-300 px-2 py-2 text-xs outline-none"
                          />
                       </label>
                    </div>
                    <div className="pt-2 flex justify-between">
                       <button 
                         onClick={resetScheduledTaskForm}
                         className="text-xs font-bold text-slate-400 hover:text-slate-600"
                       >
                         İptal
                       </button>
                       <button 
                         onClick={saveScheduledTask}
                         disabled={isSavingScheduledTask}
                         className="rounded bg-[#0076b6] px-8 py-2 text-sm font-bold text-white shadow-md hover:bg-[#005c8f]"
                       >
                         {isSavingScheduledTask ? 'Kaydediliyor...' : 'Kaydet'}
                       </button>
                    </div>
                 </div>

                 {/* Görev Listesi */}
                 <div className="space-y-4">
                    <p className="text-xs font-black uppercase text-slate-500">Tanımlı Görevler ({scheduledTasks.length})</p>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                       {scheduledTasks.map(task => (
                         <div key={task.id} className="p-4 border rounded-xl bg-white shadow-sm hover:border-[#0076b6]/30 transition-all">
                            <div className="flex items-center justify-between mb-2">
                               <h4 className="font-bold text-slate-800">{task.name}</h4>
                               <div className="flex gap-2">
                                  <button onClick={() => runScheduledTaskNow(task.id)} className="text-xs bg-sky-100 text-[#0076b6] px-2 py-1 rounded font-bold hover:bg-sky-200">Çalıştır</button>
                                  <button onClick={() => editScheduledTask(task)} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-bold">Düzenle</button>
                                  <button onClick={() => deleteScheduledTask(task.id)} className="text-xs bg-rose-50 text-rose-500 px-2 py-1 rounded font-bold">Sil</button>
                               </div>
                            </div>
                            <div className="grid grid-cols-2 gap-y-1 text-[11px] font-bold text-slate-500 border-t pt-2">
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

          {activeTab === 'general' && (
            <div className="space-y-6">
              <h2 className="text-xl font-extrabold text-[#0076b6] border-b pb-2">Genel Sistem Ayarları</h2>
              <div className="py-20 text-center text-slate-400 font-bold">Bu bölüm yapım aşamasındadır.</div>
            </div>
          )}
        </main>
      </div>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 md:p-10">
           <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-full">
              <div className="flex items-center justify-between px-6 py-4 border-b bg-slate-50">
                 <h3 className="text-lg font-extrabold text-slate-800">Form Önizleme</h3>
                 <button onClick={() => setIsPreviewOpen(false)} className="text-2xl font-black text-slate-400 hover:text-rose-500">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                 <h4 className="text-2xl font-black text-center text-[#0076b6]">{onlineForms.find(f => f.id === selectedOnlineFormId)?.title}</h4>
                 <div className="space-y-4 max-w-md mx-auto">
                    {onlineForms.find(f => f.id === selectedOnlineFormId)?.fields.map(field => (
                      <div key={field.id} className="space-y-1.5">
                         <label className="text-xs font-black uppercase text-slate-500">{field.label} {field.required && <span className="text-rose-500">*</span>}</label>
                         {field.type === 'textarea' ? (
                           <textarea className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-[#0076b6]" rows={3} />
                         ) : field.type === 'select' ? (
                           <select className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-[#0076b6]">
                              <option value="">Lütfen seçiniz...</option>
                           </select>
                         ) : field.type === 'file' ? (
                           <input type="file" className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-black file:bg-sky-50 file:text-[#0076b6] hover:file:bg-sky-100" />
                         ) : (
                           <input type={field.type} className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-[#0076b6]" />
                         )}
                      </div>
                    ))}
                    <button className="w-full rounded-xl bg-gradient-to-r from-[#0076b6] to-[#6fb744] py-4 text-sm font-black text-white shadow-lg shadow-[#0076b6]/20 mt-4">BAŞVURUYU GÖNDER</button>
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
            
            <div className="flex-1 overflow-auto p-8 flex justify-center print:p-0 print:overflow-visible">
              <div className="print:absolute print:top-0 print:left-0 print:w-full">
                <FormDesignRenderer design={selectedFormDesign} data={dummyPrintData} preview={true} />
              </div>
            </div>
          </div>
          <style dangerouslySetInnerHTML={{__html: `
            @media print {
              body * { visibility: hidden; }
              .print\\:block, .print\\:block * { visibility: visible; }
              .print\\:hidden { display: none !important; }
              @page { margin: 0; }
            }
          `}} />
        </div>
      )}
    </div>
  )
}
