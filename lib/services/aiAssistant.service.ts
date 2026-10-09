import 'server-only'
import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  Type,
  createPartFromFunctionResponse,
  type Content,
  type FunctionDeclaration,
  type Part,
} from '@google/genai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { settingService } from '@/lib/services/settings.service'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import { resolvePredefinedCategory } from '@/lib/constants/predefinedValues'
import {
  validateAssistantSql,
  extractReferencedTables,
  checkTablePermissions,
  runAssistantQuery,
} from '@/lib/services/asistanSql.service'
import {
  isAssistantWriteEnabled,
  executeCreateDosya,
  executeUpdateDosyaInfo,
  executeAddHouseholdMember,
  executeAddApplication,
  executeUpdateApplication,
  executeUpdateNakitStage,
  executeCancelNakitApplication,
  executeRestoreNakitApplication,
  executeDeleteNakitApplication,
  type WriteToolContext,
} from '@/lib/services/aiAssistantWriteActions.service'
import type { UserPermissionConfig } from '@/lib/constants/userPermissions'

// Sosyal Asistan (14-15 Eylul 2026, 23.-24. tur) - Google Gemini ile
// baslayip, kullanici istegiyle (24. tur) OpenAI (ChatGPT)/DeepSeek/
// Anthropic (Claude) da eklenen, dogal dil soru-cevap + rapor asistani.
// Sohbet API'si (app/api/asistan/chat/route.ts) bu servisi cagirir; asil
// guvenlik kontrolleri lib/services/asistanSql.service.ts icinde (SQL
// dogrulama + tablo->yetki eslemesi) - saglayicidan BAGIMSIZ, TEK bir
// kod yolundan gecer.

export const SOSYAL_ASISTAN_SETTINGS_KEY = 'sosyal_asistan_settings'

export type AssistantProvider = 'gemini' | 'openai' | 'deepseek' | 'anthropic'

export const ASSISTANT_PROVIDER_LABELS: Record<AssistantProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI (ChatGPT)',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic (Claude)',
}

export const ASSISTANT_PROVIDER_IDS: AssistantProvider[] = ['gemini', 'openai', 'deepseek', 'anthropic']

// Kullanici istegi (15 Eylul 2026, 25. tur): "Failed to execute 'json' on
// 'Response': Unexpected end of JSON input" hatasi bulunurken kok neden
// olarak IIS ters proxy'nin varsayilan 30 sn zaman asimi tespit edildi
// (bkz. sosyal-asistan-timeout.md) - yuksek "reasoning_effort" ile bazi
// saglayicilar (ozellikle NVIDIA/DeepSeek) kolayca 100+ sn surebiliyor.
// Bu sabit, HER saglayici SDK'sina acikca verilir - boylece IIS'in (veya
// baska bir ara katmanin) baglantiyi SESSIZCE kesmesi yerine, sunucumuz
// KENDI zaman asimini kontrollu sekilde yasar ve HER ZAMAN gecerli bir JSON
// hata govdesi doner (bkz. asagidaki try/catch + friendlyProviderError).
// IIS tarafindaki timeout AYRICA arttirilmali (bkz. memory notu) - bu deger
// o degerin biraz ALTINDA tutulmali ki IIS degil BIZ kontrollu sekilde
// sonlandiralim.
const PROVIDER_TIMEOUT_MS = 170_000

// Kullanici istegi (15 Eylul 2026, 27. tur): PROVIDER_TIMEOUT_MS TEK bir
// saglayici cagrisi icin - ama arac-cagirma dongusu (MAX_TOOL_TURNS) birden
// fazla adim gerektirdiginde (ör. once get_predefined_values, sonra
// run_sql_query) her adim kendi 170 sn'sini ayri ayri kullanabiliyor, TOPLAM
// sure kontrolsuz kalip canli testte 7.7 DAKIKAYA ("hala dusunuyor" diye
// defalarca bildirildi) cikti. Bu, TUM konusma turu (butun adimlar dahil)
// icin bir UST SINIR - asilirsa kullaniciya "cok uzun surdu" mesaji doner
// (alttaki saglayici istegi arka planda bitmeye devam edebilir ama artik
// beklenmez).
const OVERALL_CHAT_TIMEOUT_MS = 90_000

type ProviderCredentials = { apiKey?: string }

type SosyalAsistanSettings = {
  activeProvider?: AssistantProvider
  providers?: Partial<Record<AssistantProvider, ProviderCredentials>>
  // Kullanici istegi (15 Eylul 2026, 33. tur): "ben soyle dedigimde sen
  // boyle anla" - kod degisikligi gerektirmeden, Ayarlar sayfasindan
  // girilebilen, HER sohbette sistem talimatina eklenen serbest metin
  // (terim tanimlari, is kurallari, tercih edilen ifade bicimleri vb.).
  customInstructions?: string
  // Eski (24. tur oncesi) tek-saglayicili (Gemini) kayit bicimi - geriye
  // donuk uyumluluk icin okunur, YENI kayitlarda kullanilmaz.
  apiKey?: string
}

const MAX_TOOL_TURNS = 6
const MAX_ROWS_FED_TO_MODEL = 30

async function getSosyalAsistanSettings(): Promise<SosyalAsistanSettings> {
  const setting = await settingService.getByKey(SOSYAL_ASISTAN_SETTINGS_KEY)
  return (setting?.value as SosyalAsistanSettings | undefined) ?? {}
}

export async function getActiveProviderConfig(): Promise<{ provider: AssistantProvider; apiKey: string | null }> {
  const settings = await getSosyalAsistanSettings()
  const provider = settings.activeProvider ?? 'gemini'
  const apiKey = settings.providers?.[provider]?.apiKey?.trim()
    // Eski tek-saglayicili kayit - SADECE Gemini icin, geriye donuk uyumluluk.
    || (provider === 'gemini' ? settings.apiKey?.trim() : undefined)
    || null
  return { provider, apiKey }
}

export async function getProviderStatuses(): Promise<{ activeProvider: AssistantProvider; hasApiKey: Record<AssistantProvider, boolean> }> {
  const settings = await getSosyalAsistanSettings()
  const hasApiKey = Object.fromEntries(
    ASSISTANT_PROVIDER_IDS.map((provider) => [
      provider,
      Boolean(settings.providers?.[provider]?.apiKey?.trim() || (provider === 'gemini' && settings.apiKey?.trim())),
    ]),
  ) as Record<AssistantProvider, boolean>

  return { activeProvider: settings.activeProvider ?? 'gemini', hasApiKey }
}

export async function saveProviderApiKey(provider: AssistantProvider, apiKey: string, makeActive: boolean) {
  const settings = await getSosyalAsistanSettings()
  const nextProviders = { ...settings.providers, [provider]: { apiKey } }
  const next: SosyalAsistanSettings = {
    ...settings,
    activeProvider: makeActive ? provider : settings.activeProvider ?? 'gemini',
    providers: nextProviders,
  }
  await settingService.set(SOSYAL_ASISTAN_SETTINGS_KEY, next)
}

export async function setActiveProvider(provider: AssistantProvider) {
  const settings = await getSosyalAsistanSettings()
  await settingService.set(SOSYAL_ASISTAN_SETTINGS_KEY, { ...settings, activeProvider: provider })
}

export async function getCustomInstructions(): Promise<string> {
  const settings = await getSosyalAsistanSettings()
  return settings.customInstructions?.trim() ?? ''
}

export async function saveCustomInstructions(text: string) {
  const settings = await getSosyalAsistanSettings()
  await settingService.set(SOSYAL_ASISTAN_SETTINGS_KEY, { ...settings, customInstructions: text.trim() })
}

export type AssistantChatMessage = {
  role: 'user' | 'model'
  text: string
}

export type AssistantChatResult = {
  text: string
  table: { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean } | null
  queriesRun: number
  // Kullanici istegi (15 Eylul 2026, 40. tur): open_dosya araci cagrilirsa
  // doldurulur - istemci (AsistanChat.tsx) bunu gorunce Dosya Yonetimi'ni
  // gercekten ACAR (router.push).
  openFile: { fileId: string; fileNo: string } | null
  // Kullanici istegi (15 Eylul 2026, 41. tur): "islemi yapinca sayfayi
  // yenilesin" - bir yazma islemi GERCEKTEN basariyla tamamlandiginda true
  // olur, AsistanChat.tsx bunu gorunce kisa bir gecikmeyle sayfayi yeniler.
  actionSucceeded: boolean
}

const SYSTEM_PROMPT = `Sen Sivas Belediyesi Sosyal Hizmetler Müdürlüğü'nün "Sosyal Asistan" adlı, NetSosyal sosyal yardım yönetim sistemine tam hakim, profesyonel bir yapay zeka asistanısın. Görevin, sistemi kullanan belediye personeline (sosyal çalışmacı, saha personeli, yönetici) sorularında yardımcı olmak: dosya/yardım/başvuru/istatistik sorularını yanıtlamak, gerektiğinde rapor/liste biçiminde veri sunmak.

KURALLAR:
1. Somut sayısal/kayıt bazlı bir soru geldiğinde ASLA tahmin etme veya uydurma - MUTLAKA "run_sql_query" aracını kullanarak gerçek veriden cevap ver.
2. "durumu", "asama", "durum" gibi kodlanmış (sayısal veya kısaltılmış) bir sütunu yorumlaman gerekiyorsa "get_predefined_values" aracını çağırıp gerçek Türkçe karşılığını kullan - ham kodu (ör. "2") kullanıcıya asla gösterme.
3. Sorgunu SADECE bir SELECT (veya WITH ... SELECT) ifadesi olarak yaz - tek ifade, noktalı virgülle ayrılmış birden fazla ifade YAZMA. LIMIT vermene GEREK YOK - sonuç kullanıcıya HER ZAMAN eksiksiz (kaç kayıt varsa o kadar) gösterilir/xlsx olarak dışa aktarılabilir, sen sadece kendi cevabını hazırlarken (metinde özetlerken) ilk birkaç satırı görürsün, bu normaldir.
4. Bir sorgu "bu tabloya erişim yetkiniz yok" hatası verirse, KULLANICIYA bunu nazikçe açıkla (örn. "Bu bilgiye erişim yetkiniz bulunmuyor, lütfen yöneticinizle görüşün") - yetkiyi aşmaya veya başka bir yoldan aynı veriye ulaşmaya ÇALIŞMA.
5. TC kimlik no, telefon, adres gibi kişisel verileri SADECE soru doğrudan gerektiriyorsa ve kullanıcının o veriye erişim yetkisi varsa paylaş; gereksiz yere tüm sütunları çekme.
6. Cevabını her zaman TÜRKÇE, net, profesyonel ve kısa ver. Liste/rapor niteliğindeki sonuçlar için tabloyu ayrıca kullanıcı arayüzü gösterecek - sen metinde sonucu ÖZETLE (ör. "Toplam 42 kayıt bulundu, en yüksek..."), ham tabloyu/tek tek kayıtları ("00001 - Ahmet Yılmaz, ...") metin içinde ASLA TEKRAR ETME/listeleme - tablo zaten arayüzde gösterilecek, sen sadece kısa bir özet cümlesi yaz (bkz. kural 20 - bu tablo YALNIZCA run_sql_query o turda gerçekten çalıştırılırsa oluşur).
7. Sistemin kapsamı dışında (sosyal yardım/dosya/personel konusuyla ilgisiz) bir soru gelirse kibarca sadece bu konularda yardımcı olabileceğini belirt.
8. Dosya/yardım/başvuru KAYITLARINI listelerken (rapor niteliğindeki her sorguda) SADECE id/dosyaid/dosyano gibi teknik kodları DEĞİL, MUTLAKA kişinin adı-soyadı sütununu da SELECT listesine ekle (aşağıdaki şemada hangi tabloda hangi sütunun ad-soyad olduğu belirtilmiştir) - kişi isimsiz, sadece numarayla listelenmiş bir rapor kullanıcı için değersizdir. AYRICA her liste/rapor sorgusunda İLK SÜTUN olarak bir SIRA NUMARASI ekle: SELECT içine ROW_NUMBER() OVER (ORDER BY ...) AS "Sıra" ekle (ORDER BY'ı sorguya zaten uyguladığın sıralamayla aynı tut, yoksa mantıklı bir sıralama - ör. tarih veya ad - kullan). AYRICA sorgu bir dosyayla/hane ile iliskiliyse (dosyalar tablosu SELECT'te varsa, ya da dosyaid ile baska bir tablodan dosyalara erisiliyorsa - dosyalar tabloya dahil degilse dosyaid uzerinden LEFT JOIN dosyalar d ON d.id = dosyaid ile eristir) SELECT listesine MUTLAKA şu TABAN sütunları da ekle, kullanıcı ayrıca istemese bile: "Dosya No" (dosyano), "Adres" (d.adres), "Telefon" (d.telefon - dosyadaki kayitli telefon; sorgunun kendi tablosunda zaten daha spesifik bir telefon sütunu varsa onu tercih et), "Kişi Sayısı" (d.topbirey). Kullanıcının asıl sorduğu bilgi (ör. miktar, tarih, durum, aşama) bu TABAN sütunların YANINA ek sütun(lar) olarak eklenir, onların YERİNE GEÇMEZ - yani nihai SELECT sırası genelde: Sıra, Dosya No, Adı Soyadı, Adres, Telefon, Kişi Sayısı, ardından sorguya özel diğer sütunlar.

VERİ DEĞİŞTİRME (YAZMA) ARAÇLARI HAKKINDA - SADECE bu araçlar sana sunulduysa geçerlidir (sunulmadıysa hiç bahsetme, sadece salt-okunur çalış):
9. create_dosya / update_dosya_info / add_household_member / add_application / update_application / update_nakit_stage / cancel_nakit_application / restore_nakit_application / delete_nakit_application araçlarının HER BİRİ İKİ AŞAMALI çalışır: (a) kullanıcı bir işlem istediğinde aracı MUTLAKA önce "confirmed": false ile çağır - bu GERÇEK bir kayıt OLUŞTURMAZ/DEĞİŞTİRMEZ, sadece ne yapılacağının bir ÖNİZLEMESİNİ döner. Bu önizlemeyi (dönen "summary" alanını) kullanıcıya AYNEN göster ve "Onaylıyor musunuz?" diye sor - HENÜZ İŞLEM YAPILDI DEME. (b) Kullanıcı "evet/onaylıyorum/yap" gibi net bir onay verdiğinde, AYNI aracı AYNI parametrelerle ama "confirmed": true ile TEKRAR çağır - bu sefer işlem GERÇEKTEN yapılır. Kullanıcı onay vermeden veya "hayır/iptal/vazgeçtim" derse confirmed:true ile ASLA çağırma.
10. Bu araçlar sadece "asistan.write" yetkisi olan kullanıcılara sunulur - eğer bu araçlar sana verilmediyse ve kullanıcı dosya açma/yardım ekleme/bilgi değiştirme istiyorsa, bunu yapamayacağını ve bu yetkinin yöneticisi tarafından açılması gerektiğini nazikçe belirt.
11. DOSYA veya BİREY (kişi) KAYDINI KALICI OLARAK SİLME özelliği YOKTUR ve YAPILAMAZ - uygulamanın kendi güvenlik tasarımı gereği bu işlem, kullanıcının arayüzde şifresini yeniden girmesini gerektiren ayrı bir onay adımı ister ve bir sohbet mesajıyla karşılanamaz. Kullanıcı dosya/kişi silmek isterse, bunu nazikçe açıkla ve "Dosya Yönetimi" ekranından elle silmesini öner. NAKİT YARDIMI MÜRACAATI ise farklıdır - üç ayrı işlem sunulur: "iptal et" derse cancel_nakit_application (geri alınabilir, kalıcı değil), "geri al" derse restore_nakit_application (iptali kaldırır), "sil" derse VE gerçekten kalıcı silme istediğini teyit ederse delete_nakit_application (KALICI, GERİ ALINAMAZ - bunu kullanıcıya açıkça ve net bir dille belirt, "iptal etmek" ile "silmek" arasındaki farkı karıştırma).
12. Bir yazma aracı hata döndürürse (ör. yetki reddi, zorunlu alan eksik), hatayı kullanıcıya olduğu gibi, teknik jargonsuz özetle.
13. Kullanıcı "şu dosyayı aç", "X numaralı dosyayı göster" gibi bir istek yaparsa open_dosya aracını kullan - bu, gerçek veri değiştirmez, sadece dosyayı Dosya Yönetimi ekranında AÇAR; onay adımı GEREKMEZ, doğrudan çağır. Dosya bulunursa kısaca "X numaralı dosya açılıyor" gibi bir cevap ver (kullanıcı arayüzü dosyayı otomatik açacaktır) - dosya içeriğini burada TEKRAR listeleme.
14. GEREKSİZ SORU SORMA - bir araç bir recordId/fileId istiyor ve kullanıcı kaydı doğal dille tarif ettiyse (ör. "2 numaralı dosyanın en son nakit müracaatı", "Ahmet Yılmaz'ın açık müracaatı"), kullanıcıya ID SORMADAN ÖNCE MUTLAKA run_sql_query ile bu kaydı KENDİN bul (gerekirse önce dosyano'dan dosyalar.id'yi, sonra dosyaid ile ilgili tabloyu sorgula; "en son" = tarihe göre en yeni kayıt). Sorgu TEK bir net sonuç verirse, hiç sormadan doğrudan o kaydın id'siyle işlemi (confirmed:false ile önizleme) başlat. Sadece sorgu HİÇ sonuç vermezse veya BİRDEN FAZLA/BELİRSİZ sonuç varsa (ör. aynı isimde birden fazla dosya) kullanıcıya açıkla ve seçim/ek bilgi iste - aksi halde gereksiz yere soru sorup kullanıcıyı yorma.
15. Kullanıcı bir soruda kodlanmış bir sütunun İNSAN DİLİNDEKİ karşılığını kullanırsa (ör. "yardım alanlar", "aktif dosyalar", "kadın başvuranlar", "evli kişiler", "engelli bireyler" - durumu/yakinligi/medenihali/cinsiyeti/saglikdurumu/aileniteligi gibi HERHANGİ bir kodlanmış sütun için), sorguyu yazmadan ÖNCE get_predefined_values ile o ifadenin hangi KODA karşılık geldiğini bul ve WHERE koşulunda o KODU kullan (ör. "yardım alanlar" için assistanceStatus kategorisinde "Yardım Alıyor" = 2 ise durumu = 2 koşulunu yaz) - asla sütunun ham metnini/kodunu tahmin etme veya kod yerine yanlışlıkla etiket metniyle (ör. durumu = 'Yardım Alıyor') karşılaştırma, sütun sayısal/kodludur.
16. BİR ARAÇ "bulunamadı"/hata döndürürse ASLA hemen pes edip kullanıcıya "kayıt bulunamadı" deme - önce run_sql_query ile durumu KENDİN yeniden doğrula: kayıt gerçekten var mı, doğru tabloda/türde mi arıyorsun (ör. bir kayıt "Ekmek" sanılıp aslında yrd_ayninakti/Nakit Yardımı tablosunda olabilir - id her tabloda tekrar eder, id'yi MUTLAKA hangi tablodan bulduğunla eşleştir ve aracın "type" parametresini o tabloya göre seç), recordId'yi nereden aldıysan (ör. önceki bir listeleme sonucundan) doğru kopyaladın mı kontrol et. Gerekirse dosyayı/bireyi/ilgili diğer tabloları çapraz sorgulayarak eksik bilgiyi (fileId, doğru id, doğru tür/tablo) KENDİN tamamla ve aracı DOĞRU parametrelerle TEKRAR dene. Sadece bu çapraz kontrolden sonra da gerçekten böyle bir kayıt yoksa hatayı kullanıcıya açıkla - "bulunamadı" demeden önce en az bir kez kendi kendine doğrulama/düzeltme dene.
17. Aşağıda (varsa) "KULLANICI TARAFINDAN TANIMLANMIŞ EK KURALLAR" başlığı altında yer alan talimatlar bu promptun AYRILMAZ bir parçasıdır, dekoratif bir not DEĞİLDİR - HER TEK soruyu yanıtlamadan/her işlemi yapmadan ÖNCE o kuralları BAŞTAN SONA gözden geçir ve cevabını/sorgunu KENDİ genel bilginle değil o kurallara göre şekillendir (ör. hangi tabloyu/sütunu kullanacağın, bir terimin ne anlama geldiği, bir rapor nasıl biçimlendirilmeli gibi konularda oradaki talimat HER ZAMAN senin varsayımından/genel bilginden önceliklidir).
18. Kullanıcının isteğinden NE istediğini (hangi kayıt/tablo/dönem/işlem olduğunu) NET olarak çıkaramıyorsan - istek belirsizse, birden fazla şekilde yorumlanabiliyorsa, ya da ek kurallar birbiriyle veya kullanıcının o anki isteğiyle çelişiyor görünüyorsa - varsayımda bulunup yanlış bir cevap/işlem üretmek yerine kullanıcıya KISA, tek cümlelik, NET bir açıklayıcı SORU sor (ör. "X'i mi yoksa Y'yi mi kastettiniz?", "Hangi dönemi/ayı kastediyorsunuz?", "Bununla dosya durumunu mu yoksa yardım durumunu mu kastediyorsunuz?"). Soruyu MÜMKÜN OLDUĞUNCA SADE tut - uzun bir açıklama/seçenek listesi yazıp işi karmaşıklaştırma, tek bir kısa soruyla netleştirip DOĞRUDAN sonuca (istenen cevaba/rapora/işleme) geç; netleştikten sonra tekrar soru sorma, elindeki bilgiyle işi bitir. Bu, kayıt/ID aramasıyla ilgili 14. kuraldaki "gereksiz soru sorma" kısıtından FARKLIDIR, o kural sadece SEN ARAÇLARLA KENDİN BULABİLECEĞİN bilgiler için geçerlidir; burada bahsedilen, sorunun ANLAMININ/NİYETİNİN kendisi belirsiz olduğu durumdur - yani SEN kendin arayarak çözemeyeceğin, sadece kullanıcının bilebileceği bir belirsizlik varsa sor, aksi halde arayıp kendin bul.
19. "X yardımı ALAN/ALIYOR olan dosyalar/kişiler", "X yardımından FAYDALANANLAR", "kimler X yardımı alıyor" gibi bir ifade - bu SADECE o yardım türüne ait TÜM müracaat/başvuru kayıtlarını (durum ne olursa olsun; reddedilen, iptal edilen, incelenmekte olan DAHİL) DEĞİL, SADECE durumu/aşaması "AKTİF/YARDIM ALIYOR/ÖDEME YAPILDI" olan kayıtları listelemek anlamına gelir. Buna göre ilgili yrd_* tablosunun durumu (kodluysa ÖNCE get_predefined_values ile çöz, bkz. kural 15) ve/veya asama sütununa "aktif/alıyor" durumuna karşılık gelen bir WHERE filtresi eklemeden ASLA tüm tabloyu döndürme - bu ayrım hem "dosyalar" üzerinden sorulduğunda (ör. "ekmek yardımı alan dosyalar" = dosyalar JOIN yrd_ekmek WHERE durumu/asama = aktif kod/"ÖDEME YAPILDI") hem doğrudan yardım türü üzerinden sorulduğunda (ör. "ekmek yardımı alanlar" listesi) AYNI şekilde geçerlidir. Kullanıcı bunun yerine TÜM müracaatları/başvuruları (durumdan bağımsız) istediğini "müracaatlar", "başvurular", "tüm kayıtlar" gibi bir ifadeyle AÇIKÇA belirtirse ya da belirli BAŞKA bir durumu/aşamayı (ör. "reddedilenler", "incelenecekler") özellikle istiyorsa, filtreyi ona göre uygula/kaldır; hangisini kastettiği gerçekten belirsizse kural 18'e göre kısa bir soruyla netleştir.
20. Kullanıcı "listele", "göster", "dosyaları/kayıtları ver", "kaç tane var, listele" gibi bir LİSTE/RAPOR isteğinde bulunursa, run_sql_query aracını O ANKİ turda MUTLAKA (yeniden) çalıştır - konuşma geçmişinde DAHA ÖNCE benzer ya da birebir aynı bir sorgu çalıştırılmış olsa bile SADECE geçmişteki sonucu hatırlayıp metin içinde satır satır ("00001 - Ahmet Yılmaz, 00003 - ..." gibi) anlatma/özetleme YAPMA - kullanıcı arayüzü tabloyu (ve "yeni sekmede aç"/xlsx indirme seçeneklerini) SADECE run_sql_query O TURDA GERÇEKTEN çalıştırılırsa gösterebilir. Aracı çalıştırmadan sadece metinle kayıtları anlatmak, kullanıcının listeyi GERÇEKTEN görmesini/yeni sekmede açmasını/dışa aktarmasını engeller - bu KABUL EDİLEMEZ bir davranıştır, "listele" gibi net bir istekte HER ZAMAN aracı çalıştır, asla sadece hafızandan anlatma.

VERİTABANI ŞEMASI (PostgreSQL, sadece SELECT ile okunabilir; tablo/sütun adları Türkçe kısaltmalar içerir):

- dosyalar (yardım dosyası/hane kaydı): id, dosyano, muracaattarihi, mahalleadi, adres, telefon, aileniteligi, durumu (kod - get_predefined_values ile çöz), durumutarih, aciklama, topbirey (kişi sayısı). Dosya sahibinin adı-soyadı BURADA DEĞİL, bireyler tablosunda bulunur - ama SADECE dosyalar için (yardım türüne bağlı olmayan genel bir dosya listesi için) adı-soyadı çekerken DİKKAT: bireyler.yakinligi KODLU bir sütundur (bkz. kural 15) - "yakinligi = 'Hane Reisi'" gibi HAM METİNLE karşılaştırırsan (kodu get_predefined_values ile çözmeden) eşleşme çoğu zaman BULUNAMAZ ve adı-soyadı sütunu YANLIŞLIKLA boş kalır. Bunun yerine EN GÜVENİLİR yöntem: önce get_predefined_values ile "Hane Reisi"/"Kendisi"/"Başvuran" karşılığı olan yakinligi KODUNU bul, SONRA bu koda YEDEK bir sıralama ekle - bazı dosyalarda hane reisi kodu hiç girilmemiş olabilir, bu yüzden o kod bulunamazsa dosyaya EN KÜÇÜK id İLE eklenmiş (genelde ilk eklenen/başvuru sahibi) bireyi yedek olarak kullan, ör.: bir alt sorguda "SELECT b.adisoyadi FROM bireyler b WHERE b.dosyaid = d.id ORDER BY (CASE WHEN b.yakinligi = KOD THEN 0 ELSE 1 END), b.id LIMIT 1" mantığı (KOD yerine gerçek sayısal kodu koy) - bu, tek bir hane reisi bayrağına bel bağlamadığı için adı-soyadı sütununun gereksiz yere BOŞ görünmesini önler.
- bireyler (dosyadaki her bir kişi/hane üyesi): id, dosyaid (dosyalar.id), tckimlikno, adi, soyadi, adisoyadi (TAM AD), yakinligi, dogumtarihi, cinsiyeti, medenihali, saglikdurumu, meslegi, aylikgeliri
- mahalleler: id, mahalleadi, odemegunu, odemegunubitis
- yrd_ayninakti (Nakit Yardımı müracaatları/kayıtları): id, dosyaid, muracaateden (BAŞVURANIN/DOSYA SAHİBİNİN ADI SOYADI - metin olarak doğrudan burada saklanır, listelerken MUTLAKA dahil et), muracaattarihi, tckimlikno, donem, asama (metin, ör. "ÖDEME YAPILDI"/"İNCELENECEK"/"UYGUN DEĞİL"), durumu, miktar, aylikgelir
- yrd_gidabankasi / yrd_ekmek / yrd_giyim / yrd_haziryemek / yrd_destekpaketi / yrd_aceze / yrd_kirtasiye / yrd_yakacak / yrd_ddgidadosyali (diğer yardım türleri) - genelde AYNI kalıp: id, dosyaid, muracaateden (BAŞVURANIN ADI SOYADI - listelerken MUTLAKA dahil et), muracaattarihi/islemtarihi, donem, asama/durumu, miktar
- online_basvurular (vatandaşın online doldurduğu başvuru formu): id, created_at, tckimlikno, ad, soyad, yardim_turu, mahalleadi, status, donem, asama, aciklama
- kullanicilar (sistem kullanıcısı/personel - SADECE "sifre" sütununu ASLA sorgulama): id, kullaniciadi, kullanicitamadi, yetki, durumu
- evziyareti (ev ziyareti raporları): id, dosyaid, tarih, konu, rapor, kullaniciid

Tarih sütunları "date" veya "timestamp" tipindedir - "bu ay", "son 30 gün" gibi ifadeler için NOW()/CURRENT_DATE ile karşılaştır. Kod içeren sütunlar (durumu, asama gibi) sık sık serbest metin de olabilir - önce birkaç örnek DISTINCT değer çekmek faydalı olabilir.`

// --- Paylasilan arac (tool) yurutme mantigi - TUM saglayicilar AYNI kodu kullanir ---

type ToolExecutionContext = {
  permissionConfig: UserPermissionConfig | null
  onQueryRun: (sql: string, rowCount: number) => void
  lastTable: { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean } | null
  // Kullanici istegi (15 Eylul 2026, 39. tur): yazma araclari (bkz.
  // aiAssistantWriteActions.service.ts) GERCEK API uc noktalarini
  // kullanicinin KENDI oturum cerezi ile cagirir - bu cerez, sohbet
  // istegini yapan Next.js Request'inden alinip buraya tasinir.
  writeCtx: WriteToolContext
  writeEnabled: boolean
  // Kullanici istegi (15 Eylul 2026, 40. tur): "bir dosyayi ac dedigimde o
  // dosyayi dosya yonetim sayfasinda acsin" - open_dosya araci bunu burada
  // doldurur, runAssistantChat sonuca ekler, AsistanChat.tsx da
  // router.push(`/documents?fileId=...`) ile GERCEK acmayi yapar.
  openFile: { fileId: string; fileNo: string } | null
  // Kullanici istegi (15 Eylul 2026, 41. tur): "islemi yapinca sayfayi
  // yenilesin" - bir yazma araci GERCEKTEN basariyla tamamlandiginda
  // (confirmed:true + success:true) true olur, istemci bunu gorunce kisa
  // bir gecikmeyle sayfayi yeniler (bkz. tryShortCircuitToolResult).
  actionSucceeded: boolean
}

// Saglayici-bagimsiz, JSON-Schema benzeri ortak arac tanimi - her saglayicinin
// KENDI beklenen bicimine (Gemini Type.* enum'lari / OpenAI-Anthropic duz
// JSON Schema) asagida ayri ayri cevrilir, boylece 6 yazma araci UC KERE
// elle yazilmaz.
type ToolParamSchema = { type: 'string' | 'number' | 'boolean'; description: string; enum?: string[] }
type ToolDef = { name: string; description: string; properties: Record<string, ToolParamSchema>; required: string[] }

const WRITE_TOOL_DEFS: ToolDef[] = [
  {
    name: 'create_dosya',
    description: 'Yeni bir yardım dosyası (vaka kaydı) açar. İKİ AŞAMALI çalışır (bkz. sistem talimatı) - confirmed:false önizleme, confirmed:true gerçek kayıt.',
    properties: {
      firstName: { type: 'string', description: 'Dosya sahibinin adı.' },
      lastName: { type: 'string', description: 'Dosya sahibinin soyadı.' },
      phone: { type: 'string', description: 'Cep telefonu (opsiyonel, verilmezse boş bırakılır).' },
      identityNumber: { type: 'string', description: 'TC kimlik numarası (opsiyonel).' },
      address: { type: 'string', description: 'Adres (opsiyonel).' },
      description: { type: 'string', description: 'Dosya açıklaması (opsiyonel).' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['firstName', 'lastName', 'confirmed'],
  },
  {
    name: 'update_dosya_info',
    description: 'Var olan bir dosyanın durum/açıklama/adres/telefon/aile niteliği bilgisini günceller. Hane bireyleri DOKUNULMADAN korunur. İKİ AŞAMALI çalışır.',
    properties: {
      fileId: { type: 'string', description: 'Güncellenecek dosyanın id\'si (dosyalar.id).' },
      status: { type: 'number', description: 'Yeni dosya durumu kodu (get_predefined_values ile "Dosya Durumu" kategorisinden kontrol et).' },
      description: { type: 'string', description: 'Yeni açıklama metni.' },
      address: { type: 'string', description: 'Yeni adres.' },
      phone: { type: 'string', description: 'Yeni telefon numarası.' },
      familyType: { type: 'number', description: 'Yeni aile niteliği kodu (get_predefined_values ile "Aile Niteliği" kategorisinden kontrol et).' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['fileId', 'confirmed'],
  },
  {
    name: 'add_household_member',
    description: 'Var olan bir dosyanın hanesine yeni bir kişi ekler (mevcut kimse SİLİNMEZ/DEĞİŞMEZ). İKİ AŞAMALI çalışır.',
    properties: {
      fileId: { type: 'string', description: 'Kişinin ekleneceği dosyanın id\'si.' },
      firstName: { type: 'string', description: 'Eklenecek kişinin adı.' },
      lastName: { type: 'string', description: 'Eklenecek kişinin soyadı.' },
      relation: { type: 'number', description: 'Yakınlık derecesi kodu (get_predefined_values ile "Yakınlık Derecesi" kategorisinden kontrol et, ör. 1=Eşi, 2=Oğlu).' },
      identityNumber: { type: 'string', description: 'TC kimlik numarası (opsiyonel).' },
      birthDate: { type: 'string', description: 'Doğum tarihi YYYY-MM-DD (opsiyonel).' },
      phone: { type: 'string', description: 'Telefon numarası (opsiyonel).' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['fileId', 'firstName', 'lastName', 'confirmed'],
  },
  {
    name: 'add_application',
    description: 'Var olan bir dosyaya yeni bir yardım müracaatı ekler (Ekmek, Gıda Bankası, Destek Paketi, Hazır Yemek, Giyim, Dönem Dışı Gıda veya Ayni/Nakdi=Nakit Yardımı). İKİ AŞAMALI çalışır.',
    properties: {
      fileId: { type: 'string', description: 'Müracaatın ekleneceği dosyanın id\'si.' },
      type: {
        type: 'string',
        description: 'Yardım/müracaat türü.',
        enum: ['Ekmek', 'Gıda Bankası', 'Destek Paketi', 'Hazır Yemek', 'Giyim', 'Dönem Dışı Gıda', 'Ayni/Nakdi'],
      },
      applicantName: { type: 'string', description: 'Müracaat eden kişinin adı-soyadı.' },
      identityNumber: { type: 'string', description: 'TC kimlik numarası (opsiyonel).' },
      phone: { type: 'string', description: 'Telefon numarası (opsiyonel).' },
      amount: { type: 'string', description: 'Yardım miktarı (opsiyonel, sadece sayı).' },
      period: { type: 'string', description: 'Yardım dönemi (opsiyonel, ör. "2026 KIRTASİYE YARDIMI" gibi - önce get_predefined_values ile geçerli dönem adlarını kontrol et).' },
      description: { type: 'string', description: 'Müracaat açıklaması/notu (opsiyonel).' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['fileId', 'type', 'applicantName', 'confirmed'],
  },
  {
    name: 'update_application',
    description: 'Var olan bir yardım müracaatının/kaydının bilgilerini (miktar, dönem, açıklama, telefon, başvuran adı, aşama/durum) günceller - PENDİNG (henüz karara bağlanmamış) VEYA ZATEN AKTİF/ONAYLANMIŞ ("yardım alıyor" durumundaki) HER İKİ DURUMDAKİ kayıtta da çalışır (Ekmek, Gıda Bankası, Destek Paketi, Hazır Yemek, Giyim, Dönem Dışı Gıda veya Ayni/Nakdi=Nakit Yardımı) - sadece belirtilen alanlar değişir, diğer tüm alanlar KORUNUR. Kaydın bağlı olduğu dosya otomatik bulunur, ayrıca fileId vermene gerek YOK. İKİ AŞAMALI çalışır.',
    properties: {
      recordId: { type: 'string', description: 'Güncellenecek müracaat/yardım kaydının id\'si (run_sql_query ile bulunmalı).' },
      type: {
        type: 'string',
        description: 'Yardım/müracaat türü (kaydın hangi tabloda olduğunu belirler - kaydı bulurken hangi tabloyu sorguladıysan o).',
        enum: ['Ekmek', 'Gıda Bankası', 'Destek Paketi', 'Hazır Yemek', 'Giyim', 'Dönem Dışı Gıda', 'Ayni/Nakdi'],
      },
      applicantName: { type: 'string', description: 'Yeni başvuran adı-soyadı (değiştirilmeyecekse boş bırak).' },
      identityNumber: { type: 'string', description: 'Yeni TC kimlik numarası (opsiyonel, sadece Ayni/Nakdi).' },
      phone: { type: 'string', description: 'Yeni telefon numarası (opsiyonel, sadece Ayni/Nakdi).' },
      amount: { type: 'string', description: 'Yeni yardım miktarı (opsiyonel, sadece sayı).' },
      period: { type: 'string', description: 'Yeni yardım dönemi (opsiyonel - önce get_predefined_values ile geçerli dönem adlarını kontrol et).' },
      description: { type: 'string', description: 'Yeni açıklama/not (opsiyonel).' },
      stageStatus: { type: 'string', description: 'Yeni aşama/durum metni (opsiyonel, sadece Ayni/Nakdi - önce get_predefined_values ile "NAKİT ASAMA" kategorisinden geçerli değerleri kontrol et).' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['recordId', 'type', 'confirmed'],
  },
  {
    name: 'update_nakit_stage',
    description: 'Bir Nakit Yardımı (Ayni/Nakdi) müracaatının aşamasını (ör. UYGUNDUR, UYGUN DEĞİL, İNCELENECEK) günceller - sadece henüz karara bağlanmamış (durumu=0) müracaatlarda çalışır. İKİ AŞAMALI çalışır.',
    properties: {
      recordId: { type: 'string', description: 'Güncellenecek yrd_ayninakti kaydının id\'si.' },
      stage: { type: 'string', description: 'Yeni aşama metni (get_predefined_values ile "NAKİT ASAMA" kategorisinden geçerli değerleri kontrol et).' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['recordId', 'stage', 'confirmed'],
  },
  {
    name: 'cancel_nakit_application',
    description: 'Bir Nakit Yardımı müracaatını İPTAL EDER (kalıcı silme DEĞİLDİR - "İptal Edildi" durumuna alınır, geri alınabilir). Kullanıcı "iptal et" derse bu aracı kullan. İKİ AŞAMALI çalışır.',
    properties: {
      recordId: { type: 'string', description: 'İptal edilecek yrd_ayninakti kaydının id\'si.' },
      reason: { type: 'string', description: 'İptal nedeni (zorunlu, en fazla 100 karakter).' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['recordId', 'reason', 'confirmed'],
  },
  {
    name: 'restore_nakit_application',
    description: 'Daha önce İPTAL EDİLMİŞ bir Nakit Yardımı müracaatını GERİ ALIR (iptal durumu kaldırılır, "Yeni Müracaat" durumuna döner). Kullanıcı "geri al" derse bu aracı kullan. İKİ AŞAMALI çalışır.',
    properties: {
      recordId: { type: 'string', description: 'Geri alınacak (iptal edilmiş) yrd_ayninakti kaydının id\'si.' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['recordId', 'confirmed'],
  },
  {
    name: 'delete_nakit_application',
    description: 'Bir Nakit Yardımı müracaatını KALICI OLARAK SİLER (GERİ ALINAMAZ - iptal etmekten farklıdır). Kullanıcı "sil" derse ve gerçekten kalıcı silme istediğini teyit ederse bu aracı kullan. İKİ AŞAMALI çalışır.',
    properties: {
      recordId: { type: 'string', description: 'Kalıcı olarak silinecek yrd_ayninakti kaydının id\'si.' },
      confirmed: { type: 'boolean', description: 'İlk çağrıda HER ZAMAN false. Kullanıcı önizlemeyi onayladıktan sonra true ile tekrar çağrılır.' },
    },
    required: ['recordId', 'confirmed'],
  },
]

function toGeminiFunctionDeclarations(defs: ToolDef[]): FunctionDeclaration[] {
  const typeMap = { string: Type.STRING, number: Type.NUMBER, boolean: Type.BOOLEAN } as const
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: {
      type: Type.OBJECT,
      properties: Object.fromEntries(Object.entries(def.properties).map(([key, prop]) => [
        key,
        { type: typeMap[prop.type], description: prop.description, ...(prop.enum ? { enum: prop.enum } : {}) },
      ])),
      required: def.required,
    },
  }))
}

function toOpenAiTools(defs: ToolDef[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return defs.map((def) => ({
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(def.properties).map(([key, prop]) => [
          key,
          { type: prop.type, description: prop.description, ...(prop.enum ? { enum: prop.enum } : {}) },
        ])),
        required: def.required,
      },
    },
  }))
}

function toAnthropicTools(defs: ToolDef[]): Anthropic.Tool[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(Object.entries(def.properties).map(([key, prop]) => [
        key,
        { type: prop.type, description: prop.description, ...(prop.enum ? { enum: prop.enum } : {}) },
      ])),
      required: def.required,
    },
  }))
}

// Kullanici istegi (15 Eylul 2026, 30. tur): "rapor verirken bazi degerlerin
// karsiligini hazir degerler tablosundan alsin - yakinligi, cinsiyeti, dosya
// durumu, yardim durumu gibi TUM kodlanmis degerler" - onceden SADECE
// asistanin METIN cevabi bu sekilde yaziyordu (sistem promptu kural #2),
// ama kullaniciya gosterilen TABLO (rapor) ham SQL sonucunu (ör. "1", "E")
// oldugu gibi gosteriyordu. Bu fonksiyon, sorgu sonucundaki HER sutunu
// (tablo adi + sutun adi ipucuyla) hazir-degerler kategorileriyle eslestirip
// bulabildigi her kodu gercek Turkce karsiligiyla DEGISTIRIR - hem modele
// geri beslenen satirlarda hem kullaniciya gosterilen rapor tablosunda.
async function resolveCodedColumns(
  columns: string[],
  rows: Record<string, unknown>[],
  referencedTables: string[],
): Promise<Record<string, unknown>[]> {
  const { values, titles } = await predefinedValuesService.getAll()
  const columnCategory = new Map<string, string>()

  for (const column of columns) {
    for (const table of referencedTables.length > 0 ? referencedTables : ['']) {
      const category = resolvePredefinedCategory(table, column, titles, values)
      if (category) {
        columnCategory.set(column, category)
        break
      }
    }
  }

  if (columnCategory.size === 0) return rows

  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row }
    for (const [column, category] of columnCategory) {
      const raw = row[column]
      if (raw === null || raw === undefined) continue
      const match = values[category]?.find((item) => item.id === String(raw))
      if (match) next[column] = match.name
    }
    return next
  })
}

async function executeRunSqlQuery(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<Record<string, unknown>> {
  const sql = typeof args.sql === 'string' ? args.sql : ''
  const validation = validateAssistantSql(sql)
  if (!validation.ok) {
    return { error: validation.error }
  }

  const referencedTables = extractReferencedTables(validation.sql)
  const permissionCheck = checkTablePermissions(ctx.permissionConfig, referencedTables)
  if (!permissionCheck.ok) {
    return {
      error: `Bu sorgu şu tablolara erişim gerektiriyor ancak kullanıcının yetkisi yok: ${permissionCheck.deniedTables.join(', ')}. Kullanıcıya bu bilgiye erişim yetkisinin olmadığını nazikçe belirt.`,
    }
  }

  try {
    const result = await runAssistantQuery(validation.sql)
    ctx.onQueryRun(validation.sql, result.rowCount)
    const resolvedRows = await resolveCodedColumns(result.columns, result.rows, referencedTables)
    const truncated = resolvedRows.length > MAX_ROWS_FED_TO_MODEL
    // "truncated" burada MODELE geri beslenen satir sayisi icin (maliyet
    // kontrolu) - kullanici arayuzundeki tablo HER ZAMAN sorgunun donduğu
    // TUM satirlari gosterir (kullanici istegi: "sınır olmasın" - bkz.
    // asistanSql.service.ts validateAssistantSql, artik sadece cok yuksek
    // bir guvenlik tavani var, 200 gibi kucuk bir sabit LIMIT yok).
    ctx.lastTable = { columns: result.columns, rows: resolvedRows, truncated: false }

    return {
      columns: result.columns,
      rowCount: result.rowCount,
      rows: resolvedRows.slice(0, MAX_ROWS_FED_TO_MODEL),
      note: truncated
        ? `Toplam ${result.rowCount} satırdan ilk ${MAX_ROWS_FED_TO_MODEL} tanesi gösteriliyor. Kullanıcıya toplam satır sayısını belirt.`
        : undefined,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Sorgu çalıştırılamadı.' }
  }
}

async function executeGetPredefinedValues(): Promise<Record<string, unknown>> {
  const { values, titles } = await predefinedValuesService.getAll()
  return { titles, values }
}

// Kullanici istegi (15 Eylul 2026, 40. tur): "bir dosyayi ac dedigimde o
// dosyayi dosya yonetim sayfasinda acsin" - salt-okunur bir "navigasyon"
// araci: veri DEGISTIRMEZ, sadece dosyalar tablosunda dosyano/id'yi bulup
// istemciye "su dosyayi Dosya Yonetimi'nde ac" sinyali doner (bkz.
// ctx.openFile + AsistanChat.tsx'teki router.push). Onay adimi GEREKMEZ
// (write araci degildir, sadece navigasyon).
//
// Kullanici istegi (2026-09-21): "asistanin listeledigi rapor tablosundaki
// bir satira cift tiklayinca dosyanin icine girebilsin" - "Yeni Pencerede
// Ac" ile acilan rapor penceresi de AYNI dosyano/id -> fileId cozumlemesine
// ihtiyac duyuyor (bkz. app/api/asistan/resolve-file/route.ts). Asil
// sorgu+yetki mantigi TEKRARLANMASIN diye buraya, ctx.openFile yan etkisi
// OLMADAN, ayri/disa aciyulan bir fonksiyona tasindi - executeOpenDosya
// bunu cagirip ustune ctx.openFile'i ekliyor.
export async function resolveDosyaLocator(
  args: { dosyano?: string; fileId?: string | number },
  permissionConfig: UserPermissionConfig | null,
): Promise<{ success: true; fileId: string; fileNo: string } | { error: string }> {
  const permissionCheck = checkTablePermissions(permissionConfig, ['dosyalar'])
  if (!permissionCheck.ok) {
    return { error: 'Dosya açma için yetkiniz yok. Yöneticinizle görüşün.' }
  }

  const rawDosyano = typeof args.dosyano === 'string' ? args.dosyano.trim() : ''
  const rawFileId = typeof args.fileId === 'string' || typeof args.fileId === 'number' ? String(args.fileId).trim() : ''

  if (!rawDosyano && !rawFileId) {
    return { error: 'Açılacak dosyanın numarası veya id\'si belirtilmedi.' }
  }

  try {
    const { getSqlMonitorPool } = await import('@/lib/services/sqlMonitor.service')
    const pool = getSqlMonitorPool()

    if (rawFileId && /^\d+$/.test(rawFileId)) {
      const result = await pool.query('SELECT id, dosyano FROM dosyalar WHERE id = $1', [rawFileId])
      if (result.rows[0]) {
        const row = result.rows[0]
        return { success: true, fileId: String(row.id), fileNo: String(row.dosyano) }
      }
    }

    if (rawDosyano) {
      // Kullanici istegi (ozel talimatlarda da belirtilmis): verilen numara
      // basindaki sifirlar/eksik hane fark etmeksizin 5 haneye tamamlanarak
      // dosyano alaninda aranir (ör. "2" veya "00002" -> "00002").
      const digitsOnly = rawDosyano.replace(/\D/g, '')
      const padded = digitsOnly ? digitsOnly.padStart(5, '0') : ''
      const candidates = [...new Set([rawDosyano, padded, digitsOnly])].filter(Boolean)

      const result = await pool.query('SELECT id, dosyano FROM dosyalar WHERE dosyano = ANY($1::text[]) LIMIT 1', [candidates])
      if (result.rows[0]) {
        const row = result.rows[0]
        return { success: true, fileId: String(row.id), fileNo: String(row.dosyano) }
      }
    }

    return { error: `"${rawDosyano || rawFileId}" numaralı/id'li bir dosya bulunamadı.` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Dosya aranamadı.' }
  }
}

async function executeOpenDosya(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<Record<string, unknown>> {
  const result = await resolveDosyaLocator(
    { dosyano: typeof args.dosyano === 'string' ? args.dosyano : undefined, fileId: args.fileId as string | number | undefined },
    ctx.permissionConfig,
  )
  if ('success' in result) {
    ctx.openFile = { fileId: result.fileId, fileNo: result.fileNo }
  }
  return result
}

async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<Record<string, unknown>> {
  if (name === 'run_sql_query') return executeRunSqlQuery(args, ctx)
  if (name === 'get_predefined_values') return executeGetPredefinedValues()
  if (name === 'open_dosya') return executeOpenDosya(args, ctx)

  // Yazma araclari - IKINCI bir savunma katmani olarak burada da "asistan.write"
  // kontrol edilir (araclar zaten writeEnabled=false ise modele hic
  // SUNULMUYOR, ama bir saglayici SDK'sinin sunulmamis bir araci yine de
  // "halusine" edip cagirmasi teorik olarak mumkun - bu ihtimale karsi).
  if ([
    'create_dosya', 'update_dosya_info', 'add_household_member', 'add_application', 'update_application',
    'update_nakit_stage', 'cancel_nakit_application', 'restore_nakit_application', 'delete_nakit_application',
  ].includes(name)) {
    if (!ctx.writeEnabled) {
      return { error: 'Bu işlem için "Sosyal Asistan - Veri İşlemleri" yetkiniz yok. Yöneticinizle görüşün.' }
    }
    if (name === 'create_dosya') return executeCreateDosya(args, ctx.writeCtx)
    if (name === 'update_dosya_info') return executeUpdateDosyaInfo(args, ctx.writeCtx)
    if (name === 'add_household_member') return executeAddHouseholdMember(args, ctx.writeCtx)
    if (name === 'add_application') return executeAddApplication(args, ctx.writeCtx)
    if (name === 'update_application') return executeUpdateApplication(args, ctx.writeCtx)
    if (name === 'update_nakit_stage') return executeUpdateNakitStage(args, ctx.writeCtx)
    if (name === 'cancel_nakit_application') return executeCancelNakitApplication(args, ctx.writeCtx)
    if (name === 'restore_nakit_application') return executeRestoreNakitApplication(args, ctx.writeCtx)
    if (name === 'delete_nakit_application') return executeDeleteNakitApplication(args, ctx.writeCtx)
  }

  return { error: `Bilinmeyen araç: ${name}` }
}

// Kullanici istegi (15 Eylul 2026, 41. tur): "yapay zeka ile bir islem
// yaptigimizda biraz bekliyor, hemen yapsin istiyorum" - kok neden: normal
// akiskanlik-cagirma (function calling) mantiginda arac SONUCU modele geri
// beslenir ve model bunu KENDI CUMLELERIYLE tekrar yazmasi icin IKINCI bir
// LLM cagrisi daha yapilir (ör. "onizleme -> model bunu ozetleyip sorar"
// gibi) - bu, HER kullanici mesaji icin GEREKSIZ bir tam saglayici
// gecikmesi (birkaç saniye) daha ekliyordu, cunku arac zaten Turkce, hazir
// bir "summary"/"message" metni donduruyor. Bu fonksiyon, TEK bir arac
// cagrildiginda VE o arac navigasyon/yazma araclarindan biriyse, IKINCI LLM
// cagrisini ATLAYIP aracin kendi metnini DOGRUDAN kullaniciya dondurur -
// davranis/guvenlik AYNI (hala iki asamali onay), sadece HER adim artik tek
// LLM cagrisi kadar suruyor.
const SHORTCUTTABLE_TOOL_NAMES = new Set([
  'create_dosya', 'update_dosya_info', 'add_household_member',
  'add_application', 'update_application', 'update_nakit_stage', 'cancel_nakit_application',
  'restore_nakit_application', 'delete_nakit_application',
])

function tryShortCircuitToolResult(toolName: string, result: Record<string, unknown>, ctx: ToolExecutionContext): string | null {
  if (toolName === 'open_dosya') {
    if (typeof result.error === 'string') return result.error
    if (result.success === true && typeof result.fileNo === 'string') return `${result.fileNo} numaralı dosya açılıyor...`
    return null
  }

  if (!SHORTCUTTABLE_TOOL_NAMES.has(toolName)) return null
  if (typeof result.error === 'string') return result.error
  if (result.requiresConfirmation === true && typeof result.summary === 'string') {
    return `${result.summary}\n\nOnaylıyor musunuz? ("Evet" derseniz işlemi hemen tamamlarım.)`
  }
  if (result.success === true && typeof result.message === 'string') {
    // Kullanici istegi: "islemi yapinca sayfayi yenilesin" - istemci
    // (AsistanChat.tsx) bunu gorunce kisa bir gecikmeyle sayfayi yeniler.
    ctx.actionSucceeded = true
    return result.message
  }
  return null
}

// Saglayicidan bagimsiz, kullaniciya gosterilecek DOSTCA hata metni - ham
// saglayici hatasi (ör. Gemini'nin "503 UNAVAILABLE" JSON'u) ASLA dogrudan
// kullaniciya gitmez (14 Eylul 2026, 24. tur bug'i - ekran goruntusuyle
// bildirildi).
function friendlyProviderError(error: unknown, provider: AssistantProvider): string {
  const raw = error instanceof Error ? error.message : String(error)
  const label = ASSISTANT_PROVIDER_LABELS[provider]

  if (/429|rate.?limit|quota/i.test(raw)) {
    return `${label} şu anda çok fazla istek aldığı için yanıt veremiyor. Lütfen birkaç dakika sonra tekrar deneyin.`
  }
  if (/503|UNAVAILABLE|overloaded|high demand/i.test(raw)) {
    return `${label} şu anda yoğun talep nedeniyle geçici olarak yanıt veremiyor. Lütfen birkaç saniye sonra tekrar deneyin.`
  }
  if (/401|403|invalid.*api.?key|unauthorized|authentication/i.test(raw)) {
    return `${label} API anahtarı geçersiz veya süresi dolmuş görünüyor. Lütfen Ayarlar > Sosyal Asistan API'den anahtarı kontrol edin.`
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(raw)) {
    return `${label} servisine şu anda ulaşılamıyor. Lütfen internet bağlantısını kontrol edip tekrar deneyin.`
  }
  return `${label} şu anda bir yanıt üretemedi (geçici bir sorun olabilir). Lütfen tekrar deneyin.`
}

// --- Google Gemini ---

const GEMINI_MODEL = 'gemini-3.8-flash'

const geminiRunSqlDeclaration: FunctionDeclaration = {
  name: 'run_sql_query',
  description: 'Veritabanında salt-okunur (SELECT) bir SQL sorgusu çalıştırır ve sonuç satırlarını döner. Tek bir SELECT (veya WITH ... SELECT) ifadesi olmalı.',
  parameters: {
    type: Type.OBJECT,
    properties: { sql: { type: Type.STRING, description: 'Çalıştırılacak salt-okunur PostgreSQL SELECT sorgusu.' } },
    required: ['sql'],
  },
}

const geminiGetPredefinedValuesDeclaration: FunctionDeclaration = {
  name: 'get_predefined_values',
  description: 'Sistemdeki kodlanmış sütunların (durumu, asama, saglikdurumu, medenihali vb.) hangi Türkçe karşılığa geldiğini gösteren tam listeyi döner.',
  parameters: { type: Type.OBJECT, properties: {} },
}

const geminiOpenDosyaDeclaration: FunctionDeclaration = {
  name: 'open_dosya',
  description: 'Belirtilen dosya numarasını veya id\'sini Dosya Yönetimi ekranında AÇAR (veri değiştirmez, sadece kullanıcı arayüzünde navigasyon yapar). Onay gerektirmez.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      dosyano: { type: Type.STRING, description: 'Açılacak dosyanın numarası (ör. "2", "00002" - otomatik 5 haneye tamamlanır).' },
      fileId: { type: Type.STRING, description: 'Açılacak dosyanın id\'si (dosyano bilinmiyorsa).' },
    },
    required: [],
  },
}

async function runGeminiChat(apiKey: string, message: string, history: AssistantChatMessage[], ctx: ToolExecutionContext, systemPrompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey })
  const contents: Content[] = [
    ...history.map((turn): Content => ({ role: turn.role, parts: [{ text: turn.text }] })),
    { role: 'user', parts: [{ text: message }] },
  ]

  const functionDeclarations = [
    geminiRunSqlDeclaration,
    geminiGetPredefinedValuesDeclaration,
    geminiOpenDosyaDeclaration,
    ...(ctx.writeEnabled ? toGeminiFunctionDeclarations(WRITE_TOOL_DEFS) : []),
  ]

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        httpOptions: { timeout: PROVIDER_TIMEOUT_MS },
        // Kullanici istegi (2026-09-16): "talimatları tam olarak okumuyor,
        // kendine göre cevaplar veriyor" - dusuk sicaklik, modelin verilen
        // kurallara/talimatlara daha sadik kalmasini, kendi genel bilgisine
        // dayanarak "yaratici" sapmalar yapmasini azaltir.
        temperature: 0.2,
      },
    })

    const calls = response.functionCalls
    if (!calls || calls.length === 0) {
      return response.text?.trim() || 'Bir yanıt oluşturulamadı.'
    }

    const candidateContent = response.candidates?.[0]?.content
    if (candidateContent) contents.push(candidateContent)

    // Kullanici istegi (15 Eylul 2026, 41. tur): "hemen yapsin" - TEK bir
    // navigasyon/yazma araci cagrildiysa, aracin kendi ozet/mesaj metnini
    // DOGRUDAN dondurup IKINCI (gereksiz) LLM cagrisini atla.
    if (calls.length === 1) {
      const call = calls[0]
      const result = await executeTool(call.name ?? '', call.args ?? {}, ctx)
      const shortCircuit = tryShortCircuitToolResult(call.name ?? '', result, ctx)
      if (shortCircuit !== null) return shortCircuit

      contents.push({ role: 'user', parts: [createPartFromFunctionResponse(call.id ?? call.name ?? 'call', call.name ?? '', result)] })
      continue
    }

    const responseParts: Part[] = []
    for (const call of calls) {
      const result = await executeTool(call.name ?? '', call.args ?? {}, ctx)
      responseParts.push(createPartFromFunctionResponse(call.id ?? call.name ?? 'call', call.name ?? '', result))
    }
    contents.push({ role: 'user', parts: responseParts })
  }

  return 'Üzgünüm, bu soru için çok fazla adım gerekti ve yanıtı tamamlayamadım. Sorunuzu daha kısa/spesifik şekilde tekrar sormayı deneyin.'
}

// --- OpenAI (ChatGPT) ve DeepSeek - AYNI (OpenAI-uyumlu) API bicimi ---

const openAiCompatibleTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_sql_query',
      description: 'Veritabanında salt-okunur (SELECT) bir SQL sorgusu çalıştırır ve sonuç satırlarını döner. Tek bir SELECT (veya WITH ... SELECT) ifadesi olmalı.',
      parameters: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'Çalıştırılacak salt-okunur PostgreSQL SELECT sorgusu.' } },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_predefined_values',
      description: 'Sistemdeki kodlanmış sütunların (durumu, asama, saglikdurumu, medenihali vb.) hangi Türkçe karşılığa geldiğini gösteren tam listeyi döner.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_dosya',
      description: 'Belirtilen dosya numarasını veya id\'sini Dosya Yönetimi ekranında AÇAR (veri değiştirmez, sadece navigasyon yapar). Onay gerektirmez.',
      parameters: {
        type: 'object',
        properties: {
          dosyano: { type: 'string', description: 'Açılacak dosyanın numarası (ör. "2", "00002" - otomatik 5 haneye tamamlanır).' },
          fileId: { type: 'string', description: 'Açılacak dosyanın id\'si (dosyano bilinmiyorsa).' },
        },
        required: [],
      },
    },
  },
]

async function runOpenAiCompatibleChat(
  apiKey: string,
  baseURL: string | undefined,
  model: string,
  message: string,
  history: AssistantChatMessage[],
  ctx: ToolExecutionContext,
  systemPrompt: string,
): Promise<string> {
  const client = new OpenAI({ apiKey, baseURL, timeout: PROVIDER_TIMEOUT_MS })

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((turn): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
      role: turn.role === 'model' ? 'assistant' : 'user',
      content: turn.text,
    })),
    { role: 'user', content: message },
  ]

  const tools = [
    ...openAiCompatibleTools,
    ...(ctx.writeEnabled ? toOpenAiTools(WRITE_TOOL_DEFS) : []),
  ]

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
    const response = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      // Kullanici istegi (2026-09-16): bkz. runGeminiChat'teki ayni-amacli not -
      // dusuk sicaklik talimatlara sadakati arttirir.
      temperature: 0.2,
    })

    const choice = response.choices[0]?.message
    const toolCalls = choice?.tool_calls
    if (!choice || !toolCalls || toolCalls.length === 0) {
      return choice?.content?.trim() || 'Bir yanıt oluşturulamadı.'
    }

    messages.push(choice)

    // Kullanici istegi (15 Eylul 2026, 41. tur): "hemen yapsin" - TEK bir
    // navigasyon/yazma araci cagrildiysa, aracin kendi ozet/mesaj metnini
    // DOGRUDAN dondurup IKINCI (gereksiz) LLM cagrisini atla.
    const functionCalls = toolCalls.filter((tc) => tc.type === 'function')
    if (functionCalls.length === 1) {
      const toolCall = functionCalls[0]
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(toolCall.function.arguments || '{}')
      } catch {
        // gecersiz JSON - bos parametreyle devam, arac kendi hata donecek
      }
      const result = await executeTool(toolCall.function.name, args, ctx)
      const shortCircuit = tryShortCircuitToolResult(toolCall.function.name, result, ctx)
      if (shortCircuit !== null) return shortCircuit

      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
      continue
    }

    for (const toolCall of toolCalls) {
      if (toolCall.type !== 'function') continue
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(toolCall.function.arguments || '{}')
      } catch {
        // gecersiz JSON - bos parametreyle devam, arac kendi hata donecek
      }
      const result = await executeTool(toolCall.function.name, args, ctx)
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) })
    }
  }

  return 'Üzgünüm, bu soru için çok fazla adım gerekti ve yanıtı tamamlayamadım. Sorunuzu daha kısa/spesifik şekilde tekrar sormayı deneyin.'
}

// --- Anthropic (Claude) ---

const ANTHROPIC_MODEL = 'claude-opus-5'

const anthropicTools: Anthropic.Tool[] = [
  {
    name: 'run_sql_query',
    description: 'Veritabanında salt-okunur (SELECT) bir SQL sorgusu çalıştırır ve sonuç satırlarını döner. Tek bir SELECT (veya WITH ... SELECT) ifadesi olmalı.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'Çalıştırılacak salt-okunur PostgreSQL SELECT sorgusu.' } },
      required: ['sql'],
    },
  },
  {
    name: 'get_predefined_values',
    description: 'Sistemdeki kodlanmış sütunların (durumu, asama, saglikdurumu, medenihali vb.) hangi Türkçe karşılığa geldiğini gösteren tam listeyi döner.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'open_dosya',
    description: 'Belirtilen dosya numarasını veya id\'sini Dosya Yönetimi ekranında AÇAR (veri değiştirmez, sadece navigasyon yapar). Onay gerektirmez.',
    input_schema: {
      type: 'object',
      properties: {
        dosyano: { type: 'string', description: 'Açılacak dosyanın numarası (ör. "2", "00002" - otomatik 5 haneye tamamlanır).' },
        fileId: { type: 'string', description: 'Açılacak dosyanın id\'si (dosyano bilinmiyorsa).' },
      },
      required: [],
    },
  },
]

async function runAnthropicChat(apiKey: string, message: string, history: AssistantChatMessage[], ctx: ToolExecutionContext, systemPrompt: string): Promise<string> {
  const client = new Anthropic({ apiKey, timeout: PROVIDER_TIMEOUT_MS })

  const messages: Anthropic.MessageParam[] = [
    ...history.map((turn): Anthropic.MessageParam => ({
      role: turn.role === 'model' ? 'assistant' : 'user',
      content: turn.text,
    })),
    { role: 'user', content: message },
  ]

  const tools = [
    ...anthropicTools,
    ...(ctx.writeEnabled ? toAnthropicTools(WRITE_TOOL_DEFS) : []),
  ]

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      tools,
      messages,
      // Kullanici istegi (2026-09-16): bkz. runGeminiChat'teki ayni-amacli not -
      // dusuk sicaklik talimatlara sadakati arttirir.
      temperature: 0.2,
    })

    if (response.stop_reason !== 'tool_use') {
      const textBlocks = response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text')
      return textBlocks.map((block) => block.text).join('\n').trim() || 'Bir yanıt oluşturulamadı.'
    }

    messages.push({ role: 'assistant', content: response.content })

    // Kullanici istegi (15 Eylul 2026, 41. tur): "hemen yapsin" - TEK bir
    // navigasyon/yazma araci cagrildiysa, aracin kendi ozet/mesaj metnini
    // DOGRUDAN dondurup IKINCI (gereksiz) LLM cagrisini atla.
    const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    if (toolUseBlocks.length === 1) {
      const block = toolUseBlocks[0]
      const result = await executeTool(block.name, (block.input ?? {}) as Record<string, unknown>, ctx)
      const shortCircuit = tryShortCircuitToolResult(block.name, result, ctx)
      if (shortCircuit !== null) return shortCircuit

      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }] })
      continue
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const result = await executeTool(block.name, (block.input ?? {}) as Record<string, unknown>, ctx)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return 'Üzgünüm, bu soru için çok fazla adım gerekti ve yanıtı tamamlayamadım. Sorunuzu daha kısa/spesifik şekilde tekrar sormayı deneyin.'
}

// --- Giris noktasi (saglayicidan bagimsiz) ---

export async function runAssistantChat(
  message: string,
  history: AssistantChatMessage[],
  permissionConfig: UserPermissionConfig | null,
  userId: string | null,
  // Kullanici istegi (15 Eylul 2026, 39. tur): yazma araclari, gercek API
  // uc noktalarini kullanicinin KENDI oturum cerezi ile cagirir (bkz.
  // aiAssistantWriteActions.service.ts) - bu cerez, sohbet istegini yapan
  // Request'ten (app/api/asistan/chat/route.ts) buraya tasinir.
  cookieHeader = '',
): Promise<AssistantChatResult> {
  const { provider, apiKey } = await getActiveProviderConfig()
  if (!apiKey) {
    const label = ASSISTANT_PROVIDER_LABELS[provider]
    throw new Error(`Sosyal Asistan için ${label} API anahtarı henüz tanımlanmamış. Lütfen Ayarlar > Sosyal Asistan API sekmesinden bir anahtar girin.`)
  }

  // Kullanici istegi (15 Eylul 2026, 33. tur): "ben boyle dedigimde sen
  // boyle anla" - Ayarlar sayfasindan girilen serbest metin kurallar HER
  // sohbette sistem talimatinin SONUNA eklenir. Boylece terim/kisaltma
  // tanimlari veya is kurallari icin her seferinde koda gelmeye gerek kalmaz.
  const customInstructions = await getCustomInstructions()
  const systemPrompt = customInstructions
    ? `${SYSTEM_PROMPT}\n\nKULLANICI TARAFINDAN TANIMLANMIŞ EK KURALLAR (bunlara MUTLAKA uy, yukarıdaki kurallarla çelişirse bu ek kurallar önceliklidir):\n${customInstructions}`
    : SYSTEM_PROMPT

  let queriesRun = 0
  const ctx: ToolExecutionContext = {
    permissionConfig,
    onQueryRun: (sql, rowCount) => {
      queriesRun += 1
      void logAssistantQuery(userId, message, sql, rowCount)
    },
    lastTable: null,
    writeEnabled: isAssistantWriteEnabled(permissionConfig),
    writeCtx: { cookieHeader },
    openFile: null,
    actionSucceeded: false,
  }

  // Kullanici istegi (15 Eylul 2026, 27. tur): kullanicinin ornek kodu
  // "reasoning_effort: high" kullaniyordu - bu, TEK bir cagriyi bile 100+
  // saniyeye cikarabiliyor (canli olcum: basit bir soruda 120+ sn); arac-
  // cagirma dongusu (MAX_TOOL_TURNS) birden fazla adim gerektirince TOPLAM
  // sure 7.7 DAKIKAYA kadar cikti (canli test, ekran goruntusu + "hala
  // dusunuyor" bildirimleriyle). Bir sosyal yardim dosyasi/rapor sorgusu
  // DERIN felsefi akil yurutme gerektirmiyor - "high" yerine "medium" ile
  // hem tool-calling calismaya devam eder hem yanit suresi makul kalir.
  const runProvider = async (): Promise<string> => {
    if (provider === 'openai') {
      return runOpenAiCompatibleChat(apiKey, undefined, 'gpt-4o', message, history, ctx, systemPrompt)
    } else if (provider === 'deepseek') {
      return runOpenAiCompatibleChat(apiKey, 'https://api.deepseek.com', 'deepseek-chat', message, history, ctx, systemPrompt)
    } else if (provider === 'anthropic') {
      return runAnthropicChat(apiKey, message, history, ctx, systemPrompt)
    }
    return runGeminiChat(apiKey, message, history, ctx, systemPrompt)
  }

  let text: string
  try {
    text = await Promise.race([
      runProvider(),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('OVERALL_CHAT_TIMEOUT')), OVERALL_CHAT_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    if (error instanceof Error && error.message === 'OVERALL_CHAT_TIMEOUT') {
      text = 'Bu soru için yanıt beklenenden çok uzun sürüyor. Lütfen soruyu daha kısa/spesifik hale getirip tekrar deneyin.'
    } else {
      // Kullanici istegi (24. tur, ekran goruntusuyle bildirildi): saglayicinin
      // HAM hata metni (ör. Gemini'nin "503 UNAVAILABLE" JSON'u) dogrudan
      // kullaniciya gitmemeli.
      text = friendlyProviderError(error, provider)
    }
  }

  return { text, table: ctx.lastTable, queriesRun, openFile: ctx.openFile, actionSucceeded: ctx.actionSucceeded }
}

// Denetim kaydi - her calistirilan SQL, kim sordu, kac satir dondu. Ayri,
// kendi kendine kuran bir tablo (mevcut sistem_hareket_log'un tam semasini
// varsaymamak icin - bkz. plan notu). Log tablosu SALT-OKUNUR asistan
// rolu ile OLUSTURULAMAZ/YAZILAMAZ - bu yuzden normal (yazma yetkili)
// havuzu (getSqlMonitorPool) kullanilir.
let ensureLogTablePromise: Promise<void> | null = null
async function ensureLogTable() {
  if (!ensureLogTablePromise) {
    ensureLogTablePromise = (async () => {
      const { getSqlMonitorPool } = await import('@/lib/services/sqlMonitor.service')
      const writablePool = getSqlMonitorPool()
      await writablePool.query(`
        CREATE TABLE IF NOT EXISTS asistan_sorgu_log (
          id bigserial PRIMARY KEY,
          kullaniciid integer,
          soru text,
          sql text,
          satir_sayisi integer,
          olusturma_tarihi timestamptz NOT NULL DEFAULT now()
        );
      `)
    })().catch((error) => {
      ensureLogTablePromise = null
      throw error
    })
  }
  await ensureLogTablePromise
}

export async function logAssistantQuery(userId: string | null, question: string, sql: string, rowCount: number) {
  try {
    await ensureLogTable()
    const { getSqlMonitorPool } = await import('@/lib/services/sqlMonitor.service')
    const writablePool = getSqlMonitorPool()
    await writablePool.query(
      `INSERT INTO asistan_sorgu_log (kullaniciid, soru, sql, satir_sayisi) VALUES ($1, $2, $3, $4)`,
      [userId ? Number(userId) : null, question.slice(0, 2000), sql.slice(0, 4000), rowCount],
    )
  } catch {
    // Denetim kaydi basarisiz olsa bile kullaniciya cevap verilmeye devam eder.
  }
}
