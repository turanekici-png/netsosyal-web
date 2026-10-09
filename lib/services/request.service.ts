import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { IRequest } from '@/lib/types'
import { ModuleService, ModuleConfig } from './module.service'

type Db = Prisma.TransactionClient | typeof prisma

class RequestService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  // BigInt ID'leri ve ilişkili verileri formatlayan yardımcı metod
  private mapRequest(item: any): IRequest {
    if (!item) return item
    return {
      ...item,
      id: item.id.toString(),
      beneficiaries: item.beneficiaries?.map((b: any) => ({
        ...b,
        id: b.id.toString(),
        dosyaId: b.dosyaId?.toString()
      }))
    }
  }

  async getAll(skip = 0, take = 10): Promise<IRequest[]> {
    try {
      const requests = await prisma.request.findMany({
        skip,
        take,
        select: {
          id: true,
          kullaniciid: true,
          ilkkullaniciid: true,
          updatedAt: true,
          createdAt: true,
          title: true,
          muracaattarihi: true,
          mahalleid: true,
          mahalleadi: true,
          cadde: true,
          sokak: true,
          site: true,
          blok: true,
          binano: true,
          daireno: true,
          address: true,
          phone: true,
          priority: true,
          status: true,
          durumutarih: true,
          durumuaciklama: true,
          topbirey: true,
          description: true,
          locationLat: true,
          locationLon: true,
          locationSource: true,
          locationStatus: true,
          locationScore: true,
          locationHash: true,
          locationError: true,
          locationAt: true,
          beneficiaries: {
            select: {
              id: true,
              dosyaId: true,
              relation: true,
              tc: true,
              firstName: true,
              lastName: true,
              phone: true,
              address: true,
              status: true,
            },
          },
        },
        orderBy: [
          { updatedAt: { sort: 'desc', nulls: 'last' } },
          { muracaattarihi: { sort: 'desc', nulls: 'last' } },
          { createdAt: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
      })
      return requests.map((item) => this.mapRequest(item))
    } catch (error) {
      throw new Error(`Müracaatları getirme hatası: ${error}`)
    }
  }

  async getByBeneficiary(beneficiaryId: string): Promise<IRequest | null> {
    try {
      // Artık bir bireyin tek bir müracaat dosyası var
      const beneficiary = await prisma.beneficiary.findUnique({
        where: { id: BigInt(beneficiaryId) },
        include: {
          request: {
            include: {
              beneficiaries: true
            }
          }
        }
      })
      return beneficiary?.request ? this.mapRequest(beneficiary.request) : null
    } catch (error) {
      throw new Error(`Müracaatı getirme hatası: ${error}`)
    }
  }

  async getById(id: string): Promise<IRequest | null> {
    try {
      const request = await prisma.request.findUnique({
        where: { id: BigInt(id) },
        include: {
          beneficiaries: true,
        },
      })
      return this.mapRequest(request)
    } catch (error) {
      throw new Error(`Müracaat getirme hatası: ${error}`)
    }
  }

  async create(data: Partial<IRequest>, db: Db = prisma): Promise<IRequest> {
    try {
      const request = await db.request.create({
        data: {
          title: data.title || '',
          description: data.description || '',
          status: data.status !== undefined ? data.status : 0,
          priority: data.priority || 0,
        },
      })
      return this.mapRequest(request)
    } catch (error) {
      throw new Error(`Müracaat oluşturma hatası: ${error}`)
    }
  }

  async update(id: string, data: Partial<IRequest>, db: Db = prisma): Promise<IRequest> {
    try {
      const { id: _, createdAt, updatedAt, beneficiaries, ...cleanData } = data as any
      const request = await db.request.update({
        where: { id: BigInt(id) },
        data: cleanData,
      })
      return this.mapRequest(request)
    } catch (error) {
      throw new Error(`Müracaat güncelleme hatası: ${error}`)
    }
  }

  async delete(id: string, db: Db = prisma): Promise<any> {
    try {
      return await db.request.delete({
        where: { id: BigInt(id) },
      })
    } catch (error) {
      throw new Error(`Müracaat silme hatası: ${error}`)
    }
  }

  async changeStatus(id: string, status: number, db: Db = prisma): Promise<IRequest> {
    try {
      const request = await db.request.update({
        where: { id: BigInt(id) },
        data: { status },
      })
      return this.mapRequest(request)
    } catch (error) {
      throw new Error(`Müracaat durumu değiştirme hatası: ${error}`)
    }
  }
}

export const requestService = new RequestService({
  name: 'Request',
  path: '/requests',
  icon: 'edit',
  description: 'Müracaat yönetimi',
})
