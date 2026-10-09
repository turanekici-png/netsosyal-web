export interface OnlineFormField {
  id: string;
  label: string;
  required: boolean;
  type: 'text' | 'number' | 'select' | 'file' | 'textarea';
  isFixed?: boolean;
  options?: string[];
  showWhen?: {
    fieldId: string;
    value: string;
  };
}

export interface OnlineApplicationCriteria {
  minAgeEnabled: boolean;
  minAge: number;
  uniqueAddressNoEnabled: boolean;
  uniqueIdentityEnabled: boolean;
  maxIncomeEnabled: boolean;
  maxIncome: number;
  maxVehicleModelYearEnabled: boolean;
  maxVehicleModelYear: number;
  maxAgeEnabled: boolean;
  maxAge: number;
  manualInfoCriteria: string[];
}

export interface OnlineApplicationAutoCriteria {
  minAgeEnabled: boolean;
  minAge: number;
  maxIncomeEnabled: boolean;
  maxIncome: number;
  maxVehicleModelYearEnabled: boolean;
  maxVehicleModelYear: number;
  maxAgeEnabled: boolean;
  maxAge: number;
}

export interface OnlineApplicationIntro {
  title: string;
  description: string;
  imageUrl: string;
}

export interface OnlineApplication {
  id: string;
  title: string;
  active: boolean;
  fields: OnlineFormField[];
  criteria?: OnlineApplicationCriteria;
  intro?: OnlineApplicationIntro;
  // Kullanici istegi (2026-09-22): "yayına çıkacağı tarihi ve saati ve
  // yayından kalkacağı tarih ve saati belirleyelim, o tarih ve saat
  // geldiğinde yayına girsin ve zamanı dolunca yayından çıksın" - "FORM
  // YAYINDA" (active) anahtari MANUEL/genel ana anahtar olarak kalmaya
  // devam eder (admin istedigi an kapatabilir); bu iki alan OPSIYONEL bir
  // EK zaman penceresidir - biri veya ikisi de bos birakilabilir. Datetime-
  // local input'lardan gelen, saat dilimi SUFFIX'i OLMAYAN yerel saat
  // string'i olarak saklanir (ör. "2026-10-01T09:00") - bkz.
  // isFormCurrentlyPublished.
  publishStartAt?: string | null;
  publishEndAt?: string | null;
}

// Kullanici istegi (2026-09-22): bir formun "su an GERCEKTEN vatandasa
// gorunur mu" sorusunun TEK dogru cevabi - hem manuel "active" anahtarini
// hem (varsa) zamanlanmis baslangic/bitisi kontrol eder. Cagiran taraflar
// (public hub sayfasi, /online form sayfasi, basvuru API'si, admin
// editorundeki "Simdi" durumu) HEPSI bu fonksiyonu kullanir - boylece
// "yayinda" tanimi HER YERDE birebir tutarlidir (bir yerde unutulup baska
// yerde YANLISLIKLA hala eski/ham "active" kontrol edilmesi riskini ortadan
// kaldirir).
export function isFormCurrentlyPublished(
  form: Pick<OnlineApplication, 'active' | 'publishStartAt' | 'publishEndAt'>,
  now: Date = new Date(),
): boolean {
  if (!form.active) return false;

  if (form.publishStartAt) {
    const start = new Date(form.publishStartAt);
    if (!Number.isNaN(start.getTime()) && now < start) return false;
  }

  if (form.publishEndAt) {
    const end = new Date(form.publishEndAt);
    if (!Number.isNaN(end.getTime()) && now > end) return false;
  }

  return true;
}

export const DEFAULT_ONLINE_APPLICATION_CRITERIA: OnlineApplicationCriteria = {
  minAgeEnabled: false,
  minAge: 18,
  uniqueAddressNoEnabled: false,
  uniqueIdentityEnabled: false,
  maxIncomeEnabled: false,
  maxIncome: 10000,
  maxVehicleModelYearEnabled: false,
  maxVehicleModelYear: 2005,
  maxAgeEnabled: false,
  maxAge: 65,
  manualInfoCriteria: [],
};

export const DEFAULT_ONLINE_APPLICATION_AUTO_CRITERIA: OnlineApplicationAutoCriteria = {
  minAgeEnabled: false,
  minAge: 18,
  maxIncomeEnabled: false,
  maxIncome: 10000,
  maxVehicleModelYearEnabled: false,
  maxVehicleModelYear: 2005,
  maxAgeEnabled: false,
  maxAge: 65,
};

export function normalizeOnlineApplicationCriteria(criteria?: Partial<OnlineApplicationCriteria> | null): OnlineApplicationCriteria {
  return {
    ...DEFAULT_ONLINE_APPLICATION_CRITERIA,
    ...(criteria || {}),
    minAge: Number(criteria?.minAge) > 0 ? Number(criteria?.minAge) : DEFAULT_ONLINE_APPLICATION_CRITERIA.minAge,
    maxIncome: Number(criteria?.maxIncome) > 0 ? Number(criteria?.maxIncome) : DEFAULT_ONLINE_APPLICATION_CRITERIA.maxIncome,
    maxVehicleModelYear: Number(criteria?.maxVehicleModelYear) > 0 ? Number(criteria?.maxVehicleModelYear) : DEFAULT_ONLINE_APPLICATION_CRITERIA.maxVehicleModelYear,
    maxAge: Number(criteria?.maxAge) > 0 ? Number(criteria?.maxAge) : DEFAULT_ONLINE_APPLICATION_CRITERIA.maxAge,
    manualInfoCriteria: Array.isArray(criteria?.manualInfoCriteria)
      ? criteria.manualInfoCriteria.map((item) => String(item ?? ''))
      : [],
  };
}

export function normalizeOnlineApplicationAutoCriteria(criteria?: Partial<OnlineApplicationAutoCriteria> | null): OnlineApplicationAutoCriteria {
  return {
    ...DEFAULT_ONLINE_APPLICATION_AUTO_CRITERIA,
    ...(criteria || {}),
    minAge: Number(criteria?.minAge) > 0 ? Number(criteria?.minAge) : DEFAULT_ONLINE_APPLICATION_AUTO_CRITERIA.minAge,
    maxIncome: Number(criteria?.maxIncome) > 0 ? Number(criteria?.maxIncome) : DEFAULT_ONLINE_APPLICATION_AUTO_CRITERIA.maxIncome,
    maxVehicleModelYear: Number(criteria?.maxVehicleModelYear) > 0 ? Number(criteria?.maxVehicleModelYear) : DEFAULT_ONLINE_APPLICATION_AUTO_CRITERIA.maxVehicleModelYear,
    maxAge: Number(criteria?.maxAge) > 0 ? Number(criteria?.maxAge) : DEFAULT_ONLINE_APPLICATION_AUTO_CRITERIA.maxAge,
  };
}

export function normalizeOnlineApplicationIntro(intro?: Partial<OnlineApplicationIntro> | null): OnlineApplicationIntro {
  return {
    title: intro?.title || '',
    description: intro?.description || '',
    imageUrl: intro?.imageUrl || '',
  };
}

export function normalizeOnlineApplicationForm(form: OnlineApplication): OnlineApplication {
  return {
    ...form,
    criteria: normalizeOnlineApplicationCriteria(form.criteria),
    intro: normalizeOnlineApplicationIntro(form.intro),
  };
}

export const DEFAULT_ONLINE_APPLICATION_FORMS: OnlineApplication[] = [
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
    ],
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
    ],
  },
];

export const ONLINE_APPLICATION_FORMS_SETTING_KEY = 'online_application_forms';
export const ONLINE_APPLICATION_AUTO_CRITERIA_SETTING_KEY = 'online_application_auto_criteria';
