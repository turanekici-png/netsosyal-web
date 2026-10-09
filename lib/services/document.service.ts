import { prisma } from '@/lib/db/prisma'
import { IDocument } from '@/lib/types'
import { ModuleService, ModuleConfig } from './module.service'

class DocumentService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  private mapDocument(item: any): IDocument {
    if (!item) return item
    return {
      ...item,
      id: item.id.toString(),
      requestId: item.requestId?.toString(),
    }
  }

  async getAll(skip = 0, take = 10): Promise<IDocument[]> {
    try {
      const documents = await prisma.document.findMany({
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
      })
      return documents.map((item) => this.mapDocument(item))
    } catch (error) {
      throw new Error(`Dökümanları getirme hatası: ${error}`)
    }
  }

  async getByRequest(requestId: string): Promise<IDocument[]> {
    try {
      const documents = await prisma.document.findMany({
        where: { requestId: Number(requestId) },
      })
      return documents.map((item) => this.mapDocument(item))
    } catch (error) {
      throw new Error(`Dosyaya ait dökümanları getirme hatası: ${error}`)
    }
  }

  async getById(id: string): Promise<IDocument | null> {
    try {
      const document = await prisma.document.findUnique({
        where: { id: parseInt(id) },
      })
      return this.mapDocument(document)
    } catch (error) {
      throw new Error(`Döküman getirme hatası: ${error}`)
    }
  }

  async create(data: Partial<IDocument>): Promise<IDocument> {
    try {
      const document = await prisma.document.create({
        data: {
          title: data.title || '',
          requestId: data.requestId ? Number(data.requestId) : null,
          status: data.status || 'bekliyor',
          notes: data.notes,
          tc: data.tc,
          name: data.name,
          requestedDate: data.requestedDate || new Date(),
        },
      })
      return this.mapDocument(document)
    } catch (error) {
      throw new Error(`Döküman oluşturma hatası: ${error}`)
    }
  }

  async update(id: string, data: Partial<IDocument>): Promise<IDocument> {
    try {
      const { id: _, createdAt, updatedAt, requestId, ...cleanData } = data as any
      const document = await prisma.document.update({
        where: { id: parseInt(id) },
        data: {
          ...cleanData,
          requestId: requestId ? Number(requestId) : undefined,
        },
      })
      return this.mapDocument(document)
    } catch (error) {
      throw new Error(`Döküman güncelleme hatası: ${error}`)
    }
  }

  async delete(id: string): Promise<any> {
    try {
      return await prisma.document.delete({
        where: { id: parseInt(id) },
      })
    } catch (error) {
      throw new Error(`Döküman silme hatası: ${error}`)
    }
  }
}

export const documentService = new DocumentService({
  name: 'Document',
  path: '/documents',
  icon: 'file',
  description: 'Döküman yönetimi',
})
