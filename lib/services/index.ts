/**
 * Modules Registry
 * Tüm modülleri merkezi bir yerden yönetme
 * Ileride yeni modülü eklemek kolay: Registry'ye ekle ve API route'u kur
 */

import { MODULES_CONFIG } from '../constants/modules'
import { beneficiaryService } from './beneficiary.service'
import { documentService } from './document.service'
import { requestService } from './request.service'
import { assistanceService } from './assistance.service'
import { userService } from './user.service'
import { reportService } from './report.service'
import { workflowService } from './workflow.service'
import { settingService } from './settings.service'
import { sqlMonitorService } from './sqlMonitor.service'
import { schedulerService } from './scheduler.service'

export interface ModuleRegistry {
  name: string
  path: string
  icon?: string
  description?: string
  service: any
}

const servicesMap: Record<string, any> = {
  '/beneficiary': beneficiaryService,
  '/documents': documentService,
  '/requests': requestService,
  '/assistance': assistanceService,
  '/users': userService,
  '/reports': reportService,
  '/workflow': workflowService,
  '/settings': settingService,
  '/sql-monitor': sqlMonitorService,
  '/scheduled-tasks': schedulerService,
}

const modules: ModuleRegistry[] = MODULES_CONFIG.map(config => ({
  ...config,
  service: servicesMap[config.path]
}))

export class ModulesManager {
  static getAll() {
    return modules
  }

  static getByPath(path: string) {
    return modules.find(m => m.path === path)
  }

  static getService(modulePath: string) {
    const module = this.getByPath(modulePath)
    return module?.service
  }

  // Yeni modül eklemek için
  static registerModule(module: ModuleRegistry) {
    modules.push(module)
  }

  // Tüm modülleri navigasyon için
  static getNavigation() {
    return modules.map(m => ({
      label: m.name,
      path: m.path,
      icon: m.icon,
    }))
  }
}

export { 
  beneficiaryService, 
  documentService, 
  requestService, 
  assistanceService, 
  userService, 
  reportService, 
  workflowService, 
  settingService,
  sqlMonitorService,
  schedulerService
}
