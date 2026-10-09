'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PREDEFINED_VALUE_TITLES,
  DEFAULT_PREDEFINED_VALUES,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
  getPredefinedValueLabel,
  resolvePredefinedCategory,
} from '@/lib/constants/predefinedValues'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

export const dynamic = "force-dynamic"

interface DatabaseInfo {
  db_name: string
  version: string
  current_user: string
}

interface MonitorTable {
  tableName: string
  rowCount: number
  columnCount: number
}

interface MonitorColumn {
  columnName: string
  dataType: string
  isNullable: boolean
}

type TableRow = Record<string, unknown>

interface OverviewResponse {
  success: boolean
  data?: {
    databaseInfo: DatabaseInfo | null
    tables: MonitorTable[]
  }
  error?: string
}

interface TableResponse {
  success: boolean
  data?: {
    tableName: string
    search?: string
    columns: MonitorColumn[]
    rows: TableRow[]
  }
  error?: string
}

interface SqlCommandResponse {
  success: boolean
  data?: {
    command: string
    rowCount: number | null
    rows: TableRow[]
  }
  error?: string
}

interface UpdateRowsResponse {
  success: boolean
  data?: TableRow[]
  error?: string
}

interface DeleteRowsResponse {
  success: boolean
  data?: { deletedCount: number }
  error?: string
}

interface PredefinedValuesResponse {
  success: boolean
  data?: {
    values: PredefinedValuesMap
    titles: PredefinedValueTitlesMap
  }
  error?: string
}

const formatCellValue = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL'
  if (value instanceof Date) return value.toLocaleString('tr-TR')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const formatDisplayCellValue = (
  predefinedValues: PredefinedValuesMap,
  predefinedValueTitles: PredefinedValueTitlesMap,
  tableName: string,
  columnName: string,
  value: unknown
) => {
  const predefinedLabel = getPredefinedValueLabel(
    predefinedValues,
    tableName,
    columnName,
    value,
    predefinedValueTitles
  )

  return predefinedLabel ?? formatCellValue(value)
}

const toEditableValue = (value: unknown) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Kullanici istegi: SQL Komut Alani daha "profesyonel" olsun - yazilan
// komutun OKUMA mi yoksa VERI DEGISTIREN/SILEN bir komut mu oldugu, komut
// calistirilmadan ONCE (ilk anahtar kelimeye bakarak) tespit edilip renkli
// bir rozetle gosterilir. Bu tespit, veri degistiren/silen (write/danger)
// komutlar icin ayrica bir ONAY penceresi tetiklemek amaciyla da kullanilir -
// canli/uretim veritabaninda yanlislikla calistirilan bir DELETE/DROP'un
// geri alinamaz olmasi riskine karsi son bir guvenlik adimi.
type CommandKind = 'read' | 'write' | 'danger'

function detectCommandKind(sql: string): CommandKind {
  const firstWord = sql.trim().split(/\s+/)[0]?.toUpperCase() || ''
  if (['SELECT', 'EXPLAIN', 'SHOW', 'WITH'].includes(firstWord)) return 'read'
  if (['DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'GRANT', 'REVOKE'].includes(firstWord)) return 'danger'
  // INSERT/UPDATE/CREATE ve taninmayan her sey - guvenli taraf, "write"
  // sayilip calistirilmadan once onay istenir.
  return 'write'
}

const COMMAND_KIND_META: Record<CommandKind, { label: string; badgeClass: string }> = {
  read: { label: 'OKUMA', badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  write: { label: 'YAZMA', badgeClass: 'border-amber-300 bg-amber-50 text-amber-700' },
  danger: { label: 'TEHLİKELİ', badgeClass: 'border-rose-300 bg-rose-50 text-rose-700' },
}

const SQL_COMMAND_HISTORY_KEY = 'netsosyal.sqlMonitor.commandHistory'
const SQL_COMMAND_HISTORY_LIMIT = 15

function readCommandHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(SQL_COMMAND_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeCommandHistory(history: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SQL_COMMAND_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // yoksay - gecmis sadece bu oturuma ozel bir kolaylik, kritik degil.
  }
}

// Kullanici istegi: tablo boyutuna gore hizli bir gorsel ipucu ("bu tablo
// kucuk mu buyuk mu") - satir sayisi arttikca rozet rengi yogunlasir.
function tableSizeBadgeClass(rowCount: number) {
  if (rowCount >= 10000) return 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'
  if (rowCount >= 500) return 'bg-sky-100 text-sky-700 ring-1 ring-sky-200'
  return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`inline-block ${className} shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent`}
      aria-hidden="true"
    />
  )
}

const QUICK_COMMAND_TEMPLATES: { label: string; icon: string; badgeClass: string; build: (table: string) => string }[] = [
  {
    label: 'SELECT',
    icon: '🔍',
    badgeClass: 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100',
    build: (table) => `SELECT * FROM ${table} LIMIT 20;`,
  },
  {
    label: 'COUNT',
    icon: '🔢',
    badgeClass: 'border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100',
    build: (table) => `SELECT COUNT(*) FROM ${table};`,
  },
  {
    label: 'UPDATE',
    icon: '✏️',
    badgeClass: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
    build: (table) => `UPDATE ${table}\nSET kolon_adi = 'yeni_deger'\nWHERE kosul;`,
  },
  {
    label: 'DELETE',
    icon: '🗑️',
    badgeClass: 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100',
    build: (table) => `DELETE FROM ${table}\nWHERE kosul;`,
  },
]

export default function SqlMonitorPage() {
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseInfo | null>(null)
  const [tables, setTables] = useState<MonitorTable[]>([])
  const [selectedTable, setSelectedTable] = useState('')
  const [columns, setColumns] = useState<MonitorColumn[]>([])
  const [rows, setRows] = useState<TableRow[]>([])
  const [tableSearch, setTableSearch] = useState('')
  const [rowSearch, setRowSearch] = useState('')
  const [activeRowSearch, setActiveRowSearch] = useState('')
  const [isOverviewLoading, setIsOverviewLoading] = useState(true)
  const [isTableLoading, setIsTableLoading] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRow | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [isSavingRow, setIsSavingRow] = useState(false)
  const [sqlCommand, setSqlCommand] = useState('')
  const [sqlResult, setSqlResult] = useState<SqlCommandResponse['data'] | null>(null)
  const [sqlError, setSqlError] = useState('')
  const [isSqlRunning, setIsSqlRunning] = useState(false)
  const [sqlExecutionMs, setSqlExecutionMs] = useState<number | null>(null)
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [predefinedValues, setPredefinedValues] = useState<PredefinedValuesMap>(DEFAULT_PREDEFINED_VALUES)
  const [predefinedValueTitles, setPredefinedValueTitles] = useState<PredefinedValueTitlesMap>(DEFAULT_PREDEFINED_VALUE_TITLES)
  const [error, setError] = useState('')

  // Kullanici istegi: "toplu islem yapabilecegim" - tablo icerigindeki
  // birden fazla satir isaretlenip TEK seferde silinebilsin veya TEK bir
  // alan hepsinde birden guncellenebilsin.
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false)
  const [bulkEditColumn, setBulkEditColumn] = useState('')
  const [bulkEditValue, setBulkEditValue] = useState('')
  const [isBulkSaving, setIsBulkSaving] = useState(false)

  // Kullanici istegi (Eylul 2026): baslik siralama + sutun bazli filtre.
  const [rowSortColumn, setRowSortColumn] = useState('')
  const [rowSortDir, setRowSortDir] = useState<'asc' | 'desc'>('asc')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [activeColumnFilters, setActiveColumnFilters] = useState<Record<string, string>>({})
  const tableQueryRef = useRef<{ sort: string; dir: 'asc' | 'desc'; filters: Record<string, string> }>({ sort: '', dir: 'asc', filters: {} })

  const sqlTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const loadOverview = async () => {
    setIsOverviewLoading(true)
    setError('')

    try {
      const response = await fetch('/api/sql-monitor')
      const payload = (await response.json()) as OverviewResponse

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Veritabanı bilgileri alınamadı.')
      }

      setDatabaseInfo(payload.data.databaseInfo)
      setTables(payload.data.tables)

      const tableToLoad = selectedTable || payload.data.tables[0]?.tableName || ''
      if (tableToLoad) {
        setSelectedTable(tableToLoad)
        loadTable(tableToLoad)
      } else {
        setColumns([])
        setRows([])
      }
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setIsOverviewLoading(false)
    }
  }

  const loadTable = async (tableName: string, search = '') => {
    if (!tableName) return

    setIsTableLoading(true)
    setError('')
    // Farkli bir tablo/arama sonucu yuklenirken onceki secim (__rowid'ler)
    // artik anlamsiz - toplu islem cubugunun yanlislikla eski/baska
    // satirlari hedeflemesini onlemek icin temizlenir.
    setSelectedRowIds(new Set())

    try {
      const params = new URLSearchParams({
        table: tableName,
        limit: '100',
      })

      if (search.trim()) {
        params.set('search', search.trim())
      }

      const query = tableQueryRef.current
      if (query.sort) {
        params.set('sort', query.sort)
        params.set('dir', query.dir)
      }
      if (query.filters && Object.keys(query.filters).length > 0) {
        params.set('filters', JSON.stringify(query.filters))
      }

      const response = await fetch(`/api/sql-monitor?${params.toString()}`)
      const payload = (await response.json()) as TableResponse

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Tablo içeriği alınamadı.')
      }

      setColumns(payload.data.columns)
      setRows(payload.data.rows)
      setActiveRowSearch(search.trim())
    } catch (loadError) {
      setColumns([])
      setRows([])
      setError((loadError as Error).message)
    } finally {
      setIsTableLoading(false)
    }
  }

  useEffect(() => {
    let isCancelled = false

    const loadInitialData = async () => {
      try {
        const response = await fetch('/api/sql-monitor')
        const payload = (await response.json()) as OverviewResponse

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || 'Veritabanı bilgileri alınamadı.')
        }

        if (isCancelled) return

        setDatabaseInfo(payload.data.databaseInfo)
        setTables(payload.data.tables)

        const firstTable = payload.data.tables[0]?.tableName
        if (!firstTable) return

        setSelectedTable(firstTable)
        setIsTableLoading(true)

        const tableResponse = await fetch(`/api/sql-monitor?table=${encodeURIComponent(firstTable)}&limit=100`)
        const tablePayload = (await tableResponse.json()) as TableResponse

        if (!tableResponse.ok || !tablePayload.success || !tablePayload.data) {
          throw new Error(tablePayload.error || 'Tablo içeriği alınamadı.')
        }

        if (isCancelled) return

        setColumns(tablePayload.data.columns)
        setRows(tablePayload.data.rows)
      } catch (loadError) {
        if (!isCancelled) {
          setError((loadError as Error).message)
        }
      } finally {
        if (!isCancelled) {
          setIsOverviewLoading(false)
          setIsTableLoading(false)
        }
      }
    }

    loadInitialData()
    setCommandHistory(readCommandHistory())

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    const loadPredefinedValues = async () => {
      try {
        const response = await fetch('/api/predefined-values')
        const payload = (await response.json()) as PredefinedValuesResponse

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || 'Hazır değerler alınamadı.')
        }

        if (!isCancelled) {
          setPredefinedValues(payload.data.values)
          setPredefinedValueTitles(payload.data.titles)
        }
      } catch {
        if (!isCancelled) {
          setPredefinedValues(DEFAULT_PREDEFINED_VALUES)
          setPredefinedValueTitles(DEFAULT_PREDEFINED_VALUE_TITLES)
        }
      }
    }

    loadPredefinedValues()

    return () => {
      isCancelled = true
    }
  }, [])

  const filteredTables = useMemo(() => {
    const search = tableSearch.toLocaleLowerCase('tr-TR')
    return tables.filter((table) => table.tableName.toLocaleLowerCase('tr-TR').includes(search))
  }, [tableSearch, tables])

  const totalRows = useMemo(
    () => tables.reduce((total, table) => total + table.rowCount, 0),
    [tables]
  )

  const selectedTableInfo = tables.find((table) => table.tableName === selectedTable)
  const searchRows = () => {
    loadTable(selectedTable, rowSearch)
  }

  const clearRowSearch = () => {
    setRowSearch('')
    loadTable(selectedTable)
  }

  // Kullanici istegi (Eylul 2026): basliklardan siralama + sutun bazli filtre.
  // Deger STATE + REF'te tutulur (ref: loadTable'in her cagrisi guncel
  // siralama/filtreyi otomatik uygulasin - tum mevcut cagrilari degistirmeye
  // gerek kalmadan).
  const handleSortColumn = (columnName: string) => {
    setRowSortColumn((prevColumn) => {
      let nextColumn = columnName
      let nextDir: 'asc' | 'desc' = 'asc'
      if (prevColumn === columnName) {
        // ayni sutun: asc -> desc -> (siralama yok)
        if (rowSortDir === 'asc') { nextDir = 'desc' }
        else { nextColumn = ''; nextDir = 'asc' }
      }
      setRowSortDir(nextDir)
      tableQueryRef.current = { ...tableQueryRef.current, sort: nextColumn, dir: nextDir }
      loadTable(selectedTable, activeRowSearch)
      return nextColumn
    })
  }

  const applyColumnFilters = () => {
    const cleaned = Object.fromEntries(
      Object.entries(columnFilters).filter(([, value]) => String(value ?? '').trim() !== ''),
    )
    setActiveColumnFilters(cleaned)
    tableQueryRef.current = { ...tableQueryRef.current, filters: cleaned }
    loadTable(selectedTable, activeRowSearch)
  }

  const clearColumnFilters = () => {
    setColumnFilters({})
    setActiveColumnFilters({})
    tableQueryRef.current = { ...tableQueryRef.current, filters: {} }
    loadTable(selectedTable, activeRowSearch)
  }

  const openEditModal = (row: TableRow) => {
    const nextValues: Record<string, string> = {}
    columns.forEach((column) => {
      nextValues[column.columnName] = toEditableValue(row[column.columnName])
    })

    setEditingRow(row)
    setEditValues(nextValues)
  }

  const saveEditedRow = async () => {
    if (!editingRow?.__rowid || !selectedTable) return

    const changedValues = columns.reduce<Record<string, unknown>>((values, column) => {
      const originalValue = toEditableValue(editingRow[column.columnName])
      const nextValue = editValues[column.columnName] ?? ''

      if (nextValue !== originalValue) {
        values[column.columnName] = nextValue.trim() === '' && column.isNullable ? null : nextValue
      }

      return values
    }, {})

    if (Object.keys(changedValues).length === 0) {
      setEditingRow(null)
      setEditValues({})
      return
    }

    setIsSavingRow(true)
    setError('')

    try {
      const response = await fetch('/api/sql-monitor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName: selectedTable,
          rowIds: [editingRow.__rowid],
          values: changedValues,
        }),
      })
      const payload = (await response.json()) as UpdateRowsResponse

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Kayıt güncellenemedi.')
      }

      const updatedRow = payload.data[0]
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.__rowid === editingRow.__rowid ? updatedRow ?? row : row
        )
      )
      setEditingRow(null)
      setEditValues({})
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setIsSavingRow(false)
    }
  }

  // --- Toplu (coklu secim) islemler --------------------------------------

  const toggleRowSelection = (rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const toggleSelectAllRows = () => {
    setSelectedRowIds((prev) => {
      if (rows.length > 0 && prev.size === rows.length) return new Set()
      return new Set(rows.map((row) => String(row.__rowid)))
    })
  }

  const clearRowSelection = () => setSelectedRowIds(new Set())

  const bulkDeleteSelectedRows = async () => {
    if (!selectedTable || selectedRowIds.size === 0) return

    const confirmed = await confirmDialog(
      `"${selectedTable}" tablosundan seçili ${selectedRowIds.size} kaydı KALICI OLARAK silmek üzeresiniz.\n\nBu işlem geri alınamaz. Emin misiniz?`,
      'Evet, Sil',
      'Vazgeç'
    )
    if (!confirmed) return

    setIsBulkDeleting(true)
    setError('')

    try {
      const response = await fetch('/api/sql-monitor', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName: selectedTable, rowIds: Array.from(selectedRowIds) }),
      })
      const payload = (await response.json()) as DeleteRowsResponse

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayıtlar silinemedi.')
      }

      setSelectedRowIds(new Set())
      loadOverview()
      loadTable(selectedTable, activeRowSearch)
    } catch (deleteError) {
      setError((deleteError as Error).message)
    } finally {
      setIsBulkDeleting(false)
    }
  }

  // Kullanici istegi (Ekim 2026): tablodaki HER satirin kendi "Sil" butonu
  // olsun - once secip sonra "Seçilenleri Sil" adimina gerek kalmadan.
  const deleteSingleRow = async (row: TableRow) => {
    if (!selectedTable) return
    const rowId = String(row.__rowid)
    if (!rowId) return

    const label = ['id', 'ID', 'Id'].map((key) => row[key]).find((value) => value !== undefined && value !== null)
    const confirmed = await confirmDialog(
      `"${selectedTable}" tablosundan ${label !== undefined ? `#${label} numaralı ` : 'bu '}kaydı KALICI OLARAK silmek üzeresiniz.\n\nBu işlem geri alınamaz. Emin misiniz?`,
      'Evet, Sil',
      'Vazgeç'
    )
    if (!confirmed) return

    setError('')
    try {
      const response = await fetch('/api/sql-monitor', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName: selectedTable, rowIds: [rowId] }),
      })
      const payload = (await response.json()) as DeleteRowsResponse
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayıt silinemedi.')
      }
      setSelectedRowIds((prev) => {
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
      loadOverview()
      loadTable(selectedTable, activeRowSearch)
    } catch (deleteError) {
      setError((deleteError as Error).message)
    }
  }

  const openBulkEditModal = () => {
    setBulkEditColumn(columns.find((column) => column.columnName !== '__rowid')?.columnName || '')
    setBulkEditValue('')
    setIsBulkEditOpen(true)
  }

  const saveBulkEdit = async () => {
    if (!selectedTable || selectedRowIds.size === 0 || !bulkEditColumn) return

    const column = columns.find((candidate) => candidate.columnName === bulkEditColumn)
    const trimmedValue = bulkEditValue.trim()
    const valueSummary = trimmedValue === '' ? 'BOŞ (NULL)' : `"${bulkEditValue}"`

    const confirmed = await confirmDialog(
      `"${selectedTable}" tablosundaki seçili ${selectedRowIds.size} kayıtta "${bulkEditColumn}" alanı ${valueSummary} olarak güncellenecek.\n\nEmin misiniz?`,
      'Evet, Güncelle',
      'Vazgeç'
    )
    if (!confirmed) return

    setIsBulkSaving(true)
    setError('')

    try {
      const value = trimmedValue === '' && column?.isNullable ? null : bulkEditValue
      const response = await fetch('/api/sql-monitor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName: selectedTable,
          rowIds: Array.from(selectedRowIds),
          values: { [bulkEditColumn]: value },
        }),
      })
      const payload = (await response.json()) as UpdateRowsResponse

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayıtlar güncellenemedi.')
      }

      setIsBulkEditOpen(false)
      setSelectedRowIds(new Set())
      loadTable(selectedTable, activeRowSearch)
    } catch (bulkEditError) {
      setError((bulkEditError as Error).message)
    } finally {
      setIsBulkSaving(false)
    }
  }

  // --- SQL Komut Alani ------------------------------------------------

  const sqlCommandKind = useMemo(() => (sqlCommand.trim() ? detectCommandKind(sqlCommand) : null), [sqlCommand])

  const pushCommandHistory = (command: string) => {
    setCommandHistory((prev) => {
      const next = [command, ...prev.filter((item) => item !== command)].slice(0, SQL_COMMAND_HISTORY_LIMIT)
      writeCommandHistory(next)
      return next
    })
  }

  const insertQuickTemplate = (build: (table: string) => string) => {
    const tableRef = selectedTable ? `public.${selectedTable}` : 'public.tablo_adi'
    setSqlCommand(build(tableRef))
    setIsHistoryOpen(false)
    sqlTextareaRef.current?.focus()
  }

  const runSqlCommand = async () => {
    const command = sqlCommand.trim()

    if (!command) {
      setSqlError('Çalıştırmak için bir SQL komutu yazın.')
      return
    }

    if (command.endsWith('public.')) {
      setSqlError('Tablo adını tamamlayın. Örnek: SELECT * FROM public.tablo_adi LIMIT 20;')
      return
    }

    // Guvenlik: veri DEGISTIREN/SILEN (SELECT/EXPLAIN/SHOW disindaki her
    // sey) bir komut, calistirilmadan once kullaniciya AYNEN gosterilip
    // ayrica onaylatilir - canli/uretim veritabaninda tek tikla geri
    // alinamaz bir islem yapilmasi riskine karsi son bir kontrol katmani.
    const kind = detectCommandKind(command)
    if (kind !== 'read') {
      const confirmed = await confirmDialog(
        `Bu komut veritabanında veri değiştirecek veya silecek:\n\n${command}\n\nÇalıştırmak istediğinize emin misiniz?`,
        'Evet, Çalıştır',
        'Vazgeç'
      )
      if (!confirmed) return
    }

    setIsSqlRunning(true)
    setSqlError('')
    setSqlResult(null)
    setSqlExecutionMs(null)
    const startedAt = performance.now()

    try {
      const response = await fetch('/api/sql-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: command }),
      })
      const payload = (await response.json()) as SqlCommandResponse

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'SQL komutu çalıştırılamadı.')
      }

      setSqlResult(payload.data)
      setSqlExecutionMs(Math.round(performance.now() - startedAt))
      pushCommandHistory(command)
      loadOverview()
      if (selectedTable) {
        loadTable(selectedTable, activeRowSearch)
      }
    } catch (commandError) {
      setSqlError((commandError as Error).message)
    } finally {
      setIsSqlRunning(false)
    }
  }

  const sqlResultColumns = useMemo(() => {
    if (!sqlResult?.rows.length) return []
    return Object.keys(sqlResult.rows[0])
  }, [sqlResult])

  const isAllRowsSelected = rows.length > 0 && selectedRowIds.size === rows.length

  return (
    <div className="space-y-5 text-slate-950">
      <div className="relative overflow-hidden rounded-lg border border-[#2A3B4D] bg-[#1E2A38] p-6 text-white shadow-sm">
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20 text-lg">🗄️</span>
              <p className="text-xl font-black uppercase tracking-wide text-white/90">PostgreSQL Monitörü</p>
              <span className="rounded-full border border-white/40 bg-white/15 px-3 py-1 text-base font-black uppercase tracking-wide text-white">
                Yönetici Aracı
              </span>
            </div>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">sosyalyardim Veritabanı</h1>
            <p className="mt-2 max-w-3xl text-xl font-semibold text-white/90">
              Yerel PostgreSQL üzerinde postgres kullanıcısı ile bağlanır, public şemasındaki tabloları ve içeriklerini gösterir;
              tekli/toplu kayıt düzenleme ve serbest SQL komutu çalıştırma imkanı sunar.
            </p>
          </div>
          <button
            onClick={loadOverview}
            disabled={isOverviewLoading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-xl font-extrabold text-[#1E2A38] shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
          >
            {isOverviewLoading ? <Spinner className="h-4 w-4 text-[#1E2A38]" /> : <span aria-hidden="true">⟳</span>}
            {isOverviewLoading ? 'Yenileniyor...' : 'Bağlantıyı Yenile'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xl font-bold text-rose-700">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg">🗃️</span>
            <p className="text-lg font-black uppercase text-slate-400">Veritabanı</p>
          </div>
          <p className="mt-2 text-2xl font-black text-[#1E2A38]">{databaseInfo?.db_name || 'Bağlantı yok'}</p>
          <p className="mt-1.5 text-lg font-bold text-slate-500">Kullanıcı: {databaseInfo?.current_user || '-'}</p>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg">📋</span>
            <p className="text-lg font-black uppercase text-slate-400">Tablo Sayısı</p>
          </div>
          <p className="mt-2 text-2xl font-black text-[#4f8f2f]">{tables.length}</p>
          <p className="mt-1.5 text-lg font-bold text-slate-500">public şeması</p>
        </div>
        <div className="rounded-lg border border-cyan-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-lg">📊</span>
            <p className="text-lg font-black uppercase text-slate-400">Toplam Satır</p>
          </div>
          <p className="mt-2 text-2xl font-black text-cyan-700">{totalRows.toLocaleString('tr-TR')}</p>
          <p className="mt-1.5 text-lg font-bold text-slate-500">tablo sayaçları</p>
        </div>
        <div className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-lg">🐘</span>
            <p className="text-lg font-black uppercase text-slate-400">PostgreSQL</p>
          </div>
          <p className="mt-2 line-clamp-2 text-xl font-extrabold text-slate-700">
            {databaseInfo?.version || 'Sürüm bilgisi bekleniyor'}
          </p>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-cyan-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-cyan-100 bg-gradient-to-r from-cyan-50 to-sky-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-extrabold text-cyan-800">
              <span aria-hidden="true">⌘</span>
              SQL Komut Alanı
              {sqlCommandKind && (
                <span className={`rounded-full border px-3 py-1 text-base font-black uppercase tracking-wide ${COMMAND_KIND_META[sqlCommandKind].badgeClass}`}>
                  {COMMAND_KIND_META[sqlCommandKind].label}
                </span>
              )}
            </h2>
            <p className="mt-1.5 text-lg font-bold text-slate-600">
              Yazdığınız komut doğrudan sosyalyardim veritabanında çalışır. Veri değiştiren/silen komutlar önce onay ister.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsHistoryOpen((prev) => !prev)}
              disabled={commandHistory.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-lg font-extrabold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">🕘</span>
              Geçmiş ({commandHistory.length})
            </button>
            <button
              onClick={runSqlCommand}
              disabled={isSqlRunning || !sqlCommand.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-cyan-700 px-5 py-2.5 text-lg font-extrabold text-white shadow-sm transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSqlRunning ? <Spinner className="h-4 w-4 text-white" /> : <span aria-hidden="true">▶</span>}
              {isSqlRunning ? 'Çalıştırılıyor...' : 'Çalıştır'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <span className="text-base font-black uppercase tracking-wide text-slate-400">Hızlı Şablon:</span>
          {QUICK_COMMAND_TEMPLATES.map((template) => (
            <button
              key={template.label}
              onClick={() => insertQuickTemplate(template.build)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-base font-black transition ${template.badgeClass}`}
            >
              <span aria-hidden="true">{template.icon}</span>
              {template.label}
            </button>
          ))}
          {selectedTable && (
            <span className="ml-auto rounded-full bg-white px-3 py-1.5 text-base font-bold text-slate-500 ring-1 ring-slate-200">
              Seçili tablo: <span className="font-black text-slate-700">{selectedTable}</span>
            </span>
          )}
        </div>

        {isHistoryOpen && (
          <div className="border-b border-slate-100 bg-white px-4 py-3">
            {commandHistory.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {commandHistory.map((historyItem, index) => (
                  <button
                    key={`${index}-${historyItem}`}
                    onClick={() => {
                      setSqlCommand(historyItem)
                      setIsHistoryOpen(false)
                      sqlTextareaRef.current?.focus()
                    }}
                    className="flex items-center gap-2 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left font-mono text-base font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50"
                    title={historyItem}
                  >
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-sm font-black uppercase ${COMMAND_KIND_META[detectCommandKind(historyItem)].badgeClass}`}
                    >
                      {COMMAND_KIND_META[detectCommandKind(historyItem)].label}
                    </span>
                    <span className="truncate">{historyItem}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-lg font-bold text-slate-400">Henüz komut geçmişi yok.</p>
            )}
          </div>
        )}

        <div className="space-y-3 p-4">
          <textarea
            ref={sqlTextareaRef}
            value={sqlCommand}
            onChange={(event) => setSqlCommand(event.target.value)}
            spellCheck={false}
            className="min-h-28 w-full resize-y rounded-md border border-slate-300 bg-slate-950 px-3 py-3 font-mono text-xl font-semibold text-cyan-50 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            placeholder="SELECT * FROM public.tablo_adi LIMIT 20;"
          />
          {sqlError && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xl font-bold text-rose-700">
              <span aria-hidden="true">⚠️</span>
              <span>{sqlError}</span>
            </div>
          )}
          {sqlResult && (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-slate-50 px-3 py-2.5 text-base font-extrabold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true">✅</span>
                  Komut: <code className="font-mono text-emerald-700">{sqlResult.command}</code>
                </span>
                <span className="flex items-center gap-3">
                  <span>Etkilenen satır: <span className="text-emerald-700">{sqlResult.rowCount ?? 0}</span></span>
                  {sqlExecutionMs !== null && <span>Süre: <span className="text-emerald-700">{sqlExecutionMs} ms</span></span>}
                </span>
              </div>
              {sqlResult.rows.length > 0 ? (
                // Kullanici istegi: bu sonuc tablosunun sutunlari CALISTIRILAN
                // SORGUYA GORE DEGISIR (herhangi sayida sutun donebilir) - bu
                // yuzden diger sabit UI alanlarindan farkli olarak BILINCLI
                // olarak kompakt birakildi (sadece hafif bir artis, 12px->14px),
                // aksi halde cok sutunlu bir sorgu sonucu yatayda kullanilamaz
                // hale gelirdi.
                <div className="max-h-72 overflow-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-[14px] font-semibold">
                    <thead className="sticky top-0 bg-[#eaf7fd] text-[#005f95] shadow-sm">
                      <tr>
                        {sqlResultColumns.map((column) => (
                          <th key={column} className="border-b border-[#b8dff2] px-3 py-2">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sqlResult.rows.map((row, index) => (
                        <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          {sqlResultColumns.map((column) => (
                            <td key={column} className="max-w-[280px] truncate border-b border-slate-100 px-3 py-2">
                              {formatDisplayCellValue(predefinedValues, predefinedValueTitles, selectedTable, column, row[column])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-3 py-4 text-xl font-bold text-slate-500">
                  Komut çalıştı, dönen satır yok.
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_1fr]">
        <section className="overflow-hidden rounded-lg border border-[#b8dff2] bg-white shadow-sm">
          <div className="border-b border-[#d8eff9] bg-[#f7fcff] px-4 py-3">
            <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#1E2A38]">
              <span aria-hidden="true">📋</span>
              Tablolar
            </h2>
            <input
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
              placeholder="Tablo ara..."
              className="mt-3 w-full rounded-md border border-[#b8dff2] px-4 py-2.5 text-lg font-bold outline-none focus:border-[#1E2A38] focus:ring-1 focus:ring-[#1E2A38]"
            />
          </div>

          <div className="max-h-[620px] overflow-y-auto p-2">
            {isOverviewLoading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-12 text-xl font-bold text-slate-500">
                <Spinner className="h-4 w-4 text-[#1E2A38]" />
                Tablolar yükleniyor...
              </div>
            ) : filteredTables.length > 0 ? (
              filteredTables.map((table) => {
                const isActive = table.tableName === selectedTable

                return (
                  <button
                    key={table.tableName}
                    onClick={() => {
                      setSelectedTable(table.tableName)
                      setRowSearch('')
                      setActiveRowSearch('')
                      // Baska tabloya gecince siralama/filtreyi sifirla
                      setRowSortColumn('')
                      setRowSortDir('asc')
                      setColumnFilters({})
                      setActiveColumnFilters({})
                      tableQueryRef.current = { sort: '', dir: 'asc', filters: {} }
                      loadTable(table.tableName)
                    }}
                    className={`group relative mb-1 flex w-full items-center justify-between rounded-md border px-3 py-3 text-left transition-colors ${
                      isActive
                        ? 'border-[#1E2A38] bg-slate-50 text-[#1E2A38] shadow-sm'
                        : 'border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {isActive && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[#1E2A38]" />}
                    <span className="min-w-0">
                      <span className="block truncate text-lg font-extrabold">{table.tableName}</span>
                      <span className="mt-0.5 block text-base font-bold text-slate-500">
                        {table.columnCount} kolon
                      </span>
                    </span>
                    <span className={`ml-3 shrink-0 rounded-full px-3 py-1.5 text-base font-black ${tableSizeBadgeClass(table.rowCount)}`}>
                      {table.rowCount.toLocaleString('tr-TR')}
                    </span>
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-12 text-center text-xl font-bold text-slate-500">Tablo bulunamadı.</div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[#9bd36f]/70 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#d8efcb] bg-gradient-to-r from-[#f1faed] to-emerald-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-extrabold text-[#3f7f28]">
                {selectedTable || 'Tablo seçilmedi'}
              </h2>
              <p className="mt-1.5 text-lg font-bold text-slate-600">
                {selectedTableInfo
                  ? `${selectedTableInfo.rowCount.toLocaleString('tr-TR')} satır, ${selectedTableInfo.columnCount} kolon`
                  : 'İçerik görüntülemek için bir tablo seçin.'}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              <input
                value={rowSearch}
                onChange={(event) => setRowSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    searchRows()
                  }
                }}
                placeholder="Tüm tabloda ara..."
                className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-lg font-bold outline-none focus:border-[#1E2A38] focus:ring-1 focus:ring-[#1E2A38] lg:w-72"
              />
              <button
                onClick={searchRows}
                disabled={!selectedTable || isTableLoading}
                className="rounded-md bg-[#1E2A38] px-5 py-2.5 text-lg font-extrabold text-white shadow-sm transition hover:bg-[#2A3B4D] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Ara
              </button>
              {activeRowSearch && (
                <button
                  onClick={clearRowSearch}
                  disabled={isTableLoading}
                  className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-lg font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Temizle
                </button>
              )}
            </div>
          </div>

          {columns.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#b8dff2] bg-[#f4fbff] px-4 py-3">
              <span className="text-lg font-black text-[#1E2A38]">
                Her sütun başlığının altındaki kutuya yazıp Enter'a basın ya da "Filtreleri Uygula"
                {Object.keys(activeColumnFilters).length > 0 ? ` · ${Object.keys(activeColumnFilters).length} filtre aktif` : ''}
              </span>
              <button
                onClick={applyColumnFilters}
                disabled={isTableLoading}
                className="ml-auto rounded-md bg-[#1E2A38] px-4 py-2 text-lg font-extrabold text-white shadow-sm transition hover:bg-[#2A3B4D] disabled:opacity-60"
              >
                Filtreleri Uygula
              </button>
              {(Object.keys(activeColumnFilters).length > 0 || Object.keys(columnFilters).length > 0) && (
                <button
                  onClick={clearColumnFilters}
                  disabled={isTableLoading}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-lg font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Filtreleri Temizle
                </button>
              )}
            </div>
          )}

          {/* Kullanici istegi: "toplu islem yapabilecegim" - bir veya daha
              fazla satir isaretlendiginde bu renkli/belirgin cubuk belirir,
              secili kayit sayisini gosterir ve toplu Alan Guncelle/Sil
              islemlerine goturur. */}
          {selectedRowIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-1.5 text-base font-black text-white shadow-sm">
                <span aria-hidden="true">☑️</span>
                {selectedRowIds.size} kayıt seçildi
              </span>
              <button
                onClick={openBulkEditModal}
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-white px-3.5 py-2 text-base font-extrabold text-indigo-700 shadow-sm transition hover:bg-indigo-100"
              >
                <span aria-hidden="true">✏️</span>
                Alan Güncelle
              </button>
              <button
                onClick={bulkDeleteSelectedRows}
                disabled={isBulkDeleting}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3.5 py-2 text-base font-extrabold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isBulkDeleting ? <Spinner className="h-3.5 w-3.5 text-rose-700" /> : <span aria-hidden="true">🗑️</span>}
                {isBulkDeleting ? 'Siliniyor...' : 'Seçilenleri Sil'}
              </button>
              <button
                onClick={clearRowSelection}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-base font-extrabold text-slate-500 transition hover:bg-white/70"
              >
                Seçimi Temizle
              </button>
            </div>
          )}

          {/* Kullanici istegi: bu ana veri izgarasi de HERHANGI BIR
              tablonun (kolon sayisi degisken) icerigini gosterdigi icin
              (yukaridaki sorgu sonucu tablosuyla ayni sebep) sadece hafif
              bir artis yapildi (13/14px -> 15/16px) - tam 20px, cok sutunlu
              tablolarda (ör. dosyalar) yatay kullanilabilirligi bozardi. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-[16px] font-semibold">
              <thead className="bg-[#eaf7fd] text-[15px] font-extrabold uppercase text-[#005f95]">
                <tr>
                  {columns.length > 0 ? (
                    <>
                    <th className="border-b border-[#b8dff2] px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isAllRowsSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = selectedRowIds.size > 0 && !isAllRowsSelected
                        }}
                        onChange={toggleSelectAllRows}
                        disabled={rows.length === 0}
                        className="h-4 w-4 cursor-pointer accent-[#1E2A38]"
                        title="Tümünü seç"
                      />
                    </th>
                    <th className="border-b border-[#b8dff2] px-4 py-3">İşlem</th>
                    {columns.map((column) => {
                      const isSorted = rowSortColumn === column.columnName
                      return (
                      <th key={column.columnName} className="border-b border-[#b8dff2] px-4 py-2 align-bottom">
                        <button
                          type="button"
                          onClick={() => handleSortColumn(column.columnName)}
                          title="Sıralamak için tıklayın (artan → azalan → kapalı)"
                          className={`flex w-full items-center gap-1 rounded px-1 py-1 text-left transition hover:bg-[#d6ecf9] ${isSorted ? 'text-[#1E2A38]' : ''}`}
                        >
                          <span className="block truncate">{column.columnName}</span>
                          <span className="ml-auto shrink-0 text-[14px]">{isSorted ? (rowSortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                        </button>
                        <span className="mt-0.5 block px-1 text-[13px] normal-case text-slate-500">
                          {column.dataType}{column.isNullable ? '' : ' / zorunlu'}
                        </span>
                        <div className="relative mt-1.5">
                          <input
                            value={columnFilters[column.columnName] ?? ''}
                            onChange={(event) => setColumnFilters((prev) => {
                              const next = { ...prev }
                              if (event.target.value) next[column.columnName] = event.target.value
                              else delete next[column.columnName]
                              return next
                            })}
                            onKeyDown={(event) => { if (event.key === 'Enter') applyColumnFilters() }}
                            placeholder="Bu sütunda ara..."
                            className={`w-full rounded-md border bg-white px-2 py-1.5 text-[14px] font-semibold normal-case text-slate-700 outline-none focus:border-[#1E2A38] focus:ring-1 focus:ring-[#1E2A38] ${columnFilters[column.columnName] ? 'border-amber-400 pr-5 ring-1 ring-amber-200' : 'border-[#b8dff2]'}`}
                          />
                          {columnFilters[column.columnName] && (
                            <button
                              type="button"
                              onClick={() => setColumnFilters((prev) => {
                                const next = { ...prev }
                                delete next[column.columnName]
                                return next
                              })}
                              title="Bu sütun filtresini temizle"
                              className="absolute inset-y-0 right-0.5 flex items-center px-1 text-slate-400 hover:text-rose-600"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </th>
                      )
                    })}
                    </>
                  ) : (
                    <th className="border-b border-[#b8dff2] px-4 py-3">İçerik</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isTableLoading ? (
                  <tr>
                    <td colSpan={Math.max(columns.length + 2, 1)} className="px-4 py-16 text-center text-xl font-bold text-slate-500">
                      <span className="inline-flex items-center gap-2">
                        <Spinner className="h-4 w-4 text-[#1E2A38]" />
                        Tablo içeriği yükleniyor...
                      </span>
                    </td>
                  </tr>
                ) : rows.length > 0 ? (
                  rows.map((row, rowIndex) => {
                    const rowId = String(row.__rowid)
                    const isSelected = selectedRowIds.has(rowId)

                    return (
                      <tr
                        key={rowIndex}
                        className={`${isSelected ? 'bg-indigo-50' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-[#f1faed]`}
                      >
                        <td className="border-b border-slate-100 px-3 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelection(rowId)}
                            className="h-4 w-4 cursor-pointer accent-[#1E2A38]"
                          />
                        </td>
                        <td className="border-b border-slate-100 px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openEditModal(row)}
                              className="rounded-md border border-[#1E2A38] bg-white px-3.5 py-2 text-[15px] font-extrabold text-[#1E2A38] transition hover:bg-slate-100"
                            >
                              Düzenle
                            </button>
                            <button
                              onClick={() => void deleteSingleRow(row)}
                              className="rounded-md border border-rose-300 bg-white px-3.5 py-2 text-[15px] font-extrabold text-rose-600 transition hover:bg-rose-50"
                            >
                              Sil
                            </button>
                          </div>
                        </td>
                        {columns.map((column) => {
                          const rawValue = row[column.columnName]
                          const isEmpty = rawValue === null || rawValue === undefined

                          return (
                            <td key={column.columnName} className="max-w-[320px] truncate border-b border-slate-100 px-4 py-3 text-[16px] text-slate-900">
                              <span className={isEmpty ? 'font-extrabold text-slate-400' : ''}>
                                {formatDisplayCellValue(predefinedValues, predefinedValueTitles, selectedTable, column.columnName, rawValue)}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={Math.max(columns.length + 2, 1)} className="px-4 py-16 text-center text-xl font-bold text-slate-500">
                      Bu tabloda gösterilecek satır bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-right text-xl font-bold text-slate-700">
            {activeRowSearch
              ? `"${activeRowSearch}" araması için ${rows.length} kayıt gösteriliyor`
              : `İlk 100 satırdan ${rows.length} kayıt gösteriliyor`}
          </div>
        </section>
      </div>

      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h3 className="flex items-center gap-2 text-2xl font-extrabold text-[#1E2A38]">
                  <span aria-hidden="true">✏️</span>
                  Kayıt Düzenle
                </h3>
                <p className="mt-1.5 text-lg font-bold text-slate-500">{selectedTable} tablosu</p>
              </div>
              <button
                onClick={() => setEditingRow(null)}
                className="rounded-md px-4 py-2 text-xl font-extrabold text-slate-500 transition hover:bg-slate-100"
              >
                Kapat
              </button>
            </div>

            <div className="max-h-[62vh] overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {columns.map((column) => (
                  <label key={column.columnName} className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-lg font-extrabold text-slate-700">
                      <span className="truncate">{column.columnName}</span>
                      <span className="shrink-0 text-base font-bold text-slate-400">{column.dataType}</span>
                    </span>
                    {(() => {
                      const predefinedCategory = resolvePredefinedCategory(
                        selectedTable,
                        column.columnName,
                        predefinedValueTitles,
                        predefinedValues
                      )
                      const predefinedOptions = predefinedCategory
                        ? predefinedValues[predefinedCategory] ?? []
                        : []

                      if (predefinedOptions.length > 0) {
                        return (
                          <select
                            value={editValues[column.columnName] ?? ''}
                            onChange={(event) =>
                              setEditValues((currentValues) => ({
                                ...currentValues,
                                [column.columnName]: event.target.value,
                              }))
                            }
                            className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-xl font-semibold text-slate-900 outline-none focus:border-[#1E2A38] focus:ring-1 focus:ring-[#1E2A38]"
                          >
                            {column.isNullable && <option value="">Boş / NULL</option>}
                            {predefinedOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        )
                      }

                      return (
                        <input
                          value={editValues[column.columnName] ?? ''}
                          onChange={(event) =>
                            setEditValues((currentValues) => ({
                              ...currentValues,
                              [column.columnName]: event.target.value,
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-xl font-semibold text-slate-900 outline-none focus:border-[#1E2A38] focus:ring-1 focus:ring-[#1E2A38]"
                        />
                      )
                    })()}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                onClick={() => setEditingRow(null)}
                className="rounded-md px-5 py-2.5 text-xl font-extrabold text-slate-600 transition hover:bg-slate-200"
              >
                İptal
              </button>
              <button
                onClick={saveEditedRow}
                disabled={isSavingRow}
                className="inline-flex items-center gap-2 rounded-md bg-[#1E2A38] px-6 py-2.5 text-xl font-extrabold text-white shadow-sm transition hover:bg-[#2A3B4D] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingRow && <Spinner className="h-4 w-4 text-white" />}
                {isSavingRow ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isBulkEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-5 py-4">
              <div>
                <h3 className="flex items-center gap-2 text-2xl font-extrabold text-indigo-800">
                  <span aria-hidden="true">✏️</span>
                  Toplu Alan Güncelle
                </h3>
                <p className="mt-1.5 text-lg font-bold text-slate-500">
                  {selectedTable} tablosunda seçili {selectedRowIds.size} kayıt
                </p>
              </div>
              <button
                onClick={() => setIsBulkEditOpen(false)}
                className="rounded-md px-4 py-2 text-xl font-extrabold text-slate-500 transition hover:bg-slate-100"
              >
                Kapat
              </button>
            </div>

            <div className="space-y-4 p-5">
              <label className="block">
                <span className="mb-1.5 block text-lg font-extrabold text-slate-700">Alan (kolon)</span>
                <select
                  value={bulkEditColumn}
                  onChange={(event) => {
                    setBulkEditColumn(event.target.value)
                    setBulkEditValue('')
                  }}
                  className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-xl font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  {columns
                    .filter((column) => column.columnName !== '__rowid')
                    .map((column) => (
                      <option key={column.columnName} value={column.columnName}>
                        {column.columnName} ({column.dataType})
                      </option>
                    ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-lg font-extrabold text-slate-700">Yeni değer</span>
                {(() => {
                  const bulkColumn = columns.find((column) => column.columnName === bulkEditColumn)
                  const predefinedCategory = bulkColumn
                    ? resolvePredefinedCategory(selectedTable, bulkColumn.columnName, predefinedValueTitles, predefinedValues)
                    : null
                  const predefinedOptions = predefinedCategory ? predefinedValues[predefinedCategory] ?? [] : []

                  if (predefinedOptions.length > 0) {
                    return (
                      <select
                        value={bulkEditValue}
                        onChange={(event) => setBulkEditValue(event.target.value)}
                        className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-xl font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      >
                        {bulkColumn?.isNullable && <option value="">Boş / NULL</option>}
                        {predefinedOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    )
                  }

                  return (
                    <input
                      value={bulkEditValue}
                      onChange={(event) => setBulkEditValue(event.target.value)}
                      placeholder={bulkColumn?.isNullable ? 'Boş bırakılırsa NULL olur' : ''}
                      className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-xl font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  )
                })()}
              </label>

              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-lg font-bold text-amber-800">
                Bu değer, seçili <span className="font-black">{selectedRowIds.size}</span> kaydın tamamında aynı anda güncellenecek.
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                onClick={() => setIsBulkEditOpen(false)}
                className="rounded-md px-5 py-2.5 text-xl font-extrabold text-slate-600 transition hover:bg-slate-200"
              >
                İptal
              </button>
              <button
                onClick={saveBulkEdit}
                disabled={isBulkSaving || !bulkEditColumn}
                className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-6 py-2.5 text-xl font-extrabold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isBulkSaving && <Spinner className="h-4 w-4 text-white" />}
                {isBulkSaving ? 'Güncelleniyor...' : `${selectedRowIds.size} Kaydı Güncelle`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
