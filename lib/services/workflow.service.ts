import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { IWorkflowStep } from '@/lib/types'
import { ModuleService, ModuleConfig } from './module.service'

type Db = Prisma.TransactionClient | typeof prisma

class WorkflowService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  private mapStep(item: any): IWorkflowStep {
    if (!item) return item
    return {
      ...item,
      id: item.id.toString(),
      requestId: item.requestId?.toString(),
    }
  }

  async getAll(skip = 0, take = 10): Promise<IWorkflowStep[]> {
    try {
      const steps = await prisma.workflowStep.findMany({
        skip,
        take,
        include: {
          request: true,
        },
        orderBy: { updatedAt: 'desc' },
      })
      return steps.map((item) => this.mapStep(item))
    } catch (error) {
      throw new Error(`İş akışı adımlarını getirme hatası: ${error}`)
    }
  }

  async getByRequest(requestId: string): Promise<IWorkflowStep[]> {
    try {
      const steps = await prisma.workflowStep.findMany({
        where: { requestId: BigInt(requestId) },
        include: { request: true },
      })
      return steps.map((item) => this.mapStep(item))
    } catch (error) {
      throw new Error(`Dosyaya ait iş akışlarını getirme hatası: ${error}`)
    }
  }

  async getById(id: string): Promise<IWorkflowStep | null> {
    try {
      const step = await prisma.workflowStep.findUnique({
        where: { id: BigInt(id) },
        include: {
          request: true,
        },
      })
      return this.mapStep(step)
    } catch (error) {
      throw new Error(`İş akışı adımı getirme hatası: ${error}`)
    }
  }

  async create(data: Partial<IWorkflowStep>, db: Db = prisma): Promise<IWorkflowStep> {
    try {
      const step = await db.workflowStep.create({
        data: {
          title: data.title || '',
          description: data.description || '',
          status: data.status || 'BEKLIYOR',
          priority: data.priority || 'NORMAL',
          requestId: data.requestId ? BigInt(data.requestId) : null,
          assignedStaff: data.assignedStaff,
          dueDate: data.dueDate,
        },
      })
      return this.mapStep(step)
    } catch (error) {
      throw new Error(`İş akışı adımı oluşturma hatası: ${error}`)
    }
  }

  async update(id: string, data: Partial<IWorkflowStep>, db: Db = prisma): Promise<IWorkflowStep> {
    try {
      const { id: _, createdAt, updatedAt, requestId, ...cleanData } = data as any
      const step = await db.workflowStep.update({
        where: { id: BigInt(id) },
        data: {
          ...cleanData,
          requestId: requestId ? BigInt(requestId) : undefined,
        },
      })
      return this.mapStep(step)
    } catch (error) {
      throw new Error(`İş akışı adımı güncelleme hatası: ${error}`)
    }
  }

  async delete(id: string, db: Db = prisma): Promise<any> {
    try {
      return await db.workflowStep.delete({
        where: { id: BigInt(id) },
      })
    } catch (error) {
      throw new Error(`İş akışı adımı silme hatası: ${error}`)
    }
  }
}

export const workflowService = new WorkflowService({
  name: 'Workflow',
  path: '/workflow',
  icon: 'workflow',
  description: 'İş akışı ve görev yönetimi',
})
