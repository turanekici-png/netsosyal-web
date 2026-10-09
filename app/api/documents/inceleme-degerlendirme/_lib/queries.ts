import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { ensureIncelemeDegerlendirmeSchema } from './schema'
import type { CevapDetay, PuanlamaKurali, SecenekRow, SecimTuru, SoruBolum, SoruRow } from './types'

type SoruQueryRow = {
  id: string
  bolum: SoruBolum
  sira: number
  soru_metni: string
  secim_turu: SecimTuru
  zorunlu: boolean
  aktif: boolean
  red_kriteri: boolean
  red_secenegi: string | null
  sistem_sorusu: boolean
  puanlama_kurali: PuanlamaKurali | null
  secenek_id: string | null
  secenek_sira: number | null
  secenek_metni: string | null
  secenek_puan: number | null
  secenek_red_tetikler: boolean | null
  secenek_yonetici_onayi: boolean | null
  secenek_aktif: boolean | null
}

// Tum aktif sorulari + secenekleriyle birlikte tek sorguda ceker, bolum+sira
// sirasiyla gruplar. Hem form doldurma ekrani (GET /sorular) hem de
// puanlama motoru (POST formu gonderirken) bunu kullanir.
export async function fetchAllSorularWithSecenekler(includeInactive = false): Promise<SoruRow[]> {
  await ensureIncelemeDegerlendirmeSchema()
  const pool = getSqlMonitorPool()

  const result = await pool.query<SoruQueryRow>(
    `
      SELECT
        s.id::text AS id,
        s.bolum,
        s.sira,
        s.soru_metni,
        s.secim_turu,
        s.zorunlu,
        s.aktif,
        s.red_kriteri,
        s.red_secenegi,
        s.sistem_sorusu,
        s.puanlama_kurali,
        o.id::text AS secenek_id,
        o.sira AS secenek_sira,
        o.secenek_metni AS secenek_metni,
        o.puan AS secenek_puan,
        o.red_tetikler AS secenek_red_tetikler,
        o.yonetici_onayi AS secenek_yonetici_onayi,
        o.aktif AS secenek_aktif
      FROM public.inceleme_form_soru s
      LEFT JOIN public.inceleme_form_secenekler o ON o.soru_id = s.id AND ($1::boolean OR o.aktif = true)
      WHERE ($1::boolean OR s.aktif = true)
      ORDER BY s.bolum, s.sira, s.id, o.sira, o.id;
    `,
    [includeInactive],
  )

  const soruMap = new Map<string, SoruRow>()
  const order: string[] = []

  for (const row of result.rows) {
    if (!soruMap.has(row.id)) {
      soruMap.set(row.id, {
        id: Number(row.id),
        bolum: row.bolum,
        sira: row.sira,
        soruMetni: row.soru_metni,
        secimTuru: row.secim_turu,
        zorunlu: row.zorunlu,
        aktif: row.aktif,
        redKriteri: row.red_kriteri,
        redSecenegi: row.red_secenegi,
        sistemSorusu: row.sistem_sorusu,
        puanlamaKurali: row.puanlama_kurali,
        secenekler: [],
      })
      order.push(row.id)
    }

    if (row.secenek_id) {
      const soru = soruMap.get(row.id)
      const secenek: SecenekRow = {
        id: Number(row.secenek_id),
        soruId: Number(row.id),
        sira: row.secenek_sira ?? 0,
        secenekMetni: row.secenek_metni ?? '',
        puan: row.secenek_puan ?? 0,
        redTetikler: row.secenek_red_tetikler ?? false,
        yoneticiOnayi: row.secenek_yonetici_onayi ?? false,
        aktif: row.secenek_aktif ?? true,
      }
      soru?.secenekler.push(secenek)
    }
  }

  return order.map((id) => soruMap.get(id)!)
}

type CevapQueryRow = {
  soru_id: string
  soru_metni: string
  bolum: SoruBolum
  secim_turu: SecimTuru
  secilen_secenekler: number[] | null
  metin_cevap: string | null
  sayi_cevap: string | null
  toplam_puan: number | null
}

// Bir formun cevaplarini, secilen secenek id'lerini insan-okunabilir
// metinlere cevirerek dondurur - form detay ekrani (GET [id]) ve PDF/Excel
// uretimi bunu ortak kullanir.
export async function fetchCevapDetaylari(formId: string): Promise<CevapDetay[]> {
  const pool = getSqlMonitorPool()
  const result = await pool.query<CevapQueryRow>(
    `
      SELECT
        c.soru_id::text AS soru_id,
        s.soru_metni,
        s.bolum,
        s.secim_turu,
        c.secilen_secenekler,
        c.metin_cevap,
        c.sayi_cevap::text AS sayi_cevap,
        c.toplam_puan
      FROM public.inceleme_form_cevaplar c
      JOIN public.inceleme_form_soru s ON s.id = c.soru_id
      WHERE c.form_id = $1::bigint
      ORDER BY s.bolum, s.sira, s.id;
    `,
    [formId],
  )

  if (result.rows.length === 0) return []

  const secenekIdler = result.rows.flatMap((row) => row.secilen_secenekler ?? [])
  const secenekMetinleri = new Map<number, string>()
  if (secenekIdler.length > 0) {
    const secenekResult = await pool.query<{ id: string; secenek_metni: string }>(
      `SELECT id::text AS id, secenek_metni FROM public.inceleme_form_secenekler WHERE id = ANY($1::bigint[]);`,
      [secenekIdler],
    )
    for (const row of secenekResult.rows) {
      secenekMetinleri.set(Number(row.id), row.secenek_metni)
    }
  }

  return result.rows.map((row) => ({
    soruId: Number(row.soru_id),
    soruMetni: row.soru_metni,
    bolum: row.bolum,
    secimTuru: row.secim_turu,
    secilenSecenekMetinleri: (row.secilen_secenekler ?? []).map((id) => secenekMetinleri.get(id) ?? `#${id}`),
    metinCevap: row.metin_cevap,
    sayiCevap: row.sayi_cevap === null ? null : Number(row.sayi_cevap),
    toplamPuan: row.toplam_puan,
  }))
}
