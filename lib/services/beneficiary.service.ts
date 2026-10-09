import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { IBeneficiary } from '@/lib/types'
import { ModuleService, ModuleConfig } from './module.service'

type Db = Prisma.TransactionClient | typeof prisma

class BeneficiaryService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  // BigInt ID'leri string'e dönüştüren yardımcı metod
  private mapBeneficiary(item: any): IBeneficiary {
    if (!item) return item
    return {
      ...item,
      id: item.id.toString(),
    }
  }

  async getAll(skip = 0, take = 10): Promise<IBeneficiary[]> {
    try {
      const beneficiaries = await prisma.beneficiary.findMany({
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
      })
      return beneficiaries.map((item) => this.mapBeneficiary(item))
    } catch (error) {
      throw new Error(`Bireyleri getirme hatası: ${error}`)
    }
  }

  async getById(id: string): Promise<IBeneficiary | null> {
    try {
      const beneficiary = await prisma.beneficiary.findUnique({
        where: { id: BigInt(id) },
      })
      return this.mapBeneficiary(beneficiary)
    } catch (error) {
      throw new Error(`Birey getirme hatası: ${error}`)
    }
  }

  async create(data: Partial<IBeneficiary>, db: Db = prisma): Promise<IBeneficiary> {
    try {
      const beneficiary = await db.beneficiary.create({
        data: {
          tc: data.tc || '',
          name: data.name || '',
          phone: data.phone,
          address: data.address,
          district: data.district,
          birthDate: data.birthDate,
          status: data.status !== undefined ? data.status : 0,
          notes: data.notes,
        },
      })
      return this.mapBeneficiary(beneficiary)
    } catch (error) {
      throw new Error(`Birey oluşturma hatası: ${error}`)
    }
  }

  async update(id: string, data: Partial<IBeneficiary>, db: Db = prisma): Promise<IBeneficiary> {
    try {
      // Veritabanında olmayan alanları temizliyoruz
      const { id: _, createdAt, updatedAt, ...cleanData } = data as any

      const beneficiary = await db.beneficiary.update({
        where: { id: BigInt(id) },
        data: cleanData,
      })
      return this.mapBeneficiary(beneficiary)
    } catch (error) {
      throw new Error(`Birey güncelleme hatası: ${error}`)
    }
  }

  async delete(id: string, db: Db = prisma): Promise<any> {
    try {
      return await db.beneficiary.delete({
        where: { id: BigInt(id) },
      })
    } catch (error) {
      throw new Error(`Birey silme hatası: ${error}`)
    }
  }

  async getCount(): Promise<number> {
    try {
      return await prisma.beneficiary.count()
    } catch (error) {
      throw new Error(`Birey sayısı getirme hatası: ${error}`)
    }
  }
}

export const beneficiaryService = new BeneficiaryService({
  name: 'Beneficiary',
  path: '/beneficiary',
  icon: 'users',
  description: 'Sosyal yardım alıcıları yönetimi',
})
