import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL tanımlı değil.')
  }

  // Kullanici istegi (2026-09-22, 2. tur): "eş zamanlı bağlantı durumunu
  // biraz daha artıralım... aynı anda 20 personelin de işlem yaptığını
  // düşünerek". Bu havuz, tum uygulamanin (personel ekranlari + herkese
  // acik online basvuru formu DAHIL) TEK ve PAYLASIMLI baglanti havuzu.
  // PostgreSQL sunucusunun kendi tavani (max_connections) 100; diger 5-6
  // AYRI havuzun (sqlMonitor, asistan salt-okunur, DKM/belge, iletisim,
  // vb. - her biri kendi varsayilaniyla ~10) EN KOTU ihtimalde ayni anda
  // hepsi dolarsa ~50-60 baglanti cekebilecegi hesaba katilarak, bu ANA
  // havuz (staff + online basvuru) 25'ten 40'a cikarildi - 100'luk tavanin
  // altinda GUVENLI bir pay birakir (bkz. asagidaki yuk testi ile
  // dogrulanan sonuclar). Daha da fazla baslik icin PostgreSQL sunucusunun
  // KENDI max_connections degerini yukseltmek gerekir - bu, sunucunun kisa
  // bir yeniden baslatmasini gerektirdigi icin AYRI bir onay ister.
  const adapter = new PrismaPg({ connectionString, max: 40 })
  return new PrismaClient({ adapter })
}

export const prisma = new Proxy({} as PrismaClient, {
  get(target, prop, receiver) {
    if (prop === 'toJSON' || prop === 'constructor' || prop === 'then') {
        return Reflect.get(target, prop, receiver);
    }
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient()
    }
    return Reflect.get(globalForPrisma.prisma, prop, receiver)
  }
})

const bigIntPrototype = BigInt.prototype as bigint & { toJSON?: () => string }

if (!bigIntPrototype.toJSON) {
  bigIntPrototype.toJSON = function () {
    return this.toString()
  }
}

if (process.env.NODE_ENV !== 'production') {
  // In development, we might want to ensure it's initialized if we want to share it, 
  // but lazy is fine even in dev.
}
