import 'server-only'
import type { PoolClient } from 'pg'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

// Kullanici istegi (2026-10-15): tahkikat ekibi eve gidip sahsi bulamayinca
// formu "evde bulunamadi" diye kapatiyor, dosya yine de Sonuç Bekleyen'e
// dusuyordu. Sonuç Bekleyen'de "Ev Ziyareti Tekrarı" ile kullanici bir
// tahkikat raporu (tahkikatraporlari) yazar, dosya tekrar Tahkikat'a
// (durumu = 1) doner ve tahkikat listesinde son ziyaretin tarihi, aciklamasi
// ve ziyareti yapan personelle KIRMIZI, yanip sonen bir uyari gorunur.
//
// ev_ziyareti_tekrar: her tekrar istegi icin BIR satir. kapanma_tarihi bos
// olan satir "aktif" uyaridir; dosya icin yeni Hane Ziyareti formu (ya da
// eski "Rapor Ekle") kaydedilince kapanir. Kapanan satirlar silinmez - kac
// kez tekrar istendigi (tekrar_sayisi) buradan sayilir.

let tabloHazir = false

export async function evZiyaretiTekrarTablosunuHazirla() {
  if (tabloHazir) return
  const pool = getSqlMonitorPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ev_ziyareti_tekrar (
      id                    BIGSERIAL PRIMARY KEY,
      dosyaid               BIGINT NOT NULL,
      tahkikatrapor_id      BIGINT,
      konu                  TEXT,
      rapor                 TEXT,
      son_ziyaret_tarihi    DATE,
      son_ziyaret_personeli TEXT,
      son_ziyaret_sonucu    TEXT,
      isteyen_kullaniciid   INTEGER,
      isteyen_kullanici_adi TEXT,
      olusturma_tarihi      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kapanma_tarihi        TIMESTAMPTZ
    );
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_ev_ziyareti_tekrar_dosya ON public.ev_ziyareti_tekrar (dosyaid, kapanma_tarihi);`)
  tabloHazir = true
}

// Dosyanin aktif tekrar uyarisini kapatir (yeni ziyaret kaydedildi).
// Cagiranin transaction'i icinde calisir.
export async function evZiyaretiTekrariniKapat(client: PoolClient, dosyaid: string | number | bigint) {
  await evZiyaretiTekrarTablosunuHazirla()
  await client.query(
    `UPDATE public.ev_ziyareti_tekrar SET kapanma_tarihi = NOW() WHERE dosyaid = $1::bigint AND kapanma_tarihi IS NULL;`,
    [String(dosyaid)],
  )
}

export type EvZiyaretiTekrarUyarisi = {
  id: string
  konu: string
  rapor: string
  sonZiyaretTarihi: string | null
  sonZiyaretPersoneli: string | null
  sonZiyaretSonucu: string | null
  isteyenKullanici: string | null
  olusturmaTarihi: string | null
  tekrarSayisi: number
}

type UyariSatiri = {
  id: string
  dosyaid: string
  konu: string | null
  rapor: string | null
  son_ziyaret_tarihi: string | null
  son_ziyaret_personeli: string | null
  son_ziyaret_sonucu: string | null
  isteyen_kullanici_adi: string | null
  olusturma_tarihi: Date | string | null
  tekrar_sayisi: number | string | null
}

// Verilen dosyalarin (bos ise TUM dosyalarin) AKTIF uyarilari, dosya id -> uyari.
export async function aktifEvZiyaretiTekrarlari(dosyaIdleri?: string[]): Promise<Map<string, EvZiyaretiTekrarUyarisi>> {
  await evZiyaretiTekrarTablosunuHazirla()
  const filtre = dosyaIdleri && dosyaIdleri.length > 0
  const result = await getSqlMonitorPool().query<UyariSatiri>(
    `
      SELECT DISTINCT ON (t.dosyaid)
        t.id::text AS id, t.dosyaid::text AS dosyaid, t.konu, t.rapor,
        TO_CHAR(t.son_ziyaret_tarihi, 'YYYY-MM-DD') AS son_ziyaret_tarihi,
        t.son_ziyaret_personeli, t.son_ziyaret_sonucu, t.isteyen_kullanici_adi, t.olusturma_tarihi,
        (SELECT COUNT(*) FROM public.ev_ziyareti_tekrar s WHERE s.dosyaid = t.dosyaid)::int AS tekrar_sayisi
      FROM public.ev_ziyareti_tekrar t
      WHERE t.kapanma_tarihi IS NULL
        ${filtre ? 'AND t.dosyaid = ANY($1::bigint[])' : ''}
      ORDER BY t.dosyaid, t.olusturma_tarihi DESC, t.id DESC;
    `,
    filtre ? [dosyaIdleri] : [],
  )

  const sonuc = new Map<string, EvZiyaretiTekrarUyarisi>()
  for (const satir of result.rows) {
    const olusturma = satir.olusturma_tarihi ? new Date(satir.olusturma_tarihi) : null
    sonuc.set(satir.dosyaid, {
      id: satir.id,
      konu: String(satir.konu ?? '').trim(),
      rapor: String(satir.rapor ?? '').trim(),
      sonZiyaretTarihi: satir.son_ziyaret_tarihi,
      sonZiyaretPersoneli: satir.son_ziyaret_personeli?.trim() || null,
      sonZiyaretSonucu: satir.son_ziyaret_sonucu?.trim() || null,
      isteyenKullanici: satir.isteyen_kullanici_adi?.trim() || null,
      olusturmaTarihi: olusturma && !Number.isNaN(olusturma.getTime()) ? olusturma.toISOString() : null,
      tekrarSayisi: Number(satir.tekrar_sayisi ?? 1) || 1,
    })
  }
  return sonuc
}
