import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { IUser } from '@/lib/types'
import { ModuleService, ModuleConfig } from './module.service'
import { createHash, randomInt, timingSafeEqual } from 'crypto'
import { hashPassword, isScryptPassword, verifyScryptPassword } from '@/lib/security/password'
import { isValidNewPassword, PASSWORD_POLICY_DESCRIPTION } from '@/lib/security/passwordPolicy'

type Db = Prisma.TransactionClient | typeof prisma

// Eski (MD5/duz-metin) sifre karsilastirmalari icin sabit-zamanli esitlik -
// normal "===" ile karsilastirmak, teorik olarak zamanlama (timing) yan
// kanaliyla sifre/hash tahminine acik birakir (modern scrypt yolu zaten
// timingSafeEqual kullaniyordu, bu eski yollar da ayni korumaya kavustu).
function timingSafeStringEqual(a: string, b: string) {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

class UserService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  private mapUser(item: any): IUser {
    if (!item) return item
    const { password: _password, ...safeItem } = item
    return {
      ...safeItem,
      id: item.id.toString(),
      name: item.kullanicitamadi,
    }
  }

  async getAll(skip = 0, take = 10): Promise<IUser[]> {
    try {
      const users = await prisma.user.findMany({
        skip,
        take,
        orderBy: [
          { kullanicitamadi: 'asc' },
          { username: 'asc' },
          { id: 'asc' },
        ],
      })
      return users.map((item) => this.mapUser(item))
    } catch (error) {
      throw new Error(`Kullanıcıları getirme hatası: ${error}`)
    }
  }

  async getById(id: string): Promise<IUser | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: BigInt(id) },
      })
      return this.mapUser(user)
    } catch (error) {
      throw new Error(`Kullanıcı getirme hatası: ${error}`)
    }
  }

  async getCurrent(): Promise<IUser | null> {
    try {
      const user = await prisma.user.findFirst({
        where: { status: 1 },
        orderBy: { id: 'asc' },
      })
      return this.mapUser(user)
    } catch (error) {
      throw new Error(`Aktif kullanıcı getirme hatası: ${error}`)
    }
  }

  async authenticate(username: string, password: string): Promise<IUser | null> {
    try {
      const user = await prisma.user.findFirst({
        where: {
          username: {
            equals: username,
            mode: 'insensitive',
          },
          status: 1,
        },
        // Buyuk/kucuk harf duyarsiz eslesme birden fazla kayit dondurebilir
        // (or. "Ahmet" ve "ahmet"); orderBy olmadan hangisinin gelecegi
        // belirsizdir -> ayni kullanici bazen giris yapip bazen yapamaz.
        // Deterministik olmasi icin en dusuk id (en eski hesap) secilir.
        orderBy: { id: 'asc' },
      })

      if (!user) return null

      const storedPassword = String(user.password || '')
      const passwordHash = createHash('md5').update(password).digest('hex').toLowerCase()
      const storedHash = storedPassword.slice(0, 32).toLowerCase()
      const isLegacyDefaultPassword =
        password === '123' &&
        storedPassword.length === 33 &&
        storedPassword.endsWith('B') &&
        storedHash.startsWith('256e522a')
      const isModernPassword = isScryptPassword(storedPassword)
      const isPasswordValid = isModernPassword
        ? await verifyScryptPassword(password, storedPassword)
        : timingSafeStringEqual(storedPassword, password) ||
          (/^[a-f0-9]{32}$/i.test(storedHash) && timingSafeStringEqual(storedHash, passwordHash)) ||
          isLegacyDefaultPassword

      if (!isPasswordValid) return null

      // GUVENLIK NOTU: "isLegacyDefaultPassword" eski/goc edilmis hesaplar
      // icin paylasilan, zayif bir varsayilan sifreyi ("123") kabul eden bir
      // uyumluluk yolu - kaldirilmasi bu durumdaki GERCEK personel
      // hesaplarinin kilitlenmesine yol acabilecegi icin CALISMA SISTEMINI
      // BOZMAMAK adina simdilik korunuyor, ama artik SESSIZ degil: hangi
      // hesabin bu zayif yolu kullandigi sunucu logunda goruluyor ki
      // yoneticiler bu hesaplari tespit edip gercek bir sifre belirlemeye
      // yonlendirebilsin (Ayarlar > Kullanicilar uzerinden sifre sifirlama).
      if (isLegacyDefaultPassword && !isModernPassword) {
        console.warn(
          `[guvenlik] Kullanici "${username}" (id=${user.id}) varsayilan/zayif eski sifre ("123") ile giris yapti - gercek bir sifre belirlemesi onerilir.`,
        )
      }

      if (!isModernPassword) {
        const upgradedPassword = await hashPassword(password)
        await prisma.user.update({
          where: { id: user.id },
          data: { password: upgradedPassword, islemtarihi: new Date() },
        })
      }

      return this.mapUser(user)
    } catch (error) {
      throw new Error(`Kullanici dogrulama hatasi: ${error}`)
    }
  }

  // "Şifremi Unuttum" akışı için: şifre KONTROLÜ yapmadan, sadece kullanıcı
  // adına göre AKTİF (status=1) kullanıcıyı bulur - IUser üzerinden telefon
  // (phone) bilgisine erişilebilir (mapUser sadece "password" alanını
  // gizler, phone/status dahil geri kalan her şeyi olduğu gibi taşır).
  async findByUsername(username: string): Promise<IUser | null> {
    try {
      const user = await prisma.user.findFirst({
        where: {
          username: { equals: username, mode: 'insensitive' },
          status: 1,
        },
      })
      return this.mapUser(user)
    } catch (error) {
      throw new Error(`Kullanıcı arama hatası: ${error}`)
    }
  }

  async create(data: Partial<IUser>, db: Db = prisma): Promise<IUser> {
    try {
      // Giris (login/route.ts, change-password/route.ts) sifreyi .trim() ile
      // dogrular - burada da AYNI sekilde kirpilmali, aksi halde admin sonda/
      // basta bosluklu bir sifre kaydederse kullanici o sifreyle HIC giremez.
      const plainPassword = String((data as any).password || '').trim()
      if (!isValidNewPassword(plainPassword)) {
        throw new Error(`Kullanıcı şifresi kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}`)
      }
      const passwordHash = await hashPassword(plainPassword)
      const user = await db.user.create({
        data: {
          username: data.username,
          password: passwordHash,
          kullanicitamadi: data.name,
          status: data.status !== undefined ? data.status : 1,
          email: data.email,
          phone: data.phone,
          address: data.address,
          yetki: (data as any).yetki,
          // Admin tarafindan olusturulan HER yeni kullanici, ilk girisinde
          // kendi sifresini belirlemeye zorlanir (DB kolonunun varsayilani
          // zaten true, burada acikca yazmak niyeti berrak tutuyor).
          mustChangePassword: true,
        },
      })
      return this.mapUser(user)
    } catch (error) {
      throw new Error(`Kullanıcı oluşturma hatası: ${error}`)
    }
  }

  async update(id: string, data: Partial<IUser>, db: Db = prisma): Promise<IUser> {
    try {
      const password = (data as any).password
      let passwordHash: string | undefined
      if (password !== undefined) {
        // Giris .trim() ile dogruluyor -> kayitta da kirp (bkz. create()).
        const plainPassword = String(password).trim()
        if (!isValidNewPassword(plainPassword)) {
          throw new Error(`Kullanıcı şifresi kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}`)
        }
        passwordHash = await hashPassword(plainPassword)
      }

      // Sifre degisiyorsa VARSAYILAN olarak "bir sonraki giriste sifresini
      // yeniden belirlemeli" isaretlenir - bu genelde ADMIN'in birine yeni/
      // gecici bir sifre atadigi durumdur. Kullanicinin KENDI sifresini
      // basariyla degistirdigi akis (change-password/route.ts) ise ACIKCA
      // mustChangePassword:false gonderir, bu durumda bayrak kaldirilir.
      const explicitMustChange = (data as any).mustChangePassword
      const mustChangePassword = explicitMustChange !== undefined
        ? Boolean(explicitMustChange)
        : (passwordHash !== undefined ? true : undefined)

      const user = await db.user.update({
        where: { id: BigInt(id) },
        data: {
          username: data.username,
          kullanicitamadi: data.name,
          status: data.status,
          email: data.email,
          phone: data.phone,
          address: data.address,
          yetki: (data as any).yetki,
          ...(passwordHash !== undefined ? { password: passwordHash } : {}),
          ...(mustChangePassword !== undefined ? { mustChangePassword } : {}),
        },
      })
      return this.mapUser(user)
    } catch (error) {
      throw new Error(`Kullanıcı güncelleme hatası: ${error}`)
    }
  }

  async resetPassword(id: string, db: Db = prisma): Promise<string> {
    try {
      // Kullanici istegi: eski uzun/karisik (harf+rakam+ozel karakter)
      // gecici sifre WhatsApp'tan okuyup elle yazmak icin gereksiz uzundu -
      // artik 6 haneli, SADECE rakamlardan olusan bir tek-kullanimlik sifre
      // (OTP tarzi) uretiliyor. crypto.randomInt guvenli/ongorulemez rastgele
      // sayi kaynagi kullanir (Math.random degil).
      const temporaryPassword = Array.from({ length: 6 }, () => randomInt(0, 10)).join('')
      const passwordHash = await hashPassword(temporaryPassword)
      await db.user.update({
        where: { id: BigInt(id) },
        // Admin tarafindan atanan gecici sifreyle giren kullanici, kendi
        // kalici sifresini belirlemeye zorlanir.
        data: { password: passwordHash, islemtarihi: new Date(), mustChangePassword: true },
      })
      return temporaryPassword
    } catch (error) {
      throw new Error(`Kullanıcı şifresi sıfırlanamadı: ${error}`)
    }
  }

  async delete(id: string, db: Db = prisma): Promise<any> {
    try {
      return await db.user.delete({
        where: { id: BigInt(id) },
      })
    } catch (error) {
      throw new Error(`Kullanıcı silme hatası: ${error}`)
    }
  }
}

export const userService = new UserService({
  name: 'User',
  path: '/users',
  icon: 'user',
  description: 'Kullanıcı yönetimi',
})
