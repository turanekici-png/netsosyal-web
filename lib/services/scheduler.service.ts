import fs from 'fs/promises'
import path from 'path'
import { sqlMonitorService } from './sqlMonitor.service'
import { ModuleConfig, ModuleService } from './module.service'

export interface ScheduledTask {
  id: string
  name: string
  query: string
  scheduleTime: string
  scheduleDays?: number[]
  isActive: boolean
  lastRun?: string
}

const TASKS_FILE = path.join(process.cwd(), 'scheduled-tasks.json')

const globalForScheduler = globalThis as unknown as {
  timer?: NodeJS.Timeout
}

class SchedulerService extends ModuleService {
  private isRunning = false

  constructor(config: ModuleConfig) {
    super(config)
  }

  public start() {
    this.startTimer()
  }

  async getTasks(): Promise<ScheduledTask[]> {
    try {
      const data = await fs.readFile(TASKS_FILE, 'utf-8')
      return JSON.parse(data)
    } catch (e) {
      return []
    }
  }

  private async saveTasks(tasks: ScheduledTask[]) {
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8')
  }

  private startTimer() {
    if (!globalForScheduler.timer) {
      // Arka planda her 30 saniyede bir saati kontrol eder
      globalForScheduler.timer = setInterval(() => {
        this.checkAndRunTasks()
      }, 30000)
      this.checkAndRunTasks()
    }
  }

  private async checkAndRunTasks() {
    if (this.isRunning) return
    this.isRunning = true

    try {
      const tasks = await this.getTasks()
      const now = new Date()
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      const todayDate = now.toLocaleDateString('tr-TR')
      const currentDay = now.getDay() // 0 = Pazar, 1 = Pazartesi...
      let hasChanges = false

      for (const task of tasks) {
        const lastRunDate = task.lastRun?.split(' ')[0]
        const lastRunTime = task.lastRun?.split(' ')[1]?.substring(0, 5)
        const isScheduledDay = !task.scheduleDays || task.scheduleDays.length === 0 || task.scheduleDays.includes(currentDay)

        if (task.isActive && task.scheduleTime === currentTime && isScheduledDay) {
          if (lastRunDate === todayDate && lastRunTime === currentTime) {
            continue // Zaten bu dakika içinde çalıştırıldı
          }

          try {
            console.log(`[SQL-ZAMANLAYICI] Görev çalıştırılıyor: ${task.name}`)
            await sqlMonitorService.executeQuery(task.query)
            task.lastRun = now.toLocaleString('tr-TR')
          } catch (error: any) {
            console.error(`[SQL-ZAMANLAYICI] Görev Hatası (${task.name}):`, error.message)
            task.lastRun = `HATA: ${now.toLocaleString('tr-TR')}`
          }
          hasChanges = true
        }
      }

      if (hasChanges) {
        await this.saveTasks(tasks)
      }
    } catch (e) {
      console.error('Zamanlayıcı çekirdek hatası:', e)
    } finally {
      this.isRunning = false
    }
  }

  async addTask(task: Omit<ScheduledTask, 'id'>) {
    const tasks = await this.getTasks()
    const newTask = { ...task, id: Math.random().toString(36).substring(7) }
    tasks.push(newTask)
    await this.saveTasks(tasks)
    return newTask
  }

  async updateTask(id: string, updates: Partial<ScheduledTask>) {
    const tasks = await this.getTasks()
    const index = tasks.findIndex(t => t.id === id)
    if (index > -1) {
      tasks[index] = { ...tasks[index], ...updates }
      await this.saveTasks(tasks)
      return tasks[index]
    }
    return null
  }

  async deleteTask(id: string) {
    let tasks = await this.getTasks()
    tasks = tasks.filter(t => t.id !== id)
    await this.saveTasks(tasks)
  }
}

export const schedulerService = new SchedulerService({
  name: 'Zamanlanmış Görevler',
  path: '/scheduled-tasks',
  icon: 'settings',
  description: 'Zamanlanmış SQL görevlerini arka planda çalıştırır',
})