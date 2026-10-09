import { prisma } from '@/lib/db/prisma'

const DEFAULT_KURBAN_CINSI = 'Büyük Baş Kurban'

export async function ensureKurbanCountsTable() {
  const tableRows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'yrd_kurban'
    ) AS exists;
  `

  if (!tableRows[0]?.exists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE public.yrd_kurban (
        id BIGSERIAL PRIMARY KEY,
        tarih DATE NOT NULL,
        kurban_turu VARCHAR(100) NOT NULL,
        kurban_cinsi VARCHAR(100) NOT NULL DEFAULT 'Büyük Baş Kurban',
        adet INTEGER NOT NULL,
        ilkislemtarihi TIMESTAMP(6) NOT NULL DEFAULT NOW(),
        islemtarihi TIMESTAMP(6) NOT NULL DEFAULT NOW()
      );
    `)
  }

  const columnRows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'yrd_kurban'
        AND column_name = 'kurban_cinsi'
    ) AS exists;
  `

  if (!columnRows[0]?.exists) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE public.yrd_kurban
      ADD COLUMN kurban_cinsi VARCHAR(100) NOT NULL DEFAULT 'Büyük Baş Kurban';
    `)
  }

  const oldTableRows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'dashboard_kurban_sayilari'
    ) AS exists;
  `

  if (oldTableRows[0]?.exists) {
    await prisma.$executeRaw`
      INSERT INTO public.yrd_kurban (
        tarih, kurban_turu, kurban_cinsi, adet, ilkislemtarihi, islemtarihi
      )
      SELECT
        old.tarih,
        old.kurban_turu,
        COALESCE(old.kurban_cinsi, ${DEFAULT_KURBAN_CINSI}),
        old.adet,
        COALESCE(old.ilkislemtarihi, NOW()),
        COALESCE(old.islemtarihi, NOW())
      FROM public.dashboard_kurban_sayilari old
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.yrd_kurban current
        WHERE current.tarih = old.tarih
          AND current.kurban_turu = old.kurban_turu
          AND current.kurban_cinsi = COALESCE(old.kurban_cinsi, ${DEFAULT_KURBAN_CINSI})
          AND current.adet = old.adet
      );
    `
  }

  const indexRows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'ind_yrd_kurban_tarih'
    ) AS exists;
  `

  if (!indexRows[0]?.exists) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX ind_yrd_kurban_tarih
      ON public.yrd_kurban (tarih);
    `)
  }
}
