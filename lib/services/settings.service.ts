import { prisma } from '@/lib/db/prisma'
import { ISetting } from '@/lib/types'
import { ModuleService, ModuleConfig } from './module.service'
import { formDesignTemplatesKey, mergeSettingWithLegacyDesignTemplates } from './legacyDesigns.service'
import { USER_PERMISSIONS_SETTING_KEY } from '@/lib/constants/userPermissions'

// requireApiAccess() (lib/apiAuth.ts) ve getCommunicationUser() (lib/communicationAuth.ts)
// yetki kontrolu icin bu ayari HER API isteginde (her kayit, her listeleme, her yazdirma
// oncesi yetki kontrolunde) okuyor - yani uygulamadaki neredeyse her istek bu yuzden bir
// veritabani sorgusu daha yapiyordu. Kullanici izinleri cok sik degismedigi icin kisa
// sureli bir bellek onbellegi bu sorguyu ortadan kaldirir; izinler /settings ekranindan
// kaydedildiginde (asagidaki set()) onbellek hemen temizlenir, boylece degisiklik bir
// sonraki istekte aninda yansir - en kotu ihtimalle TTL kadar (30 sn) gecikir.
const permissionsSettingCacheTtlMs = 30_000
const globalForSettingsCache = globalThis as unknown as {
  permissionsSettingCache?: { expiresAt: number; setting: ISetting | null }
}

class SettingService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  async getAll(): Promise<ISetting[]> {
    try {
      const settings = await prisma.setting.findMany()
      return settings as ISetting[]
    } catch (error) {
      throw new Error(`Ayarları getirme hatası: ${error}`)
    }
  }

  async getByKey(key: string): Promise<ISetting | null> {
    if (key === USER_PERMISSIONS_SETTING_KEY) {
      const cached = globalForSettingsCache.permissionsSettingCache
      if (cached && cached.expiresAt > Date.now()) {
        return cached.setting
      }
    }

    try {
      const setting = await prisma.setting.findUnique({
        where: { key },
      })

      if (key === USER_PERMISSIONS_SETTING_KEY) {
        globalForSettingsCache.permissionsSettingCache = {
          expiresAt: Date.now() + permissionsSettingCacheTtlMs,
          setting: setting as ISetting | null,
        }
      }

      if (key === formDesignTemplatesKey) {
        return await mergeSettingWithLegacyDesignTemplates(setting as ISetting | null)
      }

      return setting as ISetting | null
    } catch (error) {
      throw new Error(`Ayar getirme hatası: ${error}`)
    }
  }

  async set(key: string, value: any, type = 'json'): Promise<ISetting> {
    try {
      const existing = await prisma.setting.findUnique({
        where: { key },
      })

      const result = existing
        ? await prisma.setting.update({
            where: { key },
            data: { value, type, updatedAt: new Date() },
          }) as ISetting
        : await prisma.setting.create({
            data: { key, value, type, updatedAt: new Date() },
          }) as ISetting

      if (key === USER_PERMISSIONS_SETTING_KEY) {
        globalForSettingsCache.permissionsSettingCache = undefined
      }

      return result
    } catch (error) {
      throw new Error(`Ayar kaydetme hatası: ${error}`)
    }
  }

  async delete(key: string): Promise<any> {
    try {
      const result = await prisma.setting.delete({
        where: { key },
      })

      if (key === USER_PERMISSIONS_SETTING_KEY) {
        globalForSettingsCache.permissionsSettingCache = undefined
      }

      return result
    } catch (error) {
      throw new Error(`Ayar silme hatası: ${error}`)
    }
  }
}

export const settingService = new SettingService({
  name: 'Setting',
  path: '/settings',
  icon: 'settings',
  description: 'Sistem ayarları yönetimi',
})
