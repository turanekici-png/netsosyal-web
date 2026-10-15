import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { KAPALI_DONEM, KIS_DONEMI_TABLOLARI } from '@/lib/constants/kisDonemi'

// 2026-10-15: kesilen yardimin (durumu 0/2/5 disinda) donemi "Kapalı" yazilir
// - bkz. lib/constants/kisDonemi.ts KAPALI_DONEM. Yalniz donemli 4 tablo.
type YaziciTx = { $executeRawUnsafe: (sorgu: string, ...degerler: unknown[]) => Promise<number> }

export async function kesilenYardiminDoneminiKapat(
  tablo: string,
  kayitId: string | bigint,
  tx: YaziciTx = prisma,
) {
  if (!(KIS_DONEMI_TABLOLARI as readonly string[]).includes(tablo)) return 0
  return tx.$executeRawUnsafe(
    `UPDATE ${tablo} SET donem = $1
     WHERE id = $2::bigint AND COALESCE(durumu, 0) NOT IN (0, 2, 5)
       AND COALESCE(donem, '') <> $1`,
    KAPALI_DONEM,
    String(kayitId),
  )
}

// Gecmis kayitlar dahil: donemli 4 tabloda kesilmis (durumu 0/2/5 disi)
// tum yardimlarin donemi "Kapalı" yapilir. Kullanici istegi (2026-10-15):
// "gecmis tum yardim kayitlarini da bu sekilde duzenle" - liste/rapor/
// disa aktarma ekranlari donemi dogrudan veriden okudugu icin veride
// yapilir. Zamanlanmis islerle gunde bir kez calisir (yeni kesilenleri de
// yakalar); ilk calismada eski kayitlarin hepsi duzelir.
const globalForDonemKapat = globalThis as unknown as { donemKapatRunDate?: string }

// BIR KERELIK (2026-10-15 kullanici istegi: "donem bilgisi Kış Dönemi
// yazanlarin durumunu da Bekliyor yapalim"): baslangici gelmemis Kış Dönemi
// kayitlarindan elle Durduruldu/İptal (1/3/4) yapilmis olanlar 5 "Bekliyor"
// olur; bitisi baslangictan once girilmis hatali kayitta bitis o kisin 30
// Nisan tarihi yapilir. "Kapalı" duzeltmesinden ONCE calisir (yoksa Kış
// Dönemi bilgisi kaybolurdu). Yapildigi app_settings'te isaretlenir - ileride
// bilerek iptal edilen Kış yardimi geri cevrilmez. Devam eden (2) Kış
// yardimina dokunulmaz.
const KIS_BEKLIYOR_ISARETI = 'gecis_kis_donemi_bekliyor_2026_10_15'

async function kisDonemiKayitlariniBirKereBekliyorYap() {
  const yapildi = await prisma.$queryRawUnsafe<Array<{ key: string }>>(`SELECT key FROM app_settings WHERE key = $1`, KIS_BEKLIYOR_ISARETI)
  if (yapildi.length > 0) return
  let toplam = 0
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_user', 'Sistem (Kış Dönemi düzeltmesi)', true)`
    for (const tablo of KIS_DONEMI_TABLOLARI) {
      toplam += await tx.$executeRawUnsafe(
        `UPDATE ${tablo}
         SET durumu = 5, durumutarih = CURRENT_DATE,
             durumuaciklama = 'Kış Dönemi - başlangıç (01 Kasım) bekleniyor',
             bittarih = CASE WHEN bittarih IS NULL OR bittarih < bastarih
                             THEN make_date(EXTRACT(YEAR FROM bastarih)::int + 1, 4, 30) ELSE bittarih END
         WHERE donem = 'Kış Dönemi' AND durumu IN (1, 3, 4) AND bastarih > CURRENT_DATE`,
      )
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO app_settings (key, value, type, updated_at) VALUES ($1, $2::jsonb, 'sistem', NOW())`,
      KIS_BEKLIYOR_ISARETI,
      JSON.stringify({ tarih: new Date().toISOString() }),
    )
  })
  console.log(`[Dönem kapat] ${toplam} Kış Dönemi kaydı "Bekliyor" yapıldı (bir kerelik)`)
}

export async function kesilenYardimlarinDonemleriniKapat() {
  const d = new Date()
  const gun = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  if (globalForDonemKapat.donemKapatRunDate === gun) return
  await kisDonemiKayitlariniBirKereBekliyorYap()
  // 2026-10-15: eski kayitlardaki "6 AY", "3 ay", "6AY" gibi yazimlar tek
  // bicime ("6 Ay") cekilir - liste filtrelerinde ayni periyot iki kez
  // gorunuyordu (kullanici bildirimi: "Dönem filtresinde 2 tane 6 Ay var").
  for (const tablo of KIS_DONEMI_TABLOLARI) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${tablo} SET donem = regexp_replace(donem, '^\\s*(\\d+)\\s*[Aa][Yy]\\s*$', '\\1 Ay')
       WHERE donem ~* '^\\s*\\d+\\s*ay\\s*$' AND donem !~ '^\\d+ Ay$'`,
    )
  }
  let toplam = 0
  for (const tablo of KIS_DONEMI_TABLOLARI) {
    toplam += await prisma.$executeRawUnsafe(
      `UPDATE ${tablo} SET donem = $1
       WHERE COALESCE(durumu, 0) NOT IN (0, 2, 5) AND COALESCE(donem, '') <> $1`,
      KAPALI_DONEM,
    )
  }
  globalForDonemKapat.donemKapatRunDate = gun
  if (toplam > 0) console.log(`[Dönem kapat] ${toplam} kesilmiş yardımın dönemi "Kapalı" yapıldı`)
}
