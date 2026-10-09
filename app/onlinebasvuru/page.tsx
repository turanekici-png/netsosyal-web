import type { Metadata } from 'next'
import {
  DEFAULT_ONLINE_APPLICATION_FORMS,
  ONLINE_APPLICATION_FORMS_SETTING_KEY,
  isFormCurrentlyPublished,
  normalizeOnlineApplicationIntro,
  type OnlineApplication,
} from '@/lib/constants/onlineApplicationForms'
import { settingService } from '@/lib/services'
import { ApplicationStatusLookup } from './ApplicationStatusLookup'

export const dynamic = 'force-dynamic'

// Sekme/pencere basligi artik ic yonetim uygulamasinin genel adini degil,
// bu sayfaya ozel bir basligi gostersin.
export const metadata: Metadata = {
  title: 'Online Başvuru Formları',
}

const GENERAL_SETTINGS_KEY = 'general_settings'

type OnlineGeneralSettings = {
  institutionName?: string
  departmentName?: string
  address?: string
  logoDataUrl?: string
  applicationStatusLookupEnabled?: boolean
}

const DEFAULT_GENERAL_SETTINGS: Required<OnlineGeneralSettings> = {
  institutionName: 'Sivas Belediyesi',
  departmentName: 'Sosyal Hizmetler Müdürlüğü',
  address: 'Sivas Belediyesi Sosyal Hizmetler Müdürlüğü',
  logoDataUrl: '/sivas-belediyesi-logo.png',
  // Kullanici istegi (2026-09-22): "başvuru sorgulama alanını gizleyip
  // açabilelim" - Ayarlar > Genel > Başvuru Sorgulama'dan yonetiliyor,
  // ayarda anahtar hic yoksa (eski kayitlar) varsayilan ACIK kalir.
  applicationStatusLookupEnabled: true,
}

async function getActiveOnlineForms(): Promise<OnlineApplication[]> {
  try {
    const setting = await settingService.getByKey(ONLINE_APPLICATION_FORMS_SETTING_KEY)
    const forms = Array.isArray(setting?.value)
      ? setting.value as OnlineApplication[]
      : DEFAULT_ONLINE_APPLICATION_FORMS
    // Kullanici istegi (2026-09-22): "o tarih ve saat geldiğinde yayına
    // girsin ve zamanı dolunca yayından çıksın" - ham "active" yerine
    // zamanlamayi da kontrol eden isFormCurrentlyPublished kullanilir. Bu
    // sayfa "force-dynamic" oldugu icin HER istekte yeniden hesaplanir -
    // ayrica bir zamanlanmis gorev/cron GEREKMEZ.
    return forms.filter((form) => isFormCurrentlyPublished(form))
  } catch {
    return DEFAULT_ONLINE_APPLICATION_FORMS.filter((form) => form.active)
  }
}

// Kullanici istegi (2026-09-22): "yazılar daha koyu ve kriterler daha
// anlaşılır şekilde listelensin" - admin'in yazdigi metin satir satir
// (bazen basina kendi "•" isareti koyarak) giriliyor; bu satirlari ayirip
// KENDI tutarli nokta isaretimizle (asagida render'da) yeniden listeler -
// boylece admin "•" koysa da koymasa da GORUNUM her zaman ayni/duzenli olur.
function splitDescriptionLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.replace(/^[•\-*]\s*/, '').trim())
    .filter(Boolean)
}

async function getGeneralSettings(): Promise<OnlineGeneralSettings> {
  try {
    const setting = await settingService.getByKey(GENERAL_SETTINGS_KEY)
    return setting?.value && typeof setting.value === 'object'
      ? setting.value as OnlineGeneralSettings
      : {}
  } catch {
    return {}
  }
}

// Kullanici istegi (14 Eylul 2026, 2. tur): "/onlinebasvuru kurumun acmis
// oldugu TUM online basvurularinin gorundugu ana sayfa olacak, kurum ayni
// anda birden fazla turde online basvuru acmis ise kullanici buradan
// hangisini basvuru yapmak istiyorsa ona girip basvurusunu yapabilecek."
// Bu sayfa OTURUM GEREKTIRMEZ (bkz. proxy.ts public-erisim istisnasi) -
// vatandaslara acik, ic yonetim ekranlariyla (ör. /online, oturum
// gerektiren "Vatandaş Başvuru Listesi") HICBIR baglantisi yok.
export default async function OnlineBasvuruHubPage() {
  const [forms, generalSettings] = await Promise.all([
    getActiveOnlineForms(),
    getGeneralSettings(),
  ])
  const settings = { ...DEFAULT_GENERAL_SETTINGS, ...generalSettings }

  // Kullanici istegi (14 Eylul 2026, 5. tur): "başvuru sorgulama ekranı bu
  // sayfada olsun, başvuruyu yaptığı sayfada olmasın" - bu yuzden tek
  // aktif form olsa bile ARTIK otomatik yonlendirme YAPILMIYOR (eskiden
  // yapiyordu): aksi halde vatandas bu sayfaya hic ugramadan direkt forma
  // duser ve sorgulama bolumune HICBIR ZAMAN erisemezdi. Tek form varken
  // kart listesi tek karta duser, altinda sorgulama bolumu HER ZAMAN gorunur.

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e0f2fe,transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef5fb_46%,#f8fafc_100%)] px-4 py-10 text-slate-950 sm:px-6">
      {/* Kullanici istegi (2026-09-22): "işaretli başvuru alanı ... yaklaşık
          mevcut olanın yarısı kadar daha büyüt" - konteyner max-6xl(1152px)
          -> max-7xl(1280px) genisletildi, asagidaki grid de daha az/daha
          genis sutuna gecti (kartlar ~%50 daha genis olur). */}
      {/* Kullanici istegi (2026-09-22, devam): "sayfadaki veri alanını sağa
          ve sola biaz daha genişletelim" - konteyner max-7xl(1280px) ->
          max-[96rem](1536px) genisletildi. */}
      <div className="mx-auto max-w-[96rem]">
        {/* Kullanici istegi (2026-09-22): "orta üstteki logoyu sol başa
            getirelim ve sivas belediyesi sosyal hizmetler müdürlüğü onun
            sağında olsun ortada ise online başvuru formu başlığı olsun" -
            eskiden hepsi tek sutunda ustuste ortalanmisti (logo -> kurum adi
            -> baslik). Artik md: ve uzerinde 3 sutunlu bir grid: SOL (logo +
            kurum adi yan yana), ORTA (baslik, GERCEKTEN ortalanmis - sag
            sutun da sol sutunla AYNI "1fr" agirlikta oldugu icin sol
            sutunun icerik genisligi ne olursa olsun orta sutun matematiksel
            olarak sayfa ortasinda kalir), SAG (bos - simetri icin). Mobilde
            (md altinda) eskisi gibi ustuste, ortalanmis.
            Devam (ayni gun): "işaretli alandaki bilgiler mavi şerit içinde
            görünsün" - artik beyaz sayfa arka planinda degil, mavi
            gradyanli bir seritin/bannerin icinde (logo kutusu okunabilirlik
            icin beyaz kaldi, diger metinler beyaz/acik renge cevrildi). */}
        <div className="rounded-2xl bg-gradient-to-r from-[#003f82] via-[#075b9f] to-[#0f8fb8] px-5 py-6 shadow-lg sm:rounded-3xl sm:px-8 sm:py-8">
          <div className="flex flex-col items-center gap-5 text-center md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-6 md:text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white p-2.5 shadow-lg sm:h-20 sm:w-20 sm:p-3">
                <img
                  src={settings.logoDataUrl}
                  alt={`${settings.institutionName} logosu`}
                  className="h-full w-full object-contain"
                />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-white/85 sm:text-sm">{settings.institutionName}</p>
                <p className="text-[11px] font-bold text-white/70 sm:text-xs">{settings.departmentName}</p>
              </div>
            </div>

            <div className="text-center">
              <h1 className="text-lg font-black text-white sm:text-2xl md:text-3xl">Online Başvuru Formları</h1>
              <p className="mx-auto mt-2 max-w-xl text-xs font-semibold leading-relaxed text-white/85 sm:text-sm">
                Başvurmak istediğiniz yardım türünü aşağıdan seçerek başvurunuzu online olarak yapabilirsiniz.
              </p>
            </div>

            <div className="hidden md:block" aria-hidden="true" />
          </div>
        </div>

        {/* Kullanici istegi (14 Eylul 2026, 3. tur -> 18. tur): kartlar once
            buyutulmustu, sonra "mobilde alanlar/yazi puntolari cok buyuk
            duruyor" denilince ozellikle mobilde (varsayilan boyutlar)
            kuculdu; sm: ustunde (tablet/masaustu) onceki buyuk gorunum
            korunuyor. Her karta, o formun Ayarlar > Online Başvuru
            Formları > "Popup Gorseli" alaninda (intro.imageUrl) zaten
            tanimli olan gorsel eklendi (tanimlanmamissa kurum logosuna
            duser) - yeni bir admin alani gerekmedi.
            18. tur: "başvuru alanları VE sorgulama alanı yan yana, aynı
            boyutta ve hizalı olsun" - ApplicationStatusLookup artik AYRI
            bir satirda degil, TAM OLARAK AYNI grid'in bir hucresi (en sonda)
            - boylece CSS grid'in varsayilan "stretch" davranisi sayesinde
            otomatik olarak diger kartlarla ayni boyut/hiza elde edilir.
            19. tur: "yan yana 4'u sigsin" - lg: 3 sutun -> 4 sutun.
            "Aktif form yok" uyarisi de artik grid'i TAMAMEN degistirmiyor
            (col-span-full) - sorgulama karti bu durumda bile HER ZAMAN
            gorunur kalir (5. tur karari korunuyor). Sorgulama karti
            ACILINCA (bkz. ApplicationStatusLookup.tsx) kendi grid
            hucresinde "col-span-full" olup TUM satiri kaplar - boylece
            tarih/donem/asama/aciklama sonuc tablosuna yeterli genislik
            acilir, digerlerinin boyutunu ETKİLEMEZ. */}
        <div className="mt-6 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {forms.length === 0 && (
            <div className="col-span-full rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm font-bold text-amber-800">
              Şu anda aktif bir online başvuru formu bulunmamaktadır. Lütfen daha sonra tekrar deneyin.
            </div>
          )}
          {forms.map((form) => {
            const intro = normalizeOnlineApplicationIntro(form.intro)
            const cardImage = intro.imageUrl || settings.logoDataUrl
            return (
              <a
                key={form.id}
                href={`/online?form=${encodeURIComponent(form.id)}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:border-[#0076b6] hover:shadow-xl sm:rounded-3xl"
              >
                <div className="flex h-20 items-center justify-center bg-slate-50 p-3.5 sm:h-32 sm:p-5">
                  <img
                    src={cardImage}
                    alt={`${form.title} görseli`}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="flex flex-1 flex-col justify-between p-3.5 sm:p-5">
                  <div>
                    <h2 className="text-sm font-black leading-tight text-slate-900 group-hover:text-[#0076b6] sm:text-xl">
                      {form.title}
                    </h2>
                    {intro.description && (
                      // Kullanici istegi (2026-09-22): "kriterlerde burada
                      // yine maddeler halinde görünsün" (satir sonlari
                      // yutuluyordu) -> "yazılar daha koyu ve kriterler
                      // daha anlaşılır şekilde listelensin" - artik ham
                      // metin degil, her satir kendi nokta isaretiyle
                      // AYRI bir liste ogesi (<li>) olarak, koyu/kalin
                      // yazi ile gosteriliyor.
                      <ul className="mt-1.5 space-y-1 sm:mt-2.5">
                        {splitDescriptionLines(intro.description).map((line, index) => (
                          <li key={index} className="flex items-start gap-1.5 text-[11px] font-bold leading-relaxed text-slate-800 sm:text-sm">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0076b6] sm:mt-2" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg bg-[#0076b6] px-3.5 py-2 text-xs font-black text-white shadow-sm transition group-hover:bg-[#005c8f] sm:mt-5 sm:px-4 sm:py-2.5 sm:text-sm">
                    Başvuru Yap →
                  </span>
                </div>
              </a>
            )
          })}
          {settings.applicationStatusLookupEnabled && <ApplicationStatusLookup />}
        </div>

        <p className="mt-10 text-center text-[11px] font-semibold text-slate-400">
          {settings.address}
        </p>
      </div>
    </main>
  )
}
