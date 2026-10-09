// Sosyal Yardım Yönetim Sistemi - Merkezi WhatsApp Web servisi
//
// Önceki "wa.me linki aç" yönteminin yerine geçer: artık her kullanıcı kendi
// WhatsApp Web hesabına girmez. Bunun yerine, YETKİLİ bir kullanıcı Ayarlar >
// Sistem Ayarları > WhatsApp Web bölümünden BİR KEZ QR kod okutarak kurumun
// WhatsApp hesabını bu sunucuya bağlar (whatsapp-web.js, arka planda gizli
// bir Chromium/WhatsApp Web oturumu açık tutar). Bu oturum "LocalAuth" ile
// diske kaydedilir (.wwebjs_auth klasörü) - sunucu yeniden başlasa bile
// yeniden QR okutmaya GEREK KALMAZ, oturum otomatik geri yüklenir.
//
// Bağlandıktan sonra TÜM kullanıcıların "WhatsApp'tan Gönder" tıklamaları
// sunucu tarafında bu TEK oturum üzerinden gönderilir (bkz. sendWhatsappMessage) -
// hiçbir kullanıcı kendi telefonunu/WhatsApp Web'ini bağlamak zorunda kalmaz.
//
// NOT: whatsapp-web.js resmi bir WhatsApp/Meta ürünü DEĞİLDİR (WhatsApp Web
// arayüzünü otomatize eden gayri-resmi bir kütüphanedir). Bu, WhatsApp
// Business Cloud API'ye göre kurulumu çok daha basit ve ücretsiz olmasını
// sağlar, ancak WhatsApp'ın resmi desteklediği bir yol olmadığından çok
// yoğun/otomatik kullanımda numara nadiren geçici kısıtlamaya uğrayabilir.

import { existsSync } from 'node:fs'
import type { Client as WhatsappClient } from 'whatsapp-web.js'
import { recordWhatsappMessageAck } from './whatsappLog.service'

// TESPIT EDILEN SORUN: whatsapp-web.js 1.34.7, WhatsApp'in yeni "@lid"
// (Linked ID - telefon numarasi yerine kullanilan, gizlilik amacli kimlik)
// tabanli sohbetlerinde mesaj.id._serialized alanini BOS birakiyor (canli
// loglarda dogrulandi: "id=(yok)" - hem gonderim aninda hem 'message_ack'
// olayinda). Bu, kutuphanenin bu yeni WhatsApp kimlik tipini henuz
// tanimamasindan kaynaklanan bilinen bir uyumluluk acigi - resmi olmayan bu
// kutuphane WhatsApp'in kendi protokol degisikliklerinin gerisinde kalabilir.
// _serialized normalde WhatsApp'in kendi ic formatinda "{fromMe}_{remoteJid}_{msgId}"
// seklindedir - bu fonksiyon, _serialized eksikse bunu ATOM parcalardan
// (id, remote, fromMe - bunlar _serialized'dan FARKLI olarak canli loglarda
// hep dolu geliyor) MANUEL olarak yeniden kurar. Hem gonderim aninda hem
// 'message_ack' olayinda AYNI fonksiyon kullanildigi icin uretilen kimlik
// HER IKI TARAFTA da tutarlidir (eslesir).
function resolveWhatsappMessageKey(rawId: unknown): string | null {
  const id = rawId as {
    _serialized?: string
    id?: string
    fromMe?: boolean
    remote?: string | { _serialized?: string; user?: string; server?: string }
  } | null | undefined
  if (!id) return null
  if (typeof id._serialized === 'string' && id._serialized) return id._serialized

  const remote = typeof id.remote === 'string'
    ? id.remote
    : (id.remote?._serialized
      || (id.remote?.user && id.remote?.server ? `${id.remote.user}@${id.remote.server}` : null))

  if (remote && id.id) {
    return `${id.fromMe ? 'true' : 'false'}_${remote}_${id.id}`
  }
  return null
}

// EK SORUN (canli loglarla dogrulandi): "@lid" sohbetlerinde
// client.sendMessage()'in DOGRUDAN dondurdugu Message nesnesi bazen
// TAMAMEN eksik geliyor (id dahil hicbir alan yok) - whatsapp-web.js'in
// kendi ic gonderim fonksiyonu bu sohbet turunde senkron bir sonuc
// olusturamiyor. Buna karsin, WhatsApp mesaji GERCEKTEN gonderiyor ve
// hemen ardindan 'message_create' olayi (kendi gonderdigimiz mesajlar
// dahil TUM yeni mesajlarda ateslenir) DOGRU VE TAM bir kimlikle geliyor.
// Bu yuzden, sendMessage() donen degerinde kimlik eksikse, ayni alici +
// ayni metne sahip bir sonraki 'message_create' olayi kisa bir sure
// beklenip GERCEK kimlik ondan alinir.
type PendingSendMatcher = { to: string; body: string; resolve: (id: string | undefined) => void }
const pendingSendMatchers: PendingSendMatcher[] = []

function waitForOutgoingMessageId(to: string, body: string, timeoutMs = 6000): Promise<string | undefined> {
  return new Promise((resolve) => {
    const matcher: PendingSendMatcher = { to, body, resolve }
    pendingSendMatchers.push(matcher)
    setTimeout(() => {
      const index = pendingSendMatchers.indexOf(matcher)
      if (index !== -1) pendingSendMatchers.splice(index, 1)
      resolve(undefined)
    }, timeoutMs)
  })
}

export type WhatsappConnectionStatus =
  | 'disconnected'
  | 'initializing'
  | 'qr'
  | 'authenticated'
  | 'ready'
  | 'auth_failure'

interface WhatsappState {
  status: WhatsappConnectionStatus
  qrDataUrl: string | null
  connectedNumber: string | null
  connectedName: string | null
  lastError: string | null
  updatedAt: number
  // QR hic okutulmadan/tamamlanmadan ust uste birkac kez "LOGOUT" ile
  // kopunca (bkz. asagida consecutiveQrOnlyFailures) OTOMATIK yeniden
  // baglanma bir sureligine DURDURULUR - bu alan doluysa arayuz kullaniciya
  // "otomatik deneme bekletiliyor" bilgisini gosterebilir. Kullanicinin
  // KENDI "Bağlan"/"QR Kodu Yenile" tiklamasi bundan ETKILENMEZ.
  reconnectCooldownUntil: number | null
}

interface PuppeteerProcessLike {
  pid: number
  kill: (signal?: string) => boolean
}
interface PuppeteerBrowserLike {
  process: () => PuppeteerProcessLike | null
}

const DATA_PATH = '.wwebjs_auth'
// Yeniden adlandirma (nextsosyal -> netsosyal): mevcut WhatsApp oturumu
// kaybolmasin diye .wwebjs_auth/session-nextsosyal klasoru de session-netsosyal
// olarak yeniden adlandirildi.
const CLIENT_ID = 'netsosyal'

// Next.js "next start" tek bir uzun ömürlü Node process'i olduğu için, bu
// modül seviyesindeki değişkenler process boyunca (tüm istekler arasında)
// kalıcıdır - tam olarak istediğimiz "tek oturum" davranışı budur.
let client: WhatsappClient | null = null

// Sunucu açılışındaki otomatik başlatma ile "Bağlan" butonunun AYNI ANDA
// (ör. sayfa yeni açılıp henüz ilk durum sorgusu gelmeden tıklanması)
// tetiklenmesi, iki ayrı Chromium'un AYNI profil klasörünü (.wwebjs_auth)
// açmaya çalışmasına ve Puppeteer'ın "browser is already running" hatasına
// yol açabiliyordu. Bunu kesin olarak önlemek için TÜM init/logout
// çağrıları tek bir kuyruktan (mutex) sırayla geçirilir - aynı anda en
// fazla bir tane Chromium başlatma/kapatma işlemi çalışabilir.
let operationQueue: Promise<void> = Promise.resolve()

function enqueue(operation: () => Promise<void>): Promise<void> {
  const run = operationQueue.then(operation, operation)
  operationQueue = run.catch(() => { /* zincirin kopmaması için yut, hata caller'a run üzerinden ulaşır */ })
  return run
}

// whatsapp-web.js bazen (WhatsApp Web'in kendi arayüzünde beklenmedik bir
// yeniden yükleme/"detached frame" durumu yüzünden) 'authenticated'
// olduktan sonra 'ready' olayını HİÇ ateşlemeden askıda kalabiliyor - bu,
// kütüphanenin kendi bilinen bir kısıtı (bkz. GitHub issue'ları). Bu bekçi,
// bağlantı 'initializing'/'authenticated' durumunda çok uzun süre takılı
// kalırsa (QR bekleme HARİÇ - kullanıcı QR'ı okutana kadar süre saymaz),
// kayıtlı oturumu kullanarak OTOMATİK olarak yeniden bağlanmayı dener -
// yeniden QR okutmaya gerek kalmaz.
const STUCK_TIMEOUT_MS = 75_000
const WATCHDOG_INTERVAL_MS = 15_000
let watchdogStarted = false

function ensureWatchdogStarted() {
  if (watchdogStarted) return
  watchdogStarted = true
  setInterval(() => {
    const stuckStatuses: WhatsappConnectionStatus[] = ['initializing', 'authenticated']
    if (stuckStatuses.includes(state.status) && Date.now() - state.updatedAt > STUCK_TIMEOUT_MS) {
      setState({ lastError: 'Bağlantı uzun süre takılı kaldı, otomatik olarak yeniden deneniyor...' })
      void initWhatsappClient(true).catch(() => { /* durum state icinde tutulur */ })
    }
  }, WATCHDOG_INTERVAL_MS)
}

// Kullanıcı isteği: "WhatsApp Web bağlantısının kopmasını istemiyorum -
// kesilirse kullanıcı Ayarlar sayfasında 'Bağlan' butonuna basmak zorunda
// KALMASIN, sistem bunu KENDİSİ yapsın." Ayarlar sayfasındaki "Bağlan"
// butonu da (bkz. app/api/whatsapp/connect/route.ts) aslında AYNI
// initWhatsappClient() fonksiyonunu çağırıyor - yani bu bekçi, o butona
// kullanıcı yerine biz basıyormuşuz gibi davranır. Önceki sürüm 10
// dakikada bir kontrol ediyordu; kullanıcı geri bildirimi üzerine ("bazen
// kesilebiliyor, o an fark edilmesi lazım") ARALIK KISALTILDI - artık
// dakikada bir kontrol edilir, kopukluk pratikte neredeyse anında (en geç
// 1 dakika içinde) kendiliğinden giderilir.
const CONNECTION_HEALTH_CHECK_INTERVAL_MS = 60 * 1000
let connectionHealthCheckStarted = false
// client.getState() TEK seferlik, gecici bir "OPENING" gibi ara durum
// yakalayip YANLIŞ ALARM vermesin diye - GERÇEKTEN sorunlu sayilmasi icin
// ARKA ARKAYA 2 kontrolde de (yaklasik 1 dakika boyunca) sağlıksız çıkması
// gerekir. 'disconnected'/'auth_failure' gibi ACIK sinyaller icin bu
// bekleme UYGULANMAZ - onlar zaten kesin, hemen tepki verilir.
let consecutiveUnhealthyChecks = 0

// TESPIT EDILEN SORUN (canlida gozlemlendi): QR hic okutulmadan/kimlik
// dogrulanmadan ("authenticated" olayi hic ateslenmeden) art arda "LOGOUT"
// sebebiyle kopmalar yasaniyor - WhatsApp'in kendisi, uzun sure okutulmayan
// bir eslesme oturumunu belirli bir sure sonra kendiliginden sonlandiriyor.
// Bizim otomatik yeniden baglanma bekcimiz (asagida) bunu HEMEN (1 dakika
// icinde) tekrar dener - bu da saatlerce surebilen, kesintisiz bir
// QR-uret -> LOGOUT -> tekrar-QR-uret dongusune yol aciyor. Boyle bir dongu,
// WhatsApp'in kendi suistimal-onleme sistemini tetikleyip numarayi GECICI
// olarak yeni cihaz eslestirmeye kapatabilir (kullanicinin telefonunda
// gordugu "daha sonra tekrar deneyin" mesaji tam olarak buna isaret eder).
// Bu yuzden: kimlik dogrulanmadan ust uste birkac kez boyle bir kopma
// yasanirsa, OTOMATIK yeniden baglanma bir sureligine DURDURULUR - sistem
// numarayi daha fazla yormaz. Kullanicinin KENDI elle "Bağlan"/"QR Kodu
// Yenile" tiklamasi (bkz. app/api/whatsapp/connect/route.ts) bu cooldown'dan
// ETKILENMEZ, istedigi an elle deneyebilir.
let authenticatedSinceLastInit = false
let consecutiveQrOnlyFailures = 0
// whatsapp-web.js eslesme yapilana kadar 'qr' olayini ~20 sn'de bir tekrar
// ateslıyor - her seferinde loglamak server-out.log'u sisiriyordu. Ayni QR
// turu icin en fazla 2 dakikada bir log basariz (durum/QR gorseli yine her
// olayda guncellenir).
let lastQrLogAt = 0
const QR_LOG_THROTTLE_MS = 2 * 60 * 1000
const QR_ONLY_FAILURE_THRESHOLD = 3
const RECONNECT_COOLDOWN_MS = 20 * 60 * 1000

// ÖNEMLİ: WhatsApp Web bazen kendi 'disconnected' olayını hiç ateşlemeden
// sessizce kopabiliyor (Chromium sayfası "zombi" kalabiliyor - dışarıdan
// hâlâ çalışıyor görünür ama içeride mesaj alışverişi durmuştur). Bu yüzden
// sadece state.status'a bakmak YETERLİ DEĞİL - "ready" görünse bile
// client.getState() ile GERÇEKTEN bağlı mı diye aktif olarak sorgulanır.
async function checkAndRecoverConnection(): Promise<void> {
  const droppedStatuses: WhatsappConnectionStatus[] = ['disconnected', 'auth_failure']

  if (droppedStatuses.includes(state.status)) {
    consecutiveUnhealthyChecks = 0

    if (state.reconnectCooldownUntil && Date.now() < state.reconnectCooldownUntil) {
      const remainingMin = Math.ceil((state.reconnectCooldownUntil - Date.now()) / 60000)
      console.log(`[WhatsApp] Otomatik yeniden bağlanma bekletiliyor (olası WhatsApp hız sınırı) - yaklaşık ${remainingMin} dakika sonra tekrar denenecek. Elle "Bağlan"/"QR Kodu Yenile" butonu her zaman çalışır.`)
      return
    }

    console.log(`[WhatsApp] Bağlantı kopuk (durum: ${state.status}) - "Bağlan" butonuna basılmış gibi otomatik yeniden bağlanılıyor...`)
    await initWhatsappClient().catch((error) => {
      console.error('[WhatsApp] Otomatik yeniden bağlanma denemesi başarısız oldu:', error)
    })
    return
  }

  if (state.status === 'ready' && client) {
    let isHealthy = true
    try {
      const liveState = await withTimeout(client.getState(), 15000)
      isHealthy = liveState === 'CONNECTED'
      if (!isHealthy) {
        console.log(`[WhatsApp] Bağlantı sağlıksız görünüyor (canlı durum: ${liveState}, ardışık ${consecutiveUnhealthyChecks + 1}. kontrol).`)
      }
    } catch (error) {
      // Kullanici istegi: baglanti "kopuyormus" gibi gorunen tekrar tekrar
      // zorla yeniden baglanma dongusu ISTENMIYOR - kok neden arastirildi:
      // client.getState() bazen ("detached Frame"/"execution context was
      // destroyed" - bkz. isDetachedFrameError) WhatsApp Web'in kendi ic
      // sayfa gecisi/yenilemesi SIRASINDA anlik olarak basarisiz oluyor,
      // ama bu COGUNLUKLA kalici bir kopma DEGIL - birkaç saniye icinde
      // KENDILIGINDEN duzeliyor (sayfa gecisi tamamlanip yeni frame
      // baglaninca). Onceden BU TEK anlik hata bile dogrudan "sağlıksız"
      // sayilip (2 ardisik kontrolden sonra) TUM Chromium'u oldurup yeniden
      // baslatan pahali/yavas bir "zorla yeniden baglanma" tetikliyordu -
      // gercekte baglanti birkaç saniye sonra kendisi duzelecekken. Artik
      // SADECE bu bilinen/gecici hata turunde, sagliksiz sayilmadan once
      // AYNI kontrol icinde kisa bir bekleme sonrasi BIR KEZ daha denenir -
      // eger bu ikinci deneme basarili olursa (frame kendini toparladiysa)
      // hicbir sey yapilmaz, "kopma" olarak bile loglanmaz. Gercekten kalici
      // bir sorun varsa (frame bir turlu toparlanmiyorsa) asagidaki mevcut
      // "2 ardisik kontrol" guvenlik agi zaten devreye girmeye devam eder.
      if (isDetachedFrameError(error)) {
        await delay(3000)
        try {
          const retryState = await withTimeout(client.getState(), 15000)
          isHealthy = retryState === 'CONNECTED'
        } catch {
          isHealthy = false
        }
      } else {
        isHealthy = false
      }

      if (!isHealthy) {
        console.log(`[WhatsApp] Bağlantı durumu sorgulanamadı (${error instanceof Error ? error.message : error}), sağlıksız sayılıyor (ardışık ${consecutiveUnhealthyChecks + 1}. kontrol).`)
      }
    }

    if (isHealthy) {
      consecutiveUnhealthyChecks = 0
      return
    }

    consecutiveUnhealthyChecks += 1
    if (consecutiveUnhealthyChecks < 2) return // tek seferlik gecici bir titremeye asiri tepki vermemek icin bir kontrol daha bekle

    consecutiveUnhealthyChecks = 0
    console.log('[WhatsApp] Bağlantı 2 ardışık kontrolde de sağlıksız çıktı - "Bağlan" butonuna basılmış gibi zorla yeniden bağlanılıyor...')
    await initWhatsappClient(true).catch((error) => {
      console.error('[WhatsApp] Zorla yeniden bağlanma denemesi başarısız oldu:', error)
    })
  } else {
    consecutiveUnhealthyChecks = 0
  }
}

function ensureConnectionHealthCheckStarted() {
  if (connectionHealthCheckStarted) return
  connectionHealthCheckStarted = true
  setInterval(() => {
    void checkAndRecoverConnection()
  }, CONNECTION_HEALTH_CHECK_INTERVAL_MS)
}

let state: WhatsappState = {
  status: 'disconnected',
  qrDataUrl: null,
  connectedNumber: null,
  connectedName: null,
  lastError: null,
  updatedAt: Date.now(),
  reconnectCooldownUntil: null,
}

function setState(partial: Partial<WhatsappState>) {
  state = { ...state, ...partial, updatedAt: Date.now() }
}

export function getWhatsappState(): WhatsappState {
  return state
}

export function isWhatsappReady(): boolean {
  return state.status === 'ready' && client !== null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

// Bir Chrome PID'sini TÜM ALT SÜREÇLERİYLE (renderer, GPU, crashpad-handler,
// network service vb.) birlikte sonlandırır. ÖNEMLİ: Windows'ta bir üst
// süreci normal kill() ile öldürmek alt süreçlerini OTOMATİK sonlandırmaz -
// bu yüzden basit process.kill() bazı Chrome alt süreçlerini "yetim" olarak
// canlı bırakabiliyor ve onlar profil klasörünün kilidini tutmaya devam
// edebiliyor. "taskkill /T" tüm süreç ağacını kesin olarak sonlandırır.
async function killProcessTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    try { process.kill(pid, 'SIGKILL') } catch { /* yoksay */ }
    return
  }
  const { execFile } = await import('child_process')
  await new Promise<void>((resolve) => {
    execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => resolve())
  })
}

// destroy() bazen alttaki gerçek chrome.exe sürecini (ve alt süreçlerini)
// tam kapatmayabiliyor - profil klasörünün kilidi bu yüzden hala tutuluyor
// olabilir. Önce nazikçe destroy() denenir, olmazsa alttaki tarayıcı süreç
// AĞACI elle sonlandırılır.
async function destroyClientInstance(instance: WhatsappClient): Promise<void> {
  const pupBrowser = (instance as unknown as { pupBrowser?: PuppeteerBrowserLike }).pupBrowser

  try {
    await withTimeout(instance.destroy(), 8000)
  } catch {
    // yoksay, aşağıda süreç elle sonlandırılmaya çalışılır
  }

  try {
    const proc = pupBrowser?.process()
    if (proc?.pid) await killProcessTree(proc.pid)
  } catch {
    // yoksay
  }

  // Windows'ta süreç sonlandırma ile dosya tanıtıcılarının (file handle)
  // gerçekten serbest kalması arasında kısa bir gecikme olabiliyor.
  await delay(800)
}

// Profil klasörüne (bu WhatsApp oturumuna) ait, elimizde JS referansı OLMAYAN
// (ör. sunucu bir önceki çalışmada normal kapatma yapılmadan - "Stop-Process"
// vb. ile - sonlandırıldığında geride kalmış) YETİM chrome.exe süreçlerini
// komut satırlarına bakarak bulur ve sonlandırır. Ardından "lockfile"ı
// (Windows'ta Puppeteer'ın kilit kontrolü bu dosyanın VARLIĞINA bakar, bkz.
// puppeteer-core BrowserLauncher.js) ve taşınabilirlik için Linux/Mac'te
// kullanılan Singleton* dosyalarını temizler.
async function clearStaleProfileLock(): Promise<void> {
  const path = await import('path')
  const fs = await import('fs/promises')
  const profileDir = path.join(process.cwd(), DATA_PATH, `session-${CLIENT_ID}`)

  if (process.platform === 'win32') {
    try {
      const { execFile } = await import('child_process')
      const escaped = profileDir.replace(/'/g, "''")
      const script = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      await new Promise<void>((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000 }, () => resolve())
      })
      await delay(500)
    } catch {
      // yoksay - en kötü ihtimalle asagidaki dosya temizligi tek basina yardimci olur
    }
  }

  const lockNames = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']
  await Promise.all(lockNames.map(async (name) => {
    try { await fs.rm(path.join(profileDir, name), { force: true }) } catch { /* yoksay */ }
  }))
}

// whatsapp-web.js/puppeteer-core kendi indirdigi bir Chromium'u
// (~/.cache/puppeteer) arar; bu makinede indirilmemis - sonuc: "Could not
// find Chrome (ver. ...)" hatasi ve sonsuz yeniden-baglanma dongusu.
// Cozum: sistemde KURULU Chrome/Edge'i kullan. Once ortam degiskeni,
// sonra bilinen Windows kurulum yollari, hicbiri yoksa undefined (puppeteer
// kendi mantigina duser).
// turbopackIgnore: bu yollar ortam degiskeninden/dinamik olarak geliyor -
// Turbopack build sirasinda bunu statik analizle takip edip TUM PROJEYI
// izlemeye calisip build suresini ciddi sekilde uzatiyordu (bkz.
// pdfCompression.service.ts'teki AYNI notun bire bir esdegeri). Bu, salt
// build-zamani izleme davranisini kapatir - calisma zamaninda (WhatsApp
// Chromium'u baslatilirken) islev AYNEN devam eder.
function resolveBrowserExecutable(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || process.env.WHATSAPP_CHROME_PATH
  if (fromEnv && existsSync(/* turbopackIgnore: true */ fromEnv)) return fromEnv

  if (process.platform === 'win32') {
    const candidates = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
    for (const candidate of candidates) {
      if (candidate && existsSync(/* turbopackIgnore: true */ candidate)) return candidate
    }
  }
  return undefined
}

async function createAndInitialize(): Promise<void> {
  authenticatedSinceLastInit = false
  lastQrLogAt = 0 // yeni deneme: ilk QR olayini hemen logla

  // NOT: 'whatsapp-web.js' paketinin ana index.js'i (barrel export) RemoteAuth
  // stratejisini de içerir, o da 'unzipper' -> '@aws-sdk/client-s3' zincirini
  // sürükler (biz kullanmıyoruz, sadece LocalAuth kullanıyoruz) ve bu, Next.js
  // build sırasında "Module not found: @aws-sdk/client-s3" hatasına yol açar.
  // Bunu önlemek için sadece ihtiyaç duyulan iki alt-modül doğrudan import edilir.
  type ClientConstructor = new (options: { authStrategy: unknown; puppeteer: Record<string, unknown> }) => WhatsappClient
  type LocalAuthConstructor = new (options: { clientId: string; dataPath: string }) => unknown

  const Client = (await import('whatsapp-web.js/src/Client.js')).default as unknown as ClientConstructor
  const LocalAuth = (await import('whatsapp-web.js/src/authStrategies/LocalAuth.js')).default as unknown as LocalAuthConstructor
  const QRCode = (await import('qrcode')).default

  const instance = new Client({
    authStrategy: new LocalAuth({ clientId: CLIENT_ID, dataPath: DATA_PATH }),
    puppeteer: {
      headless: true,
      // Sistemde kurulu Chrome/Edge kullanilir (indirilmis Chromium yoksa
      // "Could not find Chrome" hatasi + sonsuz yeniden-baglanma dongusu).
      executablePath: resolveBrowserExecutable(),
      // '--disable-features=IsolateOrigins,site-per-process' ve
      // '--disable-site-isolation-trials': WhatsApp Web, kimlik doğrulama
      // sonrası ("authenticated" -> "ready" arası) sayfayı iç yönlendirme /
      // yeniden yükleme ile geçiş yaptırıyor. Chrome'un "site isolation"
      // özelliği bu geçişte YENİ bir render süreci başlatabiliyor ve bu da
      // whatsapp-web.js'in elindeki eski frame referansını "detached" bırakıp
      // istemcinin 'ready' olayını hiç ateşlemeden askıda kalmasına yol
      // açıyordu (canlıda gözlemlenen "Attempted to use detached Frame"
      // hatası - bkz. GitHub issue #5678/#5728/#5758). Bu bayraklar site
      // isolation'ı kapatarak frame'in aynı süreçte/kalıcı kalmasını sağlar.
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
      ],
    },
  })

  instance.on('qr', (qr) => {
    const nowMs = Date.now()
    if (nowMs - lastQrLogAt >= QR_LOG_THROTTLE_MS) {
      lastQrLogAt = nowMs
      console.log('[WhatsApp] QR kod üretildi - Ayarlar > Sistem Ayarları > WhatsApp Web bölümünden okutulması bekleniyor.')
    }
    QRCode.toDataURL(qr)
      .then((qrDataUrl) => setState({ status: 'qr', qrDataUrl, connectedNumber: null, connectedName: null, lastError: null }))
      .catch(() => setState({ status: 'qr', qrDataUrl: null, lastError: 'QR kod görseli oluşturulamadı.' }))
  })

  instance.on('authenticated', () => {
    console.log('[WhatsApp] Kimlik doğrulandı, bağlantı tamamlanıyor...')
    authenticatedSinceLastInit = true
    consecutiveQrOnlyFailures = 0
    setState({ status: 'authenticated', qrDataUrl: null, lastError: null, reconnectCooldownUntil: null })
  })

  instance.on('ready', () => {
    const info = instance.info
    console.log(`[WhatsApp] Bağlantı hazır (numara: ${info?.wid?.user || '?'}).`)
    setState({
      status: 'ready',
      qrDataUrl: null,
      connectedNumber: info?.wid?.user || null,
      connectedName: info?.pushname || null,
      lastError: null,
      reconnectCooldownUntil: null,
    })
  })

  // Kendi gonderdigimiz mesajlar dahil (fromMe) TUM yeni mesajlarda ateslenir.
  // sendMessage()'in dogrudan donen degerinde kimlik eksik kaldiginda
  // (bkz. yukaridaki "EK SORUN" notu, @lid sohbetleri) GERCEK kimligi
  // buradan yakalayip bekleyen gonderim isteklerine (waitForOutgoingMessageId)
  // iletir.
  instance.on('message_create', (message) => {
    if (!message.fromMe || pendingSendMatchers.length === 0) return
    const to = message.to
    const body = message.body
    const matcherIndex = pendingSendMatchers.findIndex((matcher) => matcher.to === to && matcher.body === body)
    if (matcherIndex === -1) return
    const [matcher] = pendingSendMatchers.splice(matcherIndex, 1)
    matcher.resolve(resolveWhatsappMessageKey(message.id) || undefined)
  })

  // Gonderilen bir mesajin durumu (sunucuya ulasti / cihaza teslim edildi /
  // OKUNDU) degistikce WhatsApp bu olayi ateşler - kullanicinin "mesaj
  // gorulmus mu bilelim" istegi buradan karsilanir. sms_gonderim_log'daki
  // ilgili satir, mesaj gonderilirken kaydedilen wa_message_id uzerinden
  // bulunup guncellenir (bkz. whatsappLog.service.ts).
  instance.on('message_ack', (message, ack) => {
    const messageId = resolveWhatsappMessageKey(message?.id)
    console.log(`[WhatsApp] message_ack alındı - id=${messageId || '(yok)'} ack=${ack} ham_id=${JSON.stringify(message?.id)}`)
    if (messageId) {
      void recordWhatsappMessageAck(messageId, ack as unknown as number).catch((error) => {
        console.error('[WhatsApp] message_ack işlenirken hata:', error)
      })
    }
  })

  instance.on('auth_failure', (message) => {
    console.error(`[WhatsApp] Kimlik doğrulama başarısız: ${message}`)
    setState({ status: 'auth_failure', qrDataUrl: null, lastError: String(message || 'Kimlik doğrulama başarısız.') })
    client = null
  })

  instance.on('disconnected', (reason) => {
    let cooldownUntil: number | null = null

    if (!authenticatedSinceLastInit) {
      // Kimlik dogrulanmadan (QR hic basariyla okutulup tamamlanmadan) kopan
      // bir baglanti - bkz. QR_ONLY_FAILURE_THRESHOLD yorumu yukarida.
      consecutiveQrOnlyFailures += 1
      if (consecutiveQrOnlyFailures >= QR_ONLY_FAILURE_THRESHOLD) {
        cooldownUntil = Date.now() + RECONNECT_COOLDOWN_MS
        console.log(`[WhatsApp] QR ust uste ${consecutiveQrOnlyFailures} kez kimlik dogrulanmadan koptu - olasi WhatsApp hiz siniri. Otomatik yeniden baglanma ${RECONNECT_COOLDOWN_MS / 60000} dakika durduruluyor (elle "Bağlan"/"QR Kodu Yenile" her zaman calisir).`)
      }
    } else {
      consecutiveQrOnlyFailures = 0
    }

    // Kullanici istegi: baglanti koparsa "hemen" (elle mudahaleye gerek
    // kalmadan) yeniden baglanilsin - ONCEDEN bu olay sadece durumu
    // isaretliyordu, GERCEK yeniden baglanma denemesi ancak bir sonraki
    // periyodik saglik kontrolune (asagida, en fazla 60 saniyede bir
    // calisan checkAndRecoverConnection) kadar BEKLIYORDU. whatsapp-web.js
    // BU olayi (aksine getState()'in aksine) GENELLIKLE GUVENILIR sekilde,
    // GERCEKTEN koptugu an ateşliyor - bu yuzden burada BEKLEMEDEN,
    // DOGRUDAN yeniden baglanma kuyruga alinir; periyodik kontrol ise
    // (herhangi bir olay ateslenmeden "sessizce" kopan/zombi kalan durumlar
    // icin) bir GUVENLIK AGI olarak calismaya devam eder.
    const willRetryImmediately = cooldownUntil === null
    console.log(`[WhatsApp] Bağlantı koptu (sebep: ${reason}) - ${willRetryImmediately ? 'hemen otomatik olarak yeniden bağlanılıyor...' : `${RECONNECT_COOLDOWN_MS / 60000} dakika bekletiliyor (olası hız sınırı).`}`)
    setState({
      status: 'disconnected',
      qrDataUrl: null,
      connectedNumber: null,
      connectedName: null,
      lastError: String(reason || ''),
      ...(cooldownUntil !== null ? { reconnectCooldownUntil: cooldownUntil } : {}),
    })
    client = null

    if (willRetryImmediately) {
      void initWhatsappClient().catch((error) => {
        console.error('[WhatsApp] Kopma sonrası anında yeniden bağlanma denemesi başarısız oldu:', error)
      })
    }
  })

  client = instance
  setState({ status: 'initializing', qrDataUrl: null, lastError: null })
  await instance.initialize()
}

async function performInit(force: boolean): Promise<void> {
  if (client && !force) return

  if (client) {
    await destroyClientInstance(client)
    client = null
  }

  try {
    await createAndInitialize()
  } catch (error) {
    client = null
    const message = error instanceof Error ? error.message : String(error)

    // Profil klasörü hala kilitliyse (ör. önceki sunucu sürecinden kalan bir
    // Chromium tam kapanmadıysa), kilidi temizleyip BİR KEZ daha dener.
    if (/already running|SingletonLock/i.test(message)) {
      await clearStaleProfileLock()
      await delay(500)
      try {
        await createAndInitialize()
        return
      } catch (retryError) {
        client = null
        setState({ status: 'auth_failure', lastError: retryError instanceof Error ? retryError.message : 'WhatsApp bağlantısı başlatılamadı.' })
        throw retryError
      }
    }

    setState({ status: 'auth_failure', lastError: message })
    throw error
  }
}

// Kullanıcı Ayarlar sayfasında "Bağlan"/"Yeniden Dene"/"QR Kodu Yenile"
// butonlarından birine ELLE bastığında (bkz. app/api/whatsapp/connect/route.ts)
// çağrılır - otomatik arka plan denemelerinden (watchdog/health-check)
// FARKLI olarak, kullanıcı bilinçli bir deneme başlattığı için hız-sınırı
// koruması (consecutiveQrOnlyFailures/reconnectCooldownUntil) sıfırlanır.
export function resetReconnectCooldown(): void {
  consecutiveQrOnlyFailures = 0
  if (state.reconnectCooldownUntil !== null) {
    setState({ reconnectCooldownUntil: null })
  }
}

// Ayarlar sayfasının SESSİZ otomatik yeniden bağlanma efekti de (bkz.
// settings/page.tsx) "disconnected" görür görmez initWhatsappClient
// çağırıyor - bu, sunucudaki 1 dakikalık health-check bekçisinden BAĞIMSIZ
// ikinci bir tetikleyicidir ve cooldown'u atlayabilir. Bu yüzden hız-sınırı
// koruması, connect API rotasında da (force=false istekleri için) ayrıca
// kontrol edilir - bkz. app/api/whatsapp/connect/route.ts.
export function isReconnectCoolingDown(): boolean {
  return state.reconnectCooldownUntil !== null && Date.now() < state.reconnectCooldownUntil
}

// Sunucu açılışında (instrumentation.ts) ve "Bağlan" butonuna basıldığında
// çağrılır. Tüm çağrılar tek bir kuyruktan sırayla geçer (bkz. enqueue) -
// aynı anda iki Chromium başlatma denemesi asla çakışmaz.
// İKİNCİL (secondary) instance: WhatsApp Web'i HİÇ başlatma. Tek telefon
// eşleşmesini iki Chromium paylaşamaz; ikincil bir bağlantı denemesi bile
// birincilin oturumunu bozar ("detached Frame" flap). WhatsApp gönderimi
// zaten yalnızca birincil sunucuda çalışır (bkz. instrumentation.ts guard).
const IS_SECONDARY_INSTANCE = (process.env.NETSOSYAL_ROLE || '').trim().toLowerCase() === 'secondary'

export function initWhatsappClient(force = false): Promise<void> {
  if (IS_SECONDARY_INSTANCE) return Promise.resolve()
  ensureWatchdogStarted()
  ensureConnectionHealthCheckStarted()
  return enqueue(() => performInit(force))
}

// Kurulan oturumu tamamen kapatır ve diskteki oturum bilgisini siler -
// kurumun WhatsApp hesabını değiştirmek isteyen yetkili tekrar QR okutabilsin
// diye ("Bağlantıyı Kes" butonu).
export function logoutWhatsapp(): Promise<void> {
  return enqueue(async () => {
    if (client) {
      const instance = client
      try { await withTimeout(instance.logout(), 8000) } catch { /* yoksay */ }
      await destroyClientInstance(instance)
      client = null
    }
    setState({ status: 'disconnected', qrDataUrl: null, connectedNumber: null, connectedName: null, lastError: null })
  })
}

export interface SendWhatsappResult {
  ok: boolean
  error?: string
  messageId?: string
}

// Bağlı WhatsApp hesabının "görünen adını" (profil ismi) değiştirir. WhatsApp
// bu ismi, numarayı rehberine KAYITLI OLMAYAN alıcılara mesajın yanında
// gösterir (rehbere kayıtlı alıcılar için her zaman KENDİ verdikleri isim
// görünür - buna müdahale edilemez, WhatsApp'ın kendi kısıtıdır). Kurum
// numarasını rehberine eklememiş vatandaşlar, mesajı çıplak numara yerine
// buradaki isimle görsün diye kullanılır (bkz. "Kurum Görünen Adı").
export async function setWhatsappDisplayName(displayName: string): Promise<SendWhatsappResult> {
  if (!client || state.status !== 'ready') {
    return {
      ok: false,
      error: 'WhatsApp bağlantısı hazır değil. Önce Ayarlar > Sistem Ayarları > WhatsApp Web bölümünden bağlanın.',
    }
  }

  try {
    const couldSet = await client.setDisplayName(displayName)
    if (!couldSet) {
      return { ok: false, error: 'WhatsApp bu hesap için görünen ad değişikliğine izin vermiyor (hesap kısıtlı olabilir).' }
    }
    setState({ connectedName: displayName })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Görünen ad değiştirilemedi.' }
  }
}

// phoneE164WithoutPlus: "90XXXXXXXXXX" formatında (bkz.
// lib/constants/whatsappSettings.ts -> normalizeWhatsappPhoneNumber).
// Puppeteer'ın sayfa/çerçeve (frame) referansı, WhatsApp Web kendi içinde
// bir yeniden yükleme/geçiş yaptığında GEÇERSİZLEŞEBİLİYOR ("Attempted to
// use detached Frame..." - canlıda gözlemlendi, whatsapp-web.js'in bilinen
// bir kısıtı). Bu durumda o AN elimizdeki client nesnesi kullanılamaz hale
// gelir ama 'disconnected' olayı da ateşlenmeyebilir - bu yüzden state.status
// hâlâ "ready" görünse bile gönderim başarısız olur. Aşağıdaki sendWhatsappMessage
// bu HATAYI özel olarak tanıyıp bağlantıyı ZORLA tazeleyip göndermeyi BİR
// KEZ tekrar dener - kullanıcının elle "Bağlan"a basıp yeniden denemesine
// gerek kalmaz.
function isDetachedFrameError(error: unknown): boolean {
  const messageText = error instanceof Error ? error.message : String(error)
  return /detached frame|execution context was destroyed|target closed|session closed|protocol error/i.test(messageText)
}

async function attemptSendWhatsappMessage(phoneE164WithoutPlus: string, message: string): Promise<SendWhatsappResult> {
  if (!client || state.status !== 'ready') {
    return {
      ok: false,
      error: 'WhatsApp bağlantısı hazır değil. Ayarlar > Sistem Ayarları > WhatsApp Web bölümünden bağlantıyı kontrol edin.',
    }
  }

  const numberId = await client.getNumberId(phoneE164WithoutPlus)
  if (!numberId) {
    return { ok: false, error: 'Bu numara WhatsApp\'a kayıtlı değil ya da numara hatalı.' }
  }

  // sendMessage() cagrilmadan ONCE kaydedilir - 'message_create' olayi
  // (bkz. asagida) sendMessage()'in kendi Promise'i cozulmeden bile
  // ateslenebiliyor, bu yuzden dinleyici gec kalmasin diye once kurulur.
  const fallbackIdPromise = waitForOutgoingMessageId(numberId._serialized, message)

  const sentMessage = await client.sendMessage(numberId._serialized, message)
  let messageId = resolveWhatsappMessageKey(sentMessage?.id) || undefined

  if (!messageId) {
    // sendMessage() bu sohbet turunde (ör. "@lid" - bkz. yukaridaki "EK
    // SORUN" notu) dogrudan bir kimlik dondurmedi - 'message_create'
    // olayindan gelecek GERCEK kimligi kisa bir sure bekle.
    messageId = await fallbackIdPromise
  }

  console.log(`[WhatsApp] Mesaj gönderildi - id=${messageId || '(ALINAMADI)'} alici=${numberId._serialized} ham_id=${JSON.stringify(sentMessage?.id)}`)
  return { ok: true, messageId }
}

export async function sendWhatsappMessage(phoneE164WithoutPlus: string, message: string): Promise<SendWhatsappResult> {
  if (IS_SECONDARY_INSTANCE) {
    return { ok: false, error: 'WhatsApp gönderimi bu sunucuda kapalı (ikincil instance) - birincil sunucudan gönderin.' }
  }
  try {
    return await attemptSendWhatsappMessage(phoneE164WithoutPlus, message)
  } catch (error) {
    if (!isDetachedFrameError(error)) {
      return { ok: false, error: error instanceof Error ? error.message : 'WhatsApp mesajı gönderilemedi.' }
    }

    console.log(`[WhatsApp] "Detached frame" hatası yakalandı (${error instanceof Error ? error.message : error}) - bağlantı zorla tazeleniyor ve gönderim tekrar deneniyor...`)
    // Gonderim istegi (HTTP request) sonsuza kadar askida kalmasin diye -
    // yeniden baglanma takilirsa arka plandaki 1 dakikalik saglik kontrolu
    // zaten bunu ayrica duzeltmeye devam eder (bkz. checkAndRecoverConnection).
    await withTimeout(initWhatsappClient(true), 45000).catch((reinitError) => {
      console.error('[WhatsApp] Gönderim öncesi zorla yeniden bağlanma başarısız oldu:', reinitError)
    })

    if (!client || (state.status as WhatsappConnectionStatus) !== 'ready') {
      return { ok: false, error: 'WhatsApp bağlantısı yenilendi ancak henüz hazır değil - lütfen birkaç saniye sonra tekrar deneyin.' }
    }

    try {
      return await attemptSendWhatsappMessage(phoneE164WithoutPlus, message)
    } catch (retryError) {
      return { ok: false, error: retryError instanceof Error ? retryError.message : 'WhatsApp mesajı gönderilemedi (yeniden deneme de başarısız oldu).' }
    }
  }
}
