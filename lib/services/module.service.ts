/**
 * Base Module Service
 * Her modül bu base class'tan extend edilebilir
 */

export interface ModuleConfig {
  name: string
  path: string
  icon?: string
  description?: string
}

export class ModuleService {
  protected moduleName: string
  protected modulePath: string

  constructor(config: ModuleConfig) {
    this.moduleName = config.name
    this.modulePath = config.path
  }

  getModuleInfo() {
    return {
      name: this.moduleName,
      path: this.modulePath,
    }
  }

  // Override bu metodları
  async getAll(skip?: number, take?: number): Promise<any> {
    throw new Error(`${this.moduleName}: getAll not implemented`)
  }

  async getById(id: string): Promise<any> {
    throw new Error(`${this.moduleName}: getById not implemented`)
  }

  async create(data: any): Promise<any> {
    throw new Error(`${this.moduleName}: create not implemented`)
  }

  async update(id: string, data: any): Promise<any> {
    throw new Error(`${this.moduleName}: update not implemented`)
  }

  async delete(id: string): Promise<any> {
    throw new Error(`${this.moduleName}: delete not implemented`)
  }
}
