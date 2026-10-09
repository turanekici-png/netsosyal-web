export const WHATSAPP_SETTINGS_KEY = 'whatsapp_web';

// "wa.me" linki tabanli basit entegrasyon - herhangi bir API anahtari/Meta
// hesabi GEREKMEZ. Buradaki phoneNumber sadece BİLGİLENDİRME/etiket
// amaclidir (ekranda "... numarasi uzerinden" seklinde gosterilir) - mesaj
// GERCEKTE, o an tarayicida/telefonda oturum acik olan HANGI WhatsApp
// hesabi ise onun uzerinden gider (wa.me boyle calisir, GONDEREN'i secmez).
export interface WhatsappSettings {
  phoneNumber: string;
  note?: string;
}

export const defaultWhatsappSettings: WhatsappSettings = {
  phoneNumber: '',
  note: '',
};

// WhatsApp, numaralari ULKE KODU + numara, BASINDA + veya bosluk OLMADAN
// bekler (ör. 905XXXXXXXXX). Turkiye'de yaygin yerel formatlari (05XX...,
// 5XX..., +90..., 0090...) tek bir standarda cevirir - taninmayan/eksik
// bir format gelirse null doner (buton devre disi kalir).
export function normalizeWhatsappPhoneNumber(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  const digitsOnly = rawPhone.replace(/\D/g, '');
  if (!digitsOnly) return null;

  if (digitsOnly.startsWith('0090')) return digitsOnly.slice(2);
  if (digitsOnly.startsWith('90') && digitsOnly.length === 12) return digitsOnly;
  if (digitsOnly.startsWith('0') && digitsOnly.length === 11) return `90${digitsOnly.slice(1)}`;
  if (digitsOnly.length === 10) return `90${digitsOnly}`;
  if (digitsOnly.length >= 10 && digitsOnly.length <= 15) return digitsOnly;

  return null;
}

export function buildWhatsappLink(rawPhone: string | null | undefined, message: string): string | null {
  const normalized = normalizeWhatsappPhoneNumber(rawPhone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
