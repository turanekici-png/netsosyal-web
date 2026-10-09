import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { IAssistance } from '@/lib/types'
import { ModuleService, ModuleConfig } from './module.service'

type Db = Prisma.TransactionClient | typeof prisma

class AssistanceService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  // BigInt ID'leri ve ilişkili verileri formatlayan yardımcı metod
  private mapAssistance(item: any): IAssistance {
    if (!item) return item
    return {
      ...item,
      id: item.id.toString(),
      requestId: item.requestId?.toString(),
    }
  }

  async getAll(skip = 0, take = 10): Promise<IAssistance[]> {
    try {
      const assistances = await prisma.assistance.findMany({
        skip,
        take,
        include: {
          request: true,
        },
        orderBy: { updatedAt: 'desc' },
      })
      return assistances.map((item) => this.mapAssistance(item))
    } catch (error) {
      throw new Error(`Yardımları getirme hatası: ${error}`)
    }
  }

  async getByRequest(requestId: string): Promise<IAssistance[]> {
    try {
      const assistances = await prisma.assistance.findMany({
        where: { requestId: BigInt(requestId) },
        include: { request: true },
      })
      return assistances.map((item) => this.mapAssistance(item))
    } catch (error) {
      throw new Error(`Dosyaya ait yardımları getirme hatası: ${error}`)
    }
  }

  async getById(id: string): Promise<IAssistance | null> {
    try {
      const assistance = await prisma.assistance.findUnique({
        where: { id: BigInt(id) },
        include: {
          request: true,
        },
      })
      return this.mapAssistance(assistance)
    } catch (error) {
      throw new Error(`Yardım getirme hatası: ${error}`)
    }
  }

  async create(data: Partial<IAssistance>, db: Db = prisma): Promise<IAssistance> {
    try {
      const assistance = await db.assistance.create({
        data: {
          amount: data.amount,
          applicant: data.applicant || '',
          type: data.type || 'ayni',
          status: data.status !== undefined ? data.status : 0,
          requestId: data.requestId ? BigInt(data.requestId) : null,
          notes: data.notes,
          tc: data.tc,
          phone: data.phone,
        },
      })
      return this.mapAssistance(assistance)
    } catch (error) {
      throw new Error(`Yardım oluşturma hatası: ${error}`)
    }
  }

  async update(id: string, data: Partial<IAssistance>, db: Db = prisma): Promise<IAssistance> {
    try {
      const { id: _, createdAt, updatedAt, requestId, ...cleanData } = data as any

      const assistance = await db.assistance.update({
        where: { id: BigInt(id) },
        data: {
          ...cleanData,
          requestId: requestId ? BigInt(requestId) : undefined,
        },
      })
      return this.mapAssistance(assistance)
    } catch (error) {
      throw new Error(`Yardım güncelleme hatası: ${error}`)
    }
  }

  async delete(id: string, db: Db = prisma): Promise<any> {
    try {
      return await db.assistance.delete({
        where: { id: BigInt(id) },
      })
    } catch (error) {
      throw new Error(`Yardım silme hatası: ${error}`)
    }
  }
}

export const assistanceService = new AssistanceService({
  name: 'Assistance',
  path: '/assistance',
  icon: 'gift',
  description: 'Yardım yönetimi',
})
