import { prisma } from '@/lib/db/prisma'

// KRITIK: bu veritabani sunucusu PostgreSQL 9.4 (2016, EOL) - "INSERT ...
// ON CONFLICT" (UPSERT) sozdizimi 9.5'te eklendi, bu DB'de YOK. Prisma'nin
// `model.upsert()` metodu bu sozdizimini uretiyor ve bu DB'de HER ZAMAN
// "syntax error at or near ON" hatasiyla PATLIYOR - canli DB'ye karsi
// dogrulanarak yakalandi (bkz. app/api/table-settings/route.ts'in daha
// once ayni sekilde kirik olan upsert() cagrisi). Bu yuzden Setting
// modelinde upsert GEREKEN her yerde, ON CONFLICT'e IHTIYAC DUYMAYAN bu
// "once UPDATE dene, 0 satir etkilendiyse INSERT et" deseni kullanilir.
export async function upsertSetting(key: string, value: unknown, type = 'json') {
  const updated = await prisma.setting.updateMany({
    where: { key },
    data: { value: value as never, updatedAt: new Date() },
  })

  if (updated.count > 0) return

  try {
    await prisma.setting.create({ data: { key, value: value as never, type } })
  } catch {
    // Nadir yaris durumu: iki istek ayni anda geldi, biri INSERT'i bizden
    // once tamamladi (artik satir var) - bu durumda tekrar UPDATE denenir.
    await prisma.setting.updateMany({
      where: { key },
      data: { value: value as never, updatedAt: new Date() },
    })
  }
}
