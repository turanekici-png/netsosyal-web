import { sqlMonitorService, getSqlMonitorPool } from './sqlMonitor.service'
import { ensureMonthlyFoodBankPeriods } from './foodBankPeriod.service'
import { ensureMonthlySupportPackagePeriods } from './supportPackagePeriod.service'
import { ensureWinterSeasonalAidActivation, ensureWinterSeasonalAidCutoff } from './winterSeasonalAid.service'

export type ScheduledSqlTaskType = 'daily' | 'weekly'
export type ScheduledSqlTaskStatus = 'idle' | 'success' | 'error'

export interface ScheduledSqlTask {
  id: number
  name: string
  query: string
  scheduleType: ScheduledSqlTaskType
  dayOfWeek: number | null
  timeOfDay: string
  enabled: boolean
  lastRunAt: string | null
  lastStatus: ScheduledSqlTaskStatus
  lastMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface ScheduledSqlTaskInput {
  name: string
  query: string
  scheduleType: ScheduledSqlTaskType
  dayOfWeek?: number | null
  timeOfDay: string
  enabled: boolean
}

const globalForScheduledTasks = globalThis as unknown as {
  scheduledSqlTasksTimer?: ReturnType<typeof setInterval>
  scheduledSqlTasksRunning?: boolean
}

const ensureTable = async () => {
  const pool = getSqlMonitorPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sistem_zamanli_gorevler (
      id SERIAL PRIMARY KEY,
      gorev_adi VARCHAR(200) NOT NULL,
      gorev_tipi VARCHAR(60) DEFAULT 'sql',
      calisma_saati VARCHAR(5) DEFAULT '02:00',
      calisma_tarihi DATE,
      calisma_periyodu VARCHAR(20) DEFAULT 'gunluk',
      haftanin_gunu SMALLINT,
      ayin_gunu SMALLINT,
      sql_kodu TEXT,
      aktif BOOLEAN DEFAULT true,
      son_calisma_tarihi DATE,
      son_calisma_zamani TIMESTAMP,
      son_durum VARCHAR(40),
      son_mesaj TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `)
}

export const scheduledSqlTasksService = {
  async getAll(): Promise<ScheduledSqlTask[]> {
    await ensureTable()
    const pool = getSqlMonitorPool()
    const result = await pool.query(`
      SELECT 
        id, gorev_adi AS name, COALESCE(sql_kodu, '') AS query,
        CASE WHEN calisma_periyodu IN ('gunluk', 'günlük') THEN 'daily' WHEN calisma_periyodu IN ('haftalik', 'haftalık') THEN 'weekly' ELSE calisma_periyodu END AS "scheduleType",
        haftanin_gunu AS "dayOfWeek", calisma_saati AS "timeOfDay",
        aktif AS enabled, son_calisma_zamani AS "lastRunAt",
        COALESCE(son_durum, 'idle') AS "lastStatus", son_mesaj AS "lastMessage",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM sistem_zamanli_gorevler
      ORDER BY id ASC;
    `)
    return result.rows as unknown as ScheduledSqlTask[]
  },

  async create(input: ScheduledSqlTaskInput): Promise<ScheduledSqlTask> {
    await ensureTable()
    const pool = getSqlMonitorPool()
    const result = await pool.query(
      `
      INSERT INTO sistem_zamanli_gorevler (gorev_adi, sql_kodu, calisma_periyodu, haftanin_gunu, calisma_saati, aktif)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, gorev_adi AS name, sql_kodu AS query, calisma_periyodu AS "scheduleType", haftanin_gunu AS "dayOfWeek", calisma_saati AS "timeOfDay", aktif AS enabled, son_calisma_zamani AS "lastRunAt", COALESCE(son_durum, 'idle') AS "lastStatus", son_mesaj AS "lastMessage", created_at AS "createdAt", updated_at AS "updatedAt";
    `,
      [input.name, input.query, input.scheduleType, input.dayOfWeek ?? null, input.timeOfDay, input.enabled]
    )
    return result.rows[0] as unknown as ScheduledSqlTask
  },

  async update(id: number, input: Partial<ScheduledSqlTaskInput>): Promise<ScheduledSqlTask> {
    await ensureTable()
    const pool = getSqlMonitorPool()
    const fields: string[] = []
    const values: any[] = []
    let i = 1

    if (input.name !== undefined) {
      fields.push(`gorev_adi = $${i++}`)
      values.push(input.name)
    }
    if (input.query !== undefined) {
      fields.push(`sql_kodu = $${i++}`)
      values.push(input.query)
    }
    if (input.scheduleType !== undefined) {
      fields.push(`calisma_periyodu = $${i++}`)
      values.push(input.scheduleType)
    }
    if (input.dayOfWeek !== undefined) {
      fields.push(`haftanin_gunu = $${i++}`)
      values.push(input.dayOfWeek)
    }
    if (input.timeOfDay !== undefined) {
      fields.push(`calisma_saati = $${i++}`)
      values.push(input.timeOfDay)
    }
    if (input.enabled !== undefined) {
      fields.push(`aktif = $${i++}`)
      values.push(input.enabled)
    }

    fields.push(`updated_at = now()`)
    values.push(id)

    const result = await pool.query(
      `
      UPDATE sistem_zamanli_gorevler
      SET ${fields.join(', ')}
      WHERE id = $${i}
      RETURNING id, gorev_adi AS name, sql_kodu AS query, calisma_periyodu AS "scheduleType", haftanin_gunu AS "dayOfWeek", calisma_saati AS "timeOfDay", aktif AS enabled, son_calisma_zamani AS "lastRunAt", COALESCE(son_durum, 'idle') AS "lastStatus", son_mesaj AS "lastMessage", created_at AS "createdAt", updated_at AS "updatedAt";
    `,
      values
    )
    return result.rows[0] as unknown as ScheduledSqlTask
  },

  async delete(id: number): Promise<void> {
    await ensureTable()
    const pool = getSqlMonitorPool()
    await pool.query('DELETE FROM sistem_zamanli_gorevler WHERE id = $1', [id])
  },

  async runTask(id: number): Promise<void> {
    await ensureTable()
    const pool = getSqlMonitorPool()
    const result = await pool.query('SELECT sql_kodu AS query FROM sistem_zamanli_gorevler WHERE id = $1', [id])
    const task = result.rows[0]

    if (!task) throw new Error('Görev bulunamadı')

    try {
      await sqlMonitorService.executeQuery(task.query as string)
      await pool.query(
        `UPDATE sistem_zamanli_gorevler SET son_calisma_tarihi = CURRENT_DATE, son_calisma_zamani = now(), son_durum = 'success', son_mesaj = 'Başarıyla tamamlandı', updated_at = now() WHERE id = $1`,
        [id]
      )
    } catch (error: any) {
      await pool.query(
        `UPDATE sistem_zamanli_gorevler SET son_calisma_tarihi = CURRENT_DATE, son_calisma_zamani = now(), son_durum = 'error', son_mesaj = $2, updated_at = now() WHERE id = $1`,
        [id, error.message]
      )
      throw error
    }
  },

  startScheduler() {
    if (globalForScheduledTasks.scheduledSqlTasksTimer) return

    console.log('[Zamanlı Görevler] Servis başlatıldı')

    globalForScheduledTasks.scheduledSqlTasksTimer = setInterval(async () => {
      if (globalForScheduledTasks.scheduledSqlTasksRunning) return
      globalForScheduledTasks.scheduledSqlTasksRunning = true

      try {
        await ensureMonthlyFoodBankPeriods()
        await ensureMonthlySupportPackagePeriods()
        await ensureWinterSeasonalAidActivation()
        await ensureWinterSeasonalAidCutoff()

        const tasks = await this.getAll()
        const now = new Date()
        const currentDay = now.getDay()
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

        for (const task of tasks) {
          if (!task.enabled) continue

          let shouldRun = false
          if (task.scheduleType === 'daily' && task.timeOfDay === currentTime) {
            shouldRun = true
          } else if (task.scheduleType === 'weekly' && task.dayOfWeek === currentDay && task.timeOfDay === currentTime) {
            shouldRun = true
          }

          if (shouldRun) {
            const lastRun = task.lastRunAt ? new Date(task.lastRunAt) : null
            if (lastRun && lastRun.getHours() === now.getHours() && lastRun.getMinutes() === now.getMinutes() && lastRun.getDate() === now.getDate()) {
              continue
            }

            console.log(`[Zamanlı Görevler] Görev çalıştırılıyor: ${task.name}`)
            await this.runTask(task.id)
          }
        }
      } catch (error) {
        console.error('[Zamanlı Görevler] Hata:', error)
      } finally {
        globalForScheduledTasks.scheduledSqlTasksRunning = false
      }
    }, 60000)
  },
}
