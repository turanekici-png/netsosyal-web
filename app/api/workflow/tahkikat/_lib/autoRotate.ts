import { prisma } from '@/lib/db/prisma'
import { settingService } from '@/lib/services'

// Kullanici istegi (2026-10-08, 6. tur): "bu sayfadan yeni grup ekleyelim,
// bu gruba mahalle seçelim ve en üstünde bu mahallelerden sorumlu olan
// kullanıcıyı seçelim. dönüşüm için tek tarih ve saat ekleyelim (ör. her
// ayın 1. günü) - o tarih geldiğinde sorumlu kullanıcılar yer değiştirsin."
// ONCEKI iki model (otomatik "ay formulu" ve admin'in elle girdigi
// per-grup tarih araligi takvimi) kaldirildi - yerine BU geldi:
//   tahkikat_paketleri.sorumlukullaniciid - grubun O ANKI sorumlusu
//     (admin dogrudan dropdown'dan secer/degistirir).
//   setting "tahkikat_rotasyon_tetik" = { gun (1-31), saat ("HH:MM"),
//     sonTetikTarihi (ISO, son uygulanan rotasyonun ZAMANI) } - TEK global
//     tetikleyici, TUM gruplar icin.
// Sayfa her acildiginda (gercek bir cron/zamanlayici OLMADAN, bu sistemde
// ayri bir arka plan zamanlayici altyapisi yok) applyDueRotations()
// cagrilir: sonTetikTarihi'nden bu yana KAC tetik ani GECTIYSE (ör. sunucu
// birkac gun/ay kapaliyken bile dogru sayida), gruplarin sorumlulari o
// kadar kez dairesel olarak kaydirilir (grup sirasina gore).
export async function ensureSorumluColumn() {
  const columnResult = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tahkikat_paketleri'
      AND column_name = 'sorumlukullaniciid';
  `)
  if (columnResult.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE public.tahkikat_paketleri ADD COLUMN sorumlukullaniciid INTEGER;
    `)
  }
}

const TETIK_SETTING_KEY = 'tahkikat_rotasyon_tetik'

export type RotasyonTetik = { gun: number; saat: string; sonTetikTarihi: string | null }

export async function getRotationTrigger(): Promise<RotasyonTetik> {
  const setting = await settingService.getByKey(TETIK_SETTING_KEY)
  const value = setting?.value as Partial<RotasyonTetik> | undefined

  const gun = Number.isInteger(value?.gun) && (value!.gun as number) >= 1 && (value!.gun as number) <= 31 ? (value!.gun as number) : 1
  const saat = typeof value?.saat === 'string' && /^\d{2}:\d{2}$/.test(value.saat) ? value.saat : '00:00'
  const sonTetikTarihi = typeof value?.sonTetikTarihi === 'string' ? value.sonTetikTarihi : null

  return { gun, saat, sonTetikTarihi }
}

async function saveTrigger(trigger: RotasyonTetik) {
  await settingService.set(TETIK_SETTING_KEY, trigger, 'json')
}

// Admin'in gun/saat AYARINI degistirmesi - "sonTetikTarihi" KORUNUR
// (degismez), boylece ayari degistirmek gecmis rotasyon ilerlemesini
// SIFIRLAMAZ.
export async function setRotationTriggerConfig(gun: number, saat: string) {
  const current = await getRotationTrigger()
  await saveTrigger({ gun, saat, sonTetikTarihi: current.sonTetikTarihi })
}

// Verilen (year, 1-bazli month) icin tetik anini dondurur - "gun" o ayin
// gun sayisindan fazlaysa (ör. 31 ama Subat 28 cekiyor) ayin SON gunune
// sabitlenir (standart takvim davranisi).
//
// ONEMLI (bulunan hata, 2026-10-08): admin'in girdigi "saat" alani TURKIYE
// YEREL saatidir (ör. "16:51" = Sivas'ta 16:51), ama Date.UTC(...) bunu
// DOGRUDAN UTC saati sanar - Turkiye UTC+3 oldugu icin gercek tetik ani 3
// SAAT ILERI kayardi (16:51 girilince sistem 19:51 UTC'de tetiklerdi, bu
// da "saati girdim ama rotasyon gerceklesmedi" sikayetine yol aciyordu -
// bu uygulamada DAHA ONCE de (bkz. "pg-naive-timestamp-utc" hatasi) ayni
// koken sorunu yasandi). Turkiye DST uygulamadigi icin (2016'dan beri
// sabit UTC+3) sabit bir offset yeterli - cevrimdisi/DST'li bir ulke icin
// bu basit cikarma yeterli olmazdi.
const TURKEY_UTC_OFFSET_HOURS = 3

function triggerInstant(year: number, month1: number, gun: number, saat: string): Date {
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate()
  const day = Math.min(gun, daysInMonth)
  const [hh, mm] = saat.split(':').map((part) => Number(part) || 0)
  return new Date(Date.UTC(year, month1 - 1, day, hh - TURKEY_UTC_OFFSET_HOURS, mm, 0))
}

export function nextTriggerAfter(after: Date, gun: number, saat: string): Date {
  let year = after.getUTCFullYear()
  let month1 = after.getUTCMonth() + 1
  let candidate = triggerInstant(year, month1, gun, saat)
  while (candidate <= after) {
    month1 += 1
    if (month1 > 12) { month1 = 1; year += 1 }
    candidate = triggerInstant(year, month1, gun, saat)
  }
  return candidate
}

function countCrossings(from: Date, to: Date, gun: number, saat: string): { count: number; lastCrossed: Date | null } {
  let count = 0
  let lastCrossed: Date | null = null
  let candidate = nextTriggerAfter(from, gun, saat)
  while (candidate <= to) {
    count += 1
    lastCrossed = candidate
    candidate = nextTriggerAfter(candidate, gun, saat)
  }
  return { count, lastCrossed }
}

type PaketOwnerRow = { id: bigint | number | string; sorumlukullaniciid: bigint | number | string | null }

// Tetik zamani gecmisse, gruplarin sorumlularini GRUP SIRASINA gore
// dairesel olarak kaydirir (ör. 3 grup varsa: G1'in sorumlusu G2'ye,
// G2'ninki G3'e, G3'unku G1'e kayar) - "sürekli yer değiştirsinler"
// istegi. Sunucu bir sure kapali kalip BIRDEN FAZLA tetik anini kacirmis
// olsa bile (ör. 2 ay), DOGRU sayida (mod grup sayisi) kaydirma uygulanir.
export async function applyDueRotations(): Promise<void> {
  await ensureSorumluColumn()

  const trigger = await getRotationTrigger()
  const now = new Date()

  if (!trigger.sonTetikTarihi) {
    // Ilk kurulum - henuz bir baslangic noktasi yok, simdiyi baslangic
    // kabul et (hicbir kaydirma UYGULANMAZ, sadece sayac baslar).
    await saveTrigger({ ...trigger, sonTetikTarihi: now.toISOString() })
    return
  }

  const { count, lastCrossed } = countCrossings(new Date(trigger.sonTetikTarihi), now, trigger.gun, trigger.saat)
  if (count === 0 || !lastCrossed) return

  const paketRows = await prisma.$queryRaw<PaketOwnerRow[]>`
    SELECT id, sorumlukullaniciid FROM tahkikat_paketleri ORDER BY sira ASC, id ASC;
  `

  if (paketRows.length > 0) {
    const shift = count % paketRows.length
    if (shift > 0) {
      const owners = paketRows.map((row) => row.sorumlukullaniciid)
      const updates = paketRows.map((row, index) => ({
        id: row.id,
        sorumlukullaniciid: owners[(index - shift + owners.length) % owners.length],
      }))
      await prisma.$transaction(
        updates.map((u) => prisma.$executeRaw`
          UPDATE tahkikat_paketleri SET sorumlukullaniciid = ${u.sorumlukullaniciid}, guncellemetarihi = NOW() WHERE id = ${u.id};
        `),
      )
    }
  }

  await saveTrigger({ ...trigger, sonTetikTarihi: lastCrossed.toISOString() })
}
