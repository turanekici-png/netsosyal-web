import { prisma } from '@/lib/db/prisma'

// Kullanici istegi (2026-10-08): "yönetici özel olarak bir dosyayı istediği
// tahkikat görevlisine direk atayabilsin, atanan özel bir dosya var ise
// sekme üzerinde bildirim versin" - "TAHKİKAT KULLANICISI" sutunu
// (dosyalar.kullaniciid) aslinda SADECE "bu dosyayi en son kim islediyse"
// bilgisini tasir (bkz. app/api/workflow/tahkikat/report/route.ts - rapor
// kaydedince kullaniciid guncelleniyor), bilincli bir "atama" KAVRAMI
// degil. Bu yuzden ayri, kucuk bir tablo: bir dosyanin AKTIF atamasi (en
// fazla bir satir/dosya - "gorundu" ile atanan gorevli henuz kendi
// sekmesini acip gormus mu takip edilir).
export async function ensureTahkikatAtamalariTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.tahkikat_atamalari (
      id BIGSERIAL PRIMARY KEY,
      dosyaid BIGINT NOT NULL,
      atanankullaniciid INTEGER NOT NULL,
      atayankullaniciid INTEGER,
      atamatarihi TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      gorundu BOOLEAN NOT NULL DEFAULT FALSE
    );
  `)

  // Bu veritabani sunucusu PostgreSQL 9.4 oldugu icin "CREATE UNIQUE INDEX
  // IF NOT EXISTS" desteklenmiyor (9.5+ ozelligi) - once pg_indexes'ten
  // kontrol edip oyle olusturuyoruz (on_inceleme_raporlari/guncelleme_formu
  // tablolarindaki AYNI desen).
  const indexResult = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'tahkikat_atamalari'
      AND indexname = 'uq_tahkikat_atamalari_dosyaid';
  `)

  if (indexResult.length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX uq_tahkikat_atamalari_dosyaid ON public.tahkikat_atamalari (dosyaid);
    `)
  }
}
