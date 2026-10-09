declare module 'pg' {
  export interface PoolConfig {
    connectionString?: string
    max?: number
  }

  export interface QueryResult<T extends Record<string, unknown> = Record<string, unknown>> {
    command: string
    rowCount: number | null
    rows: T[]
  }

  export class Pool {
    constructor(config?: PoolConfig)
    connect(): Promise<PoolClient>
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[]
    ): Promise<QueryResult<T>>
    end(): Promise<void>
  }

  export interface PoolClient {
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[]
    ): Promise<QueryResult<T>>
    release(): void
  }
}
