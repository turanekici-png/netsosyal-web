/**
 * Bu bilgisayardaki NextSosyal Print Agent'a (yerel yazdırma servisi) taraycı
 * tarafından erişim icin ortak yardımcılar. Etiket yazdırma ekranlarının
 * (documents/page.tsx, form-designer, aceze) HER BİRİ kendi kopyasını
 * tutuyordu; workstation kurulum butonu icin buraya taşındı ki durum
 * kontrolü/yazıcı önbelleği tek bir yerden yönetilsin.
 */

export const PRINT_AGENT_PORT = 17834
export const PRINT_AGENT_HEALTH_URL = `http://127.0.0.1:${PRINT_AGENT_PORT}/health`
export const PRINT_AGENT_PRINTERS_URL = `http://127.0.0.1:${PRINT_AGENT_PORT}/printers`
export const PRINT_AGENT_CARD_READER_STATUS_URL = `http://127.0.0.1:${PRINT_AGENT_PORT}/card-reader-status`
export const REQUIRED_PRINT_AGENT_VERSION = '2.9.0'

// NOT: Chrome, guvensiz (http://) bir sayfadan .bat gibi calistirilabilir
// dosyalarin DOGRUDAN indirilmesini varsayilan olarak engelliyor ("Guvenli
// olmayan indirme islemi engellendi") - bu uygulama LAN'da http:// uzerinden
// calistigi icin bu bloklanabiliyor. Zip arsivleri bu spesifik engellemeye
// takilmiyor, bu yuzden kurulum paketi olarak .zip kullaniliyor (icinde
// install.bat var - bkz. app/api/print-agent/package/route.ts).
export const PRINT_AGENT_INSTALLER_URL = '/api/print-agent/package'

// documents/page.tsx ve form-designer/aceze ekranlarındaki eski
// 'netsosyal:form-designer:client-printer-names' anahtarıyla KASITLI OLARAK
// AYNI DEĞİL - o sayfalar zaten kendi akışlarında canlı sorguluyor. Bu
// anahtar sadece "Bu Bilgisayarı Ayarla" butonunun son taradığı listeyi
// hatırlaması için.
export const WORKSTATION_PRINTER_CACHE_KEY = 'netsosyal:workstation:client-printer-names'

export type PrintAgentStatus =
  | { state: 'ok'; agentVersion: string; printers: string[]; outdated: boolean }
  | { state: 'unreachable'; error: string }

export async function checkPrintAgentStatus(timeoutMs = 2500): Promise<PrintAgentStatus> {
  if (typeof window === 'undefined') {
    return { state: 'unreachable', error: 'Tarayıcı ortamı yok.' }
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(PRINT_AGENT_PRINTERS_URL, { signal: controller.signal, cache: 'no-store' })
    const payload = await response.json().catch(() => null) as {
      success?: boolean
      agentVersion?: string
      data?: { printers?: string[] }
      error?: string
    } | null

    if (!response.ok || !payload?.success) {
      return { state: 'unreachable', error: payload?.error || 'Yazdırma servisine ulaşılamadı.' }
    }

    const agentVersion = payload.agentVersion || ''
    const printers = Array.isArray(payload.data?.printers)
      ? payload.data!.printers!.filter((value): value is string => typeof value === 'string')
      : []

    return {
      state: 'ok',
      agentVersion,
      printers,
      outdated: agentVersion !== REQUIRED_PRINT_AGENT_VERSION,
    }
  } catch (error) {
    return {
      state: 'unreachable',
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Yazdırma servisi yanıt vermedi (zaman aşımı).'
        : error instanceof Error ? error.message : 'Yazdırma servisine ulaşılamadı.',
    }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

// NFC kart okuyucu ajani (NFC_Kart_Oku.exe) kendi HTTP servisini acmiyor -
// karti PC/SC ile okuyup odaktaki alana klavye gibi yaziyor, taraycıyla hic
// konusmuyor. "Calisiyor mu" bilgisini, zaten acik olan Print Agent'in
// (ayni bilgisayarda calisir) surec listesinden sorup donduren
// /card-reader-status ucundan aliyoruz - bkz. nextsosyal-print-agent.ps1.
export type CardReaderStatus =
  | { state: 'ok'; running: boolean }
  | { state: 'unreachable'; error: string }

export async function checkCardReaderStatus(timeoutMs = 2500): Promise<CardReaderStatus> {
  if (typeof window === 'undefined') {
    return { state: 'unreachable', error: 'Tarayıcı ortamı yok.' }
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(PRINT_AGENT_CARD_READER_STATUS_URL, { signal: controller.signal, cache: 'no-store' })
    const payload = await response.json().catch(() => null) as {
      success?: boolean
      data?: { running?: boolean }
      error?: string
    } | null

    if (!response.ok || !payload?.success) {
      return { state: 'unreachable', error: payload?.error || 'Yazdırma servisine ulaşılamadı.' }
    }

    return { state: 'ok', running: Boolean(payload.data?.running) }
  } catch (error) {
    return {
      state: 'unreachable',
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Yazdırma servisi yanıt vermedi (zaman aşımı).'
        : error instanceof Error ? error.message : 'Yazdırma servisine ulaşılamadı.',
    }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export function readCachedPrinterNames(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(WORKSTATION_PRINTER_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export function writeCachedPrinterNames(printers: string[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(WORKSTATION_PRINTER_CACHE_KEY, JSON.stringify(printers))
  } catch {
    // localStorage dolu/erisilemez olabilir - onbellek en kotu ihtimalle bos kalir
  }
}

export type CameraPermissionResult = {
  granted: boolean
  hasCamera: boolean
  // true: navigator.mediaDevices tarayicida HIC YOK - genelde "guvensiz kaynak"
  // (bu uygulama https/localhost degil, LAN IP'si uzerinden http ile
  // calisiyor) yuzunden tarayicinin kendisi kamera API'sini tamamen
  // kaldirmis oluyor. Eskiden bu bilgisayarlarda PowerShell ile Chrome/Edge
  // kayit defterine "bu adresi guvenli say" politikasi yazilarak asiliyordu
  // - kurulum dosyasi artik bunu otomatik yapiyor (bkz. installer/route.ts).
  blockedByInsecureOrigin?: boolean
  error?: string
}

// documents/page.tsx icindeki birkac ayri "kamerayi baslat" akisi (belge
// fotografi, profil fotografi, eksik evrak tarama), izin ISTEMEDEN once
// mediaDevices/getUserMedia'nin var olup olmadigini KENDI BASINA kontrol
// ediyordu (primeCameraPermission'i KULLANMADAN) ve hepsi AYNI genel
// "Tarayıcı kamera erişimini desteklemiyor." mesajini gosteriyordu - GERCEK
// sebep (neredeyse her zaman: guvensiz kaynak politikasi henuz kurulmamis/
// tarayici tam yeniden baslatilmamis) hic belirtilmiyordu, kullanici ne
// yapmasi gerektigini bilemiyordu. Bu yardimci, primeCameraPermission
// icindeki AYNI ayirt edici mantigi tek bir yerden saglar - o 3-4 yer
// bunu import edip kullanir.
export function getCameraUnavailableMessage(): string {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'Bu bilgisayarda kamera erişimi tarayıcı tarafından engelleniyor (güvenli olmayan adres). "Bu Bilgisayarı Ayarla" ile kurulum dosyasını indirip çalıştırın, sonra Chrome/Edge\'i TAMAMEN kapatıp yeniden açın.'
  }
  return 'Tarayıcı kamera erişimini desteklemiyor.'
}

// Bazi bilgisayarlarda hic kamera takili degil - bu durumda getUserMedia
// tarayiciya gore ya "NotFoundError" ile reddediliyor ya da hicbir donanim
// olmadigi halde izin penceresi acmaya calisip belirsiz bir hata veriyor.
// Once enumerateDevices ile donanim var mi diye BAKIYORUZ (izin istemeden
// de calisir) - kamera hic yoksa kullaniciya net "takili kamera yok" mesaji
// veriyoruz, izin penceresi hic acmiyoruz. Kamera varsa getUserMedia ile
// asil izni istiyoruz ve hata turune gore (izin reddi / mesgul / bulunamadi)
// ayri, anlasilir mesajlar donduruyoruz.
export async function primeCameraPermission(): Promise<CameraPermissionResult> {
  if (typeof navigator === 'undefined') {
    return { granted: false, hasCamera: false, error: 'Tarayıcı ortamı yok.' }
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    const isBlockedByInsecureOrigin = typeof window !== 'undefined' && window.isSecureContext === false
    return {
      granted: false,
      hasCamera: false,
      blockedByInsecureOrigin: isBlockedByInsecureOrigin,
      error: getCameraUnavailableMessage(),
    }
  }

  try {
    if (navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const hasCamera = devices.some((device) => device.kind === 'videoinput')
      if (!hasCamera) {
        return { granted: false, hasCamera: false, error: 'Bu bilgisayarda takılı kamera bulunamadı.' }
      }
    }
  } catch {
    // enumerateDevices basarisiz olabilir - kesin bilgi degil, yine de
    // getUserMedia ile gercek denemeyi yapariz.
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    stream.getTracks().forEach((track) => track.stop())
    return { granted: true, hasCamera: true }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : ''

    if (errorName === 'NotFoundError' || errorName === 'OverconstrainedError') {
      return { granted: false, hasCamera: false, error: 'Bu bilgisayarda takılı kamera bulunamadı.' }
    }
    if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
      return { granted: false, hasCamera: true, error: 'Kamera izni reddedildi. Tarayıcı adres çubuğundaki kamera simgesinden izin verin.' }
    }
    if (errorName === 'NotReadableError') {
      return { granted: false, hasCamera: true, error: 'Kamera başka bir uygulama tarafından kullanılıyor olabilir.' }
    }

    return { granted: false, hasCamera: true, error: error instanceof Error ? error.message : 'Kamera izni verilmedi.' }
  }
}

// Kurulum dosyasi, agent'in yani sira bu uygulamanin adresini Chrome/Edge
// icin "guvenli kaynak" politikasina da ekliyor (kamera erisiminin http://IP
// gibi guvensiz kaynaklarda calismasi icin) - hangi adresi ekleyecegini
// bilmesi gerektiginden mevcut sekme adresini (origin) parametre olarak
// gonderiyoruz. Sunucu tarafi bunu sikica dogruluyor (bkz. installer/route.ts).
export function downloadPrintAgentInstaller() {
  if (typeof window === 'undefined') return
  const origin = window.location.origin
  const url = origin ? `${PRINT_AGENT_INSTALLER_URL}?origin=${encodeURIComponent(origin)}` : PRINT_AGENT_INSTALLER_URL
  window.location.href = url
}
