import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { IReport } from '@/lib/types'
import { ModuleService, ModuleConfig } from './module.service'

type Db = Prisma.TransactionClient | typeof prisma

class ReportService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  private mapReport(item: any): IReport {
    if (!item) return item
    return {
      ...item,
      id: item.id.toString(),
      requestId: item.requestId?.toString(),
    }
  }

  async getAll(skip = 0, take = 10): Promise<IReport[]> {
    try {
      const reports = await prisma.report.findMany({
        skip,
        take,
        include: {
          request: true,
        },
        orderBy: { updatedAt: 'desc' },
      })
      return reports.map((item) => this.mapReport(item))
    } catch (error) {
      throw new Error(`Raporları getirme hatası: ${error}`)
    }
  }

  async getByRequest(requestId: string): Promise<IReport[]> {
    try {
      const reports = await prisma.report.findMany({
        where: { requestId: BigInt(requestId) },
        orderBy: { date: 'desc' }
      })
      const mapped = reports.map((item) => this.mapReport(item))

      // "Hangi kullanıcı GİRMİŞ" bilgisi icin: ilkkullaniciid (bu raporu
      // ILK GİREN/OLUŞTURAN kullanici - kullaniciid ise en son GÜNCELLEYEN
      // kullaniciyi tutar, kullanicinin istedigi "kim girdi" bilgisi bu
      // degil) kullanicilar tablosuna ayri bir sorguyla cozuluyor - Report
      // modelinde bu alana dogrudan bir Prisma iliskisi (relation) tanimli
      // degil, bu yuzden tek tek degil TOPLU (IN) bir sorguyla cozup
      // bellekte esliyoruz. Ayni sorguda, "Onaya Gönder" akisindan otomatik
      // olusturulan raporlarda ONAYLAYAN kullaniciyi de (onaylayan_kullaniciid,
      // bkz. approval-requests/[id] PATCH) coziyoruz.
      const userIds = Array.from(new Set([
        ...mapped.map((r) => (r as { ilkkullaniciid?: number | null }).ilkkullaniciid),
        ...mapped.map((r) => (r as { onaylayan_kullaniciid?: number | null }).onaylayan_kullaniciid),
      ].filter((id): id is number => typeof id === 'number')))

      if (userIds.length > 0) {
        const users = await prisma.$queryRaw<{ id: bigint; name: string | null }[]>`
          SELECT id, COALESCE(NULLIF(BTRIM(kullanicitamadi), ''), kullaniciadi) AS name
          FROM kullanicilar
          WHERE id = ANY(${userIds.map((id) => BigInt(id))})
        `
        const nameById = new Map(users.map((u) => [Number(u.id), u.name]))
        mapped.forEach((r) => {
          const userId = (r as { ilkkullaniciid?: number | null }).ilkkullaniciid
          if (typeof userId === 'number') {
            (r as IReport & { userName?: string | null }).userName = nameById.get(userId) ?? null
          }
          const approverId = (r as { onaylayan_kullaniciid?: number | null }).onaylayan_kullaniciid
          if (typeof approverId === 'number') {
            (r as IReport & { approverName?: string | null }).approverName = nameById.get(approverId) ?? null
          }
        })
      }

      return mapped
    } catch (error) {
      throw new Error(`Dosyaya ait raporları getirme hatası: ${error}`)
    }
  }

  async getById(id: string): Promise<IReport | null> {
    try {
      const report = await prisma.report.findUnique({
        where: { id: BigInt(id) },
        include: {
          request: true,
        },
      })
      return this.mapReport(report)
    } catch (error) {
      throw new Error(`Rapor getirme hatası: ${error}`)
    }
  }

  async create(data: Partial<IReport>, db: Db = prisma): Promise<IReport> {
    try {
      // ONEMLI: kullaniciid/ilkkullaniciid ONCEDEN HIC yazilmiyordu - bu
      // yuzden yeni girilen raporlarda "kim girdi" bilgisi hep bos (NULL)
      // kaliyordu (eskiden/ice aktarilan kayitlarda bu alan doluydu, ondan
      // calisiyor gibi gorunuyordu). Su an giris yapan kullanici (route'tan
      // gelir) hem "ilk giren" hem "en son guncelleyen" olarak yazilir.
      const report = await db.report.create({
        data: {
          title: data.title || '',
          content: data.content || '',
          date: data.date || new Date(),
          requestId: data.requestId ? BigInt(data.requestId) : null,
          kullaniciid: data.kullaniciid ?? null,
          ilkkullaniciid: data.kullaniciid ?? null,
        },
      })
      return this.mapReport(report)
    } catch (error) {
      throw new Error(`Rapor oluşturma hatası: ${error}`)
    }
  }

  async update(id: string, data: Partial<IReport>, db: Db = prisma): Promise<IReport> {
    try {
      const { id: _, createdAt, updatedAt, requestId, ...cleanData } = data as any
      const report = await db.report.update({
        where: { id: BigInt(id) },
        data: {
          ...cleanData,
          requestId: requestId ? BigInt(requestId) : undefined,
        },
      })
      return this.mapReport(report)
    } catch (error) {
      throw new Error(`Rapor güncelleme hatası: ${error}`)
    }
  }

  async delete(id: string, db: Db = prisma): Promise<any> {
    try {
      return await db.report.delete({
        where: { id: BigInt(id) },
      })
    } catch (error) {
      throw new Error(`Rapor silme hatası: ${error}`)
    }
  }
}

export const reportService = new ReportService({
  name: 'Report',
  path: '/reports',
  icon: 'bar-chart',
  description: 'Tahkikat raporları yönetimi',
})
